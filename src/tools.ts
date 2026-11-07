import { llm } from "mirascope";
import { z } from "zod";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as readline from "node:readline/promises";
import path from "node:path";

const execAsync = promisify(exec);

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
// read_file
// ---------------------------------------------------------------------------

export const readFileTool = llm.defineTool({
  name: "read_file",
  description: "Read a text file. Use before editing or explaining a file.",
  validator: z.object({
    path: z.string().describe("File path relative to project root"),
  }),
  tool: async ({ path: filePath }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const content = await readFile(resolved, "utf-8");
      return {
        ok: true,
        path: filePath,
        content: truncate(content),
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
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
// write_file — create new file or fully overwrite existing
// ---------------------------------------------------------------------------

export const writeFileTool = llm.defineTool({
  name: "write_file",
  description:
    "Create a NEW file or completely overwrite an existing one. " +
    "Prefer edit_file for existing files — this tool replaces the entire contents.",
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

    try {
      await writeFile(filePath, content, "utf-8");
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
// edit_file — surgical replace of a unique substring
// ---------------------------------------------------------------------------

export const editFileTool = llm.defineTool({
  name: "edit_file",
  description:
    "Replace an exact string inside an existing file. Use for targeted edits. " +
    "The old_string must match the file's current content EXACTLY and appear " +
    "exactly once. Read the file first to see its current content.",
  validator: z.object({
    path: z.string().describe("File path"),
    old_string: z
      .string()
      .describe("Exact text to find (must be unique in the file)"),
    new_string: z.string().describe("Replacement text"),
  }),
  tool: async ({ path: filePath, old_string, new_string }) => {
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

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: `Cannot read file: ${errorMessage(err)}. Use write_file if it does not exist yet.`,
      };
    }

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error:
          "old_string not found. Read the file first to see its current content.",
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: `old_string appears ${occurrences} times. Add more surrounding context to make it unique.`,
      };
    }

    const newContent = content.replace(old_string, new_string);

    const approved = await confirm(
      `\n[edit_file] ${filePath} (${old_string.length} → ${new_string.length} chars). Allow? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        bytesWritten: null,
        error: "User denied edit permission.",
      };
    }

    try {
      await writeFile(filePath, newContent, "utf-8");
      return {
        ok: true,
        path: filePath,
        bytesWritten: newContent.length,
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