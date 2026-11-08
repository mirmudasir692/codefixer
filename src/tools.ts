import { llm } from "mirascope";
import { z } from "zod";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as readline from "node:readline/promises";
import path from "node:path";
import { markRead, markWritten, hasBeenRead } from "./session.js";

const execAsync = promisify(exec);

const DEFAULT_READ_LIMIT = 2000;

function truncate(text: string, max = 5000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}

function assertInsideProject(target: string) {
  const root = process.cwd();
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path "${target}" is outside project root.`);
  }
  return resolved;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function confirmDestructive(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === "yes-really";
}

/** Add line-number prefixes so the model can reference exact lines. */
function numberLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)}\t${line}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// read_file — supports offset/limit, and marks the file as read
// ---------------------------------------------------------------------------

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

      markRead(filePath); // ← track for the write_file guard

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

// ---------------------------------------------------------------------------
// run_shell
// ---------------------------------------------------------------------------

export const runShellTool = llm.defineTool({
  name: "run_shell",
  description: "Run a shell command. Use to run tests, builds, or check output.",
  validator: z.object({
    command: z.string().describe("Command to run"),
    cwd: z.string().default(".").describe("Working directory"),
  }),
  tool: async ({ command, cwd }) => {
    try {
      assertInsideProject(cwd);
    } catch (err: unknown) {
      return {
        ok: false,
        command,
        stdout: null,
        stderr: null,
        exitCode: null,
        error: errorMessage(err),
      };
    }

    const approved = await confirm(
      `\n[run_shell] ${command} (cwd: ${cwd})\nAllow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        command,
        stdout: null,
        stderr: null,
        exitCode: null,
        error: "User denied shell permission.",
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return {
        ok: true,
        command,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode: 0,
        error: null,
      };
    } catch (err: any) {
      return {
        ok: false,
        command,
        stdout: truncate(err.stdout ?? ""),
        stderr: truncate(err.stderr ?? errorMessage(err)),
        exitCode: typeof err.code === "number" ? err.code : 1,
        error: errorMessage(err),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// write_file — create new, or overwrite existing ONLY if it has been read
// ---------------------------------------------------------------------------

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

    // ── Detect existing file and its size ────────────────────────────
    let exists = false;
    let existingSize = 0;
    try {
      const existing = await readFile(filePath, "utf-8");
      exists = true;
      existingSize = existing.length;
    } catch {
      // file does not exist — this is a create operation
    }

    // ── GUARD 1: refuse to overwrite an unread file ──────────────────
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

    // ── GUARD 2: warn if new content looks like destructive truncation ──
    if (exists && existingSize > 200 && content.length < existingSize / 2) {
      const dropPct = Math.round((1 - content.length / existingSize) * 100);
      console.log(
        `\n⚠⚠⚠  DESTRUCTIVE WRITE DETECTED\n` +
          `   ${filePath} is ${existingSize} chars on disk.\n` +
          `   You are about to replace it with ${content.length} chars (${dropPct}% smaller).\n` +
          `   First 120 chars of NEW content:\n   "${content.slice(0, 120).replace(/\n/g, "\\n")}"\n` +
          `   This usually means the model hallucinated the file's contents.\n` +
          `   Type "yes-really" to confirm, anything else to abort.`,
      );
      const confirmed = await confirmDestructive(`> `);
      if (!confirmed) {
        return {
          ok: false,
          path: filePath,
          bytesWritten: null,
          error:
            `User denied destructive write to ${filePath}. ` +
            `The file was NOT modified. Use edit_file, insert_file, or replace_lines for partial changes.`,
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

// ---------------------------------------------------------------------------
// edit_file — surgical string replace
// ---------------------------------------------------------------------------

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

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        path: filePath,
        occurrences: 0,
        bytesWritten: null,
        error:
          "old_string not found. Read the file first to see its current content.",
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
      `\n[edit_file] ${filePath} (${occurrences} replacement(s), ${old_string.length} → ${new_string.length} chars). Allow? [y/N] `,
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

// ---------------------------------------------------------------------------
// insert_file — insert content after a specific line number
// ---------------------------------------------------------------------------

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
      .describe(
        "Insert after this line number (1-indexed). 0 = insert at the top of the file.",
      ),
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
        error: `Cannot read file: ${errorMessage(err)}. Use write_file if it does not exist yet.`,
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

// ---------------------------------------------------------------------------
// replace_lines — replace an inclusive line range
// ---------------------------------------------------------------------------

export const replaceLinesTool = llm.defineTool({
  name: "replace_lines",
  description:
    "Replace an inclusive range of lines with new content. " +
    "Line numbers are 1-indexed and match read_file output. " +
    "Use for surgical edits when you know the exact line range. " +
    "start_line and end_line are both inclusive.",
  validator: z.object({
    path: z.string().describe("File path"),
    start_line: z
      .number()
      .int()
      .min(1)
      .describe("First line to replace (1-indexed, inclusive)"),
    end_line: z
      .number()
      .int()
      .min(1)
      .describe("Last line to replace (1-indexed, inclusive)"),
    new_content: z
      .string()
      .describe("Replacement text (can be multi-line, or empty to delete)"),
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

    const newLines = new_content === "" ? [] : new_content.split("\n");
    const linesReplaced = end_line - start_line + 1;
    const updated = [
      ...lines.slice(0, start_line - 1),
      ...newLines,
      ...lines.slice(end_line),
    ];

    const approved = await confirm(
      `\n[replace_lines] ${filePath}: replace lines ${start_line}-${end_line} (${linesReplaced} lines) with ${newLines.length} line(s). Allow? [y/N] `,
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

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// finish
// ---------------------------------------------------------------------------

export const finishTool = llm.defineTool({
  name: "finish",
  description:
    "Call this ONLY when the task is complete AND you have verified it works " +
    "(tests pass, tsc passes, command exits 0, etc.). " +
    "Calling finish ends the agent loop. " +
    "Do NOT call finish if verification is still failing.",
  validator: z.object({
    summary: z.string().describe("One-sentence summary of what you accomplished"),
    files_changed: z
      .array(z.string())
      .describe("Paths of files you created or modified"),
  }),
  tool: async ({ summary, files_changed }) => {
    return {
      ok: true,
      acknowledged: true,
      summary,
      files_changed,
      error: null,
    };
  },
});