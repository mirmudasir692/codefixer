import { llm } from "mirascope";
import { z } from "zod";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import {
  assertInsideProject,
  truncate,
  numberLines,
  confirm,
  confirmDestructive,
  errorMessage,
  logger,
  rejectNumberedContent,
} from "../utils/index.js";
import { markRead, markWritten, hasBeenRead } from "../core/session.js";
import { historyManager } from "../core/history.js";

const DEFAULT_READ_LIMIT = 2000;

export const listDirectoryTool = llm.defineTool({
  name: "list_directory",
  description: "List files and folders in a directory.",
  validator: z.object({
    path: z.string().default(".").describe("Directory path"),
  }),
  tool: async ({ path: dirPath }) => {
    try {
      const resolved = assertInsideProject(dirPath);
      const entries = await readdir(resolved, { withFileTypes: true });
      return {
        ok: true,
        path: dirPath,
        entries: entries
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          })),
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: dirPath,
        entries: null,
        error: errorMessage(err),
      };
    }
  },
});

export const readFileTool = llm.defineTool({
  name: "read_file",
  description:
    "Read a text file. Returns line-numbered content. " +
    "Use offset and limit to read a specific line range from a large file. " +
    "Line numbers are 1-indexed and match what insert_file/replace_lines expect.",
  validator: z.object({
    path: z.string().describe("File path relative to project root"),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Start line (1-indexed). Defaults to line 1."),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(`Max lines to return. Defaults to ${DEFAULT_READ_LIMIT}.`),
  }),
  tool: async ({ path: filePath, offset, limit }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const raw = await readFile(resolved, "utf-8");
      const lines = raw.split("\n");
      const totalLines = lines.length;

      const start = (offset ?? 1) - 1;
      const count = limit ?? DEFAULT_READ_LIMIT;
      const slice = lines.slice(start, start + count);

      markRead(filePath);

      return {
        ok: true,
        path: filePath,
        totalLines,
        offset: start + 1,
        returnedLines: slice.length,
        content: numberLines(slice, start + 1),
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        totalLines: null,
        offset: null,
        returnedLines: null,
        content: null,
        error: errorMessage(err),
      };
    }
  },
});

export const writeFileTool = llm.defineTool({
  name: "write_file",
  description:
    "Create a NEW file or completely overwrite an existing one. " +
    "You MUST call read_file on an existing file BEFORE calling write_file on it — " +
    "this is enforced and the call will be rejected otherwise. " +
    "Prefer edit_file / insert_file / replace_lines for partial changes.",
  validator: z.object({
    path: z.string().describe("File path"),
    content: z.string().describe("Full file content"),
  }),
  tool: async ({ path: filePath, content }) => {
    try {
      assertInsideProject(filePath);
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }

    let exists = false;
    let existingContent = "";
    let existingSize = 0;
    try {
      existingContent = await readFile(filePath, "utf-8");
      exists = true;
      existingSize = existingContent.length;
    } catch {}

    const numberedError = rejectNumberedContent("write_file", content);
    if (numberedError) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: numberedError,
      };
    }

    if (exists && !hasBeenRead(filePath)) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error:
          `Refusing to overwrite ${filePath}: you have not read this file in this session. ` +
          `Call read_file on ${filePath} first. ` +
          `If you only need to change part of it, use edit_file, insert_file, or replace_lines ` +
          `instead of write_file.`,
      };
    }

    if (exists && existingContent === content) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error:
          `No changes: ${filePath} already contains this exact content. ` +
          `Use edit_file, insert_file, or replace_lines to make a real change, ` +
          `or reply with what should be added or modified.`,
      };
    }

    if (exists && existingSize > 200 && content.length < existingSize / 2) {
      const dropPct = Math.round((1 - content.length / existingSize) * 100);
      logger.info(
        `\n⚠⚠⚠  DESTRUCTIVE WRITE DETECTED\n` +
          `   ${filePath} is ${existingSize} chars on disk.\n` +
          `   You are about to replace it with ${content.length} chars (${dropPct}% smaller).\n` +
          `   First 120 chars of NEW content:\n   "${content.slice(0, 120).replace(/\n/g, "\\n")}"\n` +
          `   Type "yes-really" to confirm, anything else to abort.`,
      );
      const confirmed = await confirmDestructive(`> `);
      if (!confirmed) {
        return {
          ok: false,
          path: filePath,
          bytesWritten: null,
          error: `User denied destructive write to ${filePath}. Use edit_file for partial changes.`,
        };
      }
    } else {
      const approved = await confirm(
        `\n[write_file] ${filePath} (${content.length} chars). Allow? [y/N] `,
      );
      if (!approved) {
        return {
          ok: false,
          path: filePath,
          bytesWritten: null,
          error: "User denied write permission.",
        };
      }
    }

    try {
      await historyManager.snapshot(filePath, `write_file: ${filePath}`);
      await writeFile(filePath, content, "utf-8");
      markWritten(filePath);
      return {
        ok: true,
        path: filePath,
        bytesWritten: content.length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }
  },
});

export const editFileTool = llm.defineTool({
  name: "edit_file",
  description:
    "Replace an exact string inside an existing file. Use for targeted edits. " +
    "The old_string must match the file's current content EXACTLY and appear " +
    "exactly once. Read the file first to see its current content. " +
    "Set replace_all=true to replace every occurrence (use for renames).",
  validator: z.object({
    path: z.string().describe("File path"),
    old_string: z
      .string()
      .describe("Exact text to find (must be unique unless replace_all=true)"),
    new_string: z.string().describe("Replacement text"),
    replace_all: z
      .boolean()
      .default(false)
      .describe("If true, replace every occurrence of old_string."),
  }),
  tool: async ({ path: filePath, old_string, new_string, replace_all }) => {
    try {
      assertInsideProject(filePath);
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        occurrences: null,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        occurrences: null,
        bytesWritten: null,
        error: `Cannot read file: ${errorMessage(err)}. Use write_file if it does not exist yet.`,
      };
    }

    if (old_string === "") {
      return {
        ok: false,
        path: filePath,
        occurrences: null,
        bytesWritten: null,
        error:
          "old_string must not be empty. Use insert_file to add new lines, " +
          "or pass the exact text you want to replace.",
      };
    }

    const numberedError = rejectNumberedContent("edit_file", new_string);
    if (numberedError) {
      return {
        ok: false,
        path: filePath,
        occurrences: null,
        bytesWritten: null,
        error: numberedError,
      };
    }

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        path: filePath,
        occurrences: 0,
        bytesWritten: null,
        error: "old_string not found. Read the file first to see its current content.",
      };
    }
    if (occurrences > 1 && !replace_all) {
      return {
        ok: false,
        path: filePath,
        occurrences,
        bytesWritten: null,
        error: `old_string appears ${occurrences} times. Set replace_all=true or add surrounding context.`,
      };
    }

    const newContent = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string);

    const approved = await confirm(
      `\n[edit_file] ${filePath} (${occurrences} replacement(s)). Allow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        occurrences,
        bytesWritten: null,
        error: "User denied edit permission.",
      };
    }

    try {
      await historyManager.snapshot(filePath, `edit_file: ${filePath}`);
      await writeFile(filePath, newContent, "utf-8");
      return {
        ok: true,
        path: filePath,
        occurrences,
        bytesWritten: newContent.length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        occurrences,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }
  },
});

export const insertFileTool = llm.defineTool({
  name: "insert_file",
  description:
    "Insert content after a specific line number in an existing file. " +
    "Line numbers are 1-indexed and match read_file output. " +
    "after_line=0 inserts at the very beginning. " +
    "Use this for adding new code blocks without rewriting the whole file.",
  validator: z.object({
    path: z.string().describe("File path"),
    after_line: z
      .number()
      .int()
      .min(0)
      .describe("Insert after this line number (1-indexed). 0 = insert at top."),
    content: z.string().describe("Text to insert (can be multi-line)"),
  }),
  tool: async ({ path: filePath, after_line, content }) => {
    try {
      assertInsideProject(filePath);
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: `Cannot read file: ${errorMessage(err)}.`,
      };
    }

    const lines = raw.split("\n");
    if (after_line > lines.length) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: `after_line=${after_line} is beyond the file's ${lines.length} lines.`,
      };
    }

    const numberedError = rejectNumberedContent("insert_file", content);
    if (numberedError) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: numberedError,
      };
    }

    const newLines = content.split("\n");
    const updated = [
      ...lines.slice(0, after_line),
      ...newLines,
      ...lines.slice(after_line),
    ];

    const approved = await confirm(
      `\n[insert_file] ${filePath}: insert ${newLines.length} line(s) after line ${after_line}. Allow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: "User denied insert permission.",
      };
    }

    try {
      await historyManager.snapshot(filePath, `insert_file: ${filePath}`);
      const newContent = updated.join("\n");
      await writeFile(filePath, newContent, "utf-8");
      markWritten(filePath);
      return {
        ok: true,
        path: filePath,
        insertedAtLine: after_line,
        linesInserted: newLines.length,
        newTotalLines: updated.length,
        bytesWritten: newContent.length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        insertedAtLine: null,
        linesInserted: null,
        newTotalLines: null,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }
  },
});

export const replaceLinesTool = llm.defineTool({
  name: "replace_lines",
  description:
    "Replace an inclusive range of lines with new content. " +
    "Line numbers are 1-indexed and match read_file output. " +
    "Use for surgical edits when you know the exact line range. " +
    "start_line and end_line are both inclusive.",
  validator: z.object({
    path: z.string().describe("File path"),
    start_line: z.number().int().min(1).describe("First line to replace (1-indexed, inclusive)"),
    end_line: z.number().int().min(1).describe("Last line to replace (1-indexed, inclusive)"),
    new_content: z.string().describe("Replacement text (empty string deletes the range)"),
  }),
  tool: async ({ path: filePath, start_line, end_line, new_content }) => {
    try {
      assertInsideProject(filePath);
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }

    if (start_line > end_line) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: `start_line (${start_line}) must be <= end_line (${end_line}).`,
      };
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: `Cannot read file: ${errorMessage(err)}.`,
      };
    }

    const lines = raw.split("\n");
    if (end_line > lines.length) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: `end_line=${end_line} is beyond the file's ${lines.length} lines.`,
      };
    }

    const numberedError = rejectNumberedContent("replace_lines", new_content);
    if (numberedError) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: numberedError,
      };
    }

    const newLines = new_content === "" ? [] : new_content.split("\n");
    const linesReplaced = end_line - start_line + 1;
    const updated = [
      ...lines.slice(0, start_line - 1),
      ...newLines,
      ...lines.slice(end_line),
    ];

    const approved = await confirm(
      `\n[replace_lines] ${filePath}: replace lines ${start_line}-${end_line} (${linesReplaced} lines). Allow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: "User denied replace permission.",
      };
    }

    try {
      await historyManager.snapshot(filePath, `replace_lines: ${filePath}`);
      const newContent = updated.join("\n");
      await writeFile(filePath, newContent, "utf-8");
      markWritten(filePath);
      return {
        ok: true,
        path: filePath,
        replacedLines: `${start_line}-${end_line}`,
        linesReplaced,
        newTotalLines: updated.length,
        bytesWritten: newContent.length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        replacedLines: null,
        linesReplaced: null,
        newTotalLines: null,
        bytesWritten: null,
        error: errorMessage(err),
      };
    }
  },
});

export const deleteFileTool = llm.defineTool({
  name: "delete_file",
  description: "Delete a file. Use sparingly; this cannot be undone.",
  validator: z.object({
    path: z.string().describe("File path to delete"),
  }),
  tool: async ({ path: filePath }) => {
    try {
      assertInsideProject(filePath);
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        error: errorMessage(err),
      };
    }

    const approved = await confirm(
      `\n[delete_file] ${filePath}. This cannot be undone. Allow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        error: "User denied delete permission.",
      };
    }

    try {
      await historyManager.snapshot(filePath, `delete_file: ${filePath}`);
      await unlink(filePath);
      return {
        ok: true,
        path: filePath,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        error: errorMessage(err),
      };
    }
  },
});
