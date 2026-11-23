import { llm } from "mirascope";
import { z } from "zod";
import { readFile, writeFile, rename, cp, readdir, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { assertInsideProject, errorMessage, numberLines } from "../utils/index.js";
import { historyManager } from "../core/history.js";
import { markWritten } from "../core/session.js";

const execAsync = promisify(exec);

export const moveFileTool = llm.defineTool({
  name: "move_file",
  description:
    "Move or rename a file or directory from source path to destination path. " +
    "Both paths must remain within the project root.",
  validator: z.object({
    source: z.string().describe("Source file or folder path relative to project root"),
    destination: z.string().describe("Destination path relative to project root"),
    overwrite: z.boolean().default(false).describe("Whether to overwrite destination if it exists"),
  }),
  tool: async ({ source, destination, overwrite }) => {
    try {
      const resolvedSrc = assertInsideProject(source);
      const resolvedDest = assertInsideProject(destination);

      let destExists = false;
      try {
        await stat(resolvedDest);
        destExists = true;
      } catch {}

      if (destExists && !overwrite) {
        return {
          ok: false,
          source,
          destination,
          error: `Destination "${destination}" already exists. Set overwrite: true to replace.`,
        };
      }

      await historyManager.snapshot(source, `move_file (source): ${source} -> ${destination}`);
      if (destExists) {
        await historyManager.snapshot(destination, `move_file (dest overwrite): ${destination}`);
      }

      await mkdir(path.dirname(resolvedDest), { recursive: true });
      await rename(resolvedSrc, resolvedDest);
      markWritten(destination);

      return {
        ok: true,
        source,
        destination,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        source,
        destination,
        error: errorMessage(err),
      };
    }
  },
});

export const copyFileTool = llm.defineTool({
  name: "copy_file",
  description:
    "Copy a file or directory to a new location. " + "Supports recursive copying for directories.",
  validator: z.object({
    source: z.string().describe("Source file or directory path relative to project root"),
    destination: z.string().describe("Destination path relative to project root"),
    overwrite: z.boolean().default(true).describe("Whether to overwrite destination if it exists"),
  }),
  tool: async ({ source, destination, overwrite }) => {
    try {
      const resolvedSrc = assertInsideProject(source);
      const resolvedDest = assertInsideProject(destination);

      let destExists = false;
      try {
        await stat(resolvedDest);
        destExists = true;
      } catch {}

      if (destExists && !overwrite) {
        return {
          ok: false,
          source,
          destination,
          error: `Destination "${destination}" already exists. Set overwrite: true to replace.`,
        };
      }

      if (destExists) {
        await historyManager.snapshot(destination, `copy_file overwrite: ${destination}`);
      }

      await mkdir(path.dirname(resolvedDest), { recursive: true });
      await cp(resolvedSrc, resolvedDest, {
        recursive: true,
        force: overwrite,
      });

      markWritten(destination);

      return {
        ok: true,
        source,
        destination,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        source,
        destination,
        error: errorMessage(err),
      };
    }
  },
});

export const multiEditTool = llm.defineTool({
  name: "multi_edit",
  description:
    "Apply multiple precise targeted text replacements to a single file in one atomic operation. " +
    "Edits are applied sequentially. If any replacement target is not found, the operation safely aborts.",
  validator: z.object({
    path: z.string().describe("File path relative to project root"),
    edits: z
      .array(
        z.object({
          oldText: z.string().describe("Exact text snippet to replace"),
          newText: z.string().describe("Replacement text"),
          replaceAll: z
            .boolean()
            .default(false)
            .describe("Whether to replace all occurrences of oldText or just the first"),
        }),
      )
      .describe("Ordered list of text replacements to apply"),
  }),
  tool: async ({ path: filePath, edits }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const original = await readFile(resolved, "utf-8");

      let current = original;
      const applied: number[] = [];

      for (let i = 0; i < edits.length; i++) {
        const { oldText, newText, replaceAll } = edits[i];
        if (!current.includes(oldText)) {
          return {
            ok: false,
            path: filePath,
            appliedEdits: applied.length,
            totalEdits: edits.length,
            failedIndex: i,
            modified: false,
            message: null,
            error: `Edit #${i + 1} failed: target text not found in "${filePath}".`,
          };
        }

        if (replaceAll) {
          current = current.split(oldText).join(newText);
        } else {
          current = current.replace(oldText, newText);
        }
        applied.push(i);
      }

      if (current === original) {
        return {
          ok: true,
          path: filePath,
          appliedEdits: 0,
          totalEdits: edits.length,
          failedIndex: null,
          modified: false,
          message: "No changes made (replacement content matched existing content).",
          error: null,
        };
      }

      await historyManager.snapshot(filePath, `multi_edit: ${edits.length} edits on ${filePath}`);
      await writeFile(resolved, current, "utf-8");
      markWritten(filePath);

      return {
        ok: true,
        path: filePath,
        appliedEdits: applied.length,
        totalEdits: edits.length,
        failedIndex: null,
        modified: true,
        message: null,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        appliedEdits: 0,
        totalEdits: edits.length,
        failedIndex: null,
        modified: false,
        message: null,
        error: errorMessage(err),
      };
    }
  },
});

export const applyPatchTool = llm.defineTool({
  name: "apply_patch",
  description:
    "Apply a unified diff / patch to a file. Supports standard unified diff chunks (@@ -start,len +start,len @@).",
  validator: z.object({
    path: z.string().describe("File path relative to project root"),
    patch: z.string().describe("Unified diff text to apply"),
  }),
  tool: async ({ path: filePath, patch }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const original = await readFile(resolved, "utf-8");
      const lines = original.split(/\r?\n/);

      const patchLines = patch.split(/\r?\n/);
      let currentLine = 0;
      const resultLines: string[] = [];
      let inHunk = false;

      for (let i = 0; i < patchLines.length; i++) {
        const pl = patchLines[i];
        const hunkMatch = pl.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);

        if (hunkMatch) {
          const oldStart = parseInt(hunkMatch[1], 10) - 1;
          while (currentLine < oldStart && currentLine < lines.length) {
            resultLines.push(lines[currentLine]);
            currentLine++;
          }
          inHunk = true;
          continue;
        }

        if (!inHunk) continue;

        if (pl.startsWith("+")) {
          resultLines.push(pl.slice(1));
        } else if (pl.startsWith("-")) {
          currentLine++;
        } else if (pl.startsWith(" ") || pl === "") {
          if (currentLine < lines.length) {
            resultLines.push(lines[currentLine]);
            currentLine++;
          }
        }
      }

      while (currentLine < lines.length) {
        resultLines.push(lines[currentLine]);
        currentLine++;
      }

      const updated = resultLines.join("\n");
      await historyManager.snapshot(filePath, `apply_patch on ${filePath}`);
      await writeFile(resolved, updated, "utf-8");
      markWritten(filePath);

      return {
        ok: true,
        path: filePath,
        linesChanged: resultLines.length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        linesChanged: 0,
        error: errorMessage(err),
      };
    }
  },
});

export const undoEditTool = llm.defineTool({
  name: "undo_edit",
  description:
    "Revert the last edit made to the repository, or revert edits for a specific file back to its previous checkpoint snapshot.",
  validator: z.object({
    path: z
      .string()
      .optional()
      .describe(
        "Optional specific file to revert. If omitted, reverts the most recent checkpoint.",
      ),
  }),
  tool: async ({ path: filePath }) => {
    try {
      if (filePath) {
        const res = await historyManager.revertFile(filePath);
        return {
          ok: res.ok,
          path: filePath,
          filesReverted: res.filesReverted,
          checkpointId: res.checkpointId ?? null,
          error: res.error ?? null,
        };
      }

      const res = await historyManager.revertLast();
      return {
        ok: res.ok,
        path: null,
        filesReverted: res.filesReverted,
        checkpointId: res.checkpointId ?? null,
        error: res.error ?? null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath ?? null,
        filesReverted: [],
        checkpointId: null,
        error: errorMessage(err),
      };
    }
  },
});

export const readManyFilesTool = llm.defineTool({
  name: "read_many_files",
  description:
    "Batch-read multiple text files in one turn. " +
    "Efficient for reading multiple configuration or source files without round-trips.",
  validator: z.object({
    paths: z.array(z.string()).describe("List of file paths relative to project root"),
    maxLinesPerFile: z
      .number()
      .int()
      .default(500)
      .describe("Maximum lines to return per file (default: 500)"),
  }),
  tool: async ({ paths, maxLinesPerFile }) => {
    const results: Array<{
      path: string;
      ok: boolean;
      totalLines: number | null;
      content: string | null;
      truncated: boolean;
      error: string | null;
    }> = [];

    for (const filePath of paths) {
      try {
        const resolved = assertInsideProject(filePath);
        const raw = await readFile(resolved, "utf-8");
        const lines = raw.split(/\r?\n/);
        const totalLines = lines.length;
        const truncated = lines.length > maxLinesPerFile;
        const selectedLines = lines.slice(0, maxLinesPerFile);

        results.push({
          path: filePath,
          ok: true,
          totalLines,
          truncated,
          content: numberLines(selectedLines, 1),
          error: null,
        });
      } catch (err: unknown) {
        results.push({
          path: filePath,
          ok: false,
          totalLines: null,
          truncated: false,
          content: null,
          error: errorMessage(err),
        });
      }
    }

    return {
      ok: true,
      files: results,
      count: results.length,
      successCount: results.filter((r) => r.ok).length,
      error: null,
    };
  },
});

const DEFAULT_TREE_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".gemini",
  "coverage",
  ".turbo",
  ".next",
  "build",
  ".codefixer",
]);

export const treeTool = llm.defineTool({
  name: "tree",
  description:
    "Generate a formatted visual ASCII directory tree. " +
    "Shows hierarchy, file names, and directory structure with depth limit.",
  validator: z.object({
    path: z.string().default(".").describe("Directory to render tree for (default: '.')"),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Maximum tree depth (default: 3)"),
    showFiles: z.boolean().default(true).describe("Whether to include files or only directories"),
  }),
  tool: async ({ path: dirPath, maxDepth, showFiles }) => {
    try {
      const resolved = assertInsideProject(dirPath);
      const rootName = path.basename(resolved) || dirPath;

      const lines: string[] = [rootName];

      async function buildTree(currentDir: string, prefix: string, depth: number) {
        if (depth > maxDepth) return;

        let entries: Array<{ name: string; isDir: boolean }>;
        try {
          const dirents = await readdir(currentDir, { withFileTypes: true });
          entries = dirents
            .filter((d) => !DEFAULT_TREE_IGNORES.has(d.name) && !d.name.startsWith("."))
            .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
        } catch {
          return;
        }

        const filtered = showFiles ? entries : entries.filter((e) => e.isDir);

        for (let i = 0; i < filtered.length; i++) {
          const entry = filtered[i];
          const isLast = i === filtered.length - 1;
          const branch = isLast ? "└── " : "├── ";
          const nextPrefix = prefix + (isLast ? "    " : "│   ");

          lines.push(`${prefix}${branch}${entry.name}${entry.isDir ? "/" : ""}`);

          if (entry.isDir) {
            await buildTree(path.join(currentDir, entry.name), nextPrefix, depth + 1);
          }
        }
      }

      await buildTree(resolved, "", 1);

      return {
        ok: true,
        path: dirPath,
        tree: lines.join("\n"),
        totalEntries: lines.length - 1,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: dirPath,
        tree: "",
        totalEntries: 0,
        error: errorMessage(err),
      };
    }
  },
});

export const diffFilesTool = llm.defineTool({
  name: "diff_files",
  description:
    "Show the unified diff between two files, or between the current working copy of a file/project and git HEAD.",
  validator: z.object({
    pathA: z.string().describe("First file path, or file to diff against git"),
    pathB: z
      .string()
      .optional()
      .describe("Second file path to compare against. If omitted, diffs pathA against git HEAD."),
  }),
  tool: async ({ pathA, pathB }) => {
    try {
      const resolvedA = assertInsideProject(pathA);

      if (pathB) {
        const resolvedB = assertInsideProject(pathB);
        const contentA = await readFile(resolvedA, "utf-8");
        const contentB = await readFile(resolvedB, "utf-8");

        const linesA = contentA.split(/\r?\n/);
        const linesB = contentB.split(/\r?\n/);

        const diffLines: string[] = [`--- ${pathA}`, `+++ ${pathB}`];
        const maxLines = Math.max(linesA.length, linesB.length);
        let hasDiff = false;

        for (let i = 0; i < maxLines; i++) {
          const a = linesA[i];
          const b = linesB[i];
          if (a === b) {
            // Unchanged
          } else {
            hasDiff = true;
            if (a !== undefined) diffLines.push(`-${i + 1}: ${a}`);
            if (b !== undefined) diffLines.push(`+${i + 1}: ${b}`);
          }
        }

        return {
          ok: true,
          mode: "file-to-file",
          hasDiff,
          diff: diffLines.join("\n"),
          error: null,
        };
      }

      // Git diff mode
      try {
        const { stdout } = await execAsync(`git diff HEAD -- "${pathA}"`, {
          cwd: process.cwd(),
          timeout: 10_000,
        });

        return {
          ok: true,
          mode: "git-diff",
          hasDiff: stdout.trim().length > 0,
          diff: stdout.trim() || "(No changes compared to git HEAD)",
          error: null,
        };
      } catch (err: unknown) {
        return {
          ok: false,
          mode: "git-diff",
          hasDiff: false,
          diff: "",
          error: `git diff failed: ${errorMessage(err)}`,
        };
      }
    } catch (err: unknown) {
      return {
        ok: false,
        mode: "unknown",
        hasDiff: false,
        diff: "",
        error: errorMessage(err),
      };
    }
  },
});
