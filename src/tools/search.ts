import { llm } from "mirascope";
import { z } from "zod";
import { glob, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertInsideProject, errorMessage } from "../utils/index.js";

const DEFAULT_IGNORED_DIRS = new Set([
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

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svgz",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".bz2",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".iso",
  ".class",
  ".pyc",
]);

function shouldIgnorePath(relPath: string, customIgnores?: string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (DEFAULT_IGNORED_DIRS.has(seg)) return true;
    if (seg.startsWith(".") && seg !== "." && seg !== "..") return true;
  }
  if (customIgnores && customIgnores.length > 0) {
    for (const pattern of customIgnores) {
      if (!pattern) continue;
      if (normalized.includes(pattern) || segments.includes(pattern)) return true;
    }
  }
  return false;
}

function isBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 2048);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export type GlobResult = {
  ok: boolean;
  pattern: string;
  path: string;
  matches: string[];
  count: number;
  total: number;
  truncated: boolean;
  error: string | null;
};

export async function executeGlob(args: {
  pattern?: string;
  path?: string;
  type?: "file" | "directory" | "all";
  ignore?: string[];
  limit?: number;
}): Promise<GlobResult> {
  const { pattern = "**/*", path: dirPath = ".", type = "file", ignore, limit = 100 } = args;
  try {
    const resolvedBase = assertInsideProject(dirPath);
    const projectRoot = process.cwd();
    const maxLimit = Math.min(Math.max(1, limit), 500);

    const cleanPattern = pattern.startsWith("./") ? pattern.slice(2) : pattern;

    const matches: string[] = [];
    let totalFound = 0;
    let truncated = false;

    const globIterator = glob(cleanPattern, {
      cwd: resolvedBase,
    });

    for await (const entry of globIterator) {
      const fullPath = path.resolve(resolvedBase, entry);
      const relToProject = path.relative(projectRoot, fullPath);

      if (shouldIgnorePath(relToProject, ignore)) {
        continue;
      }

      try {
        const entryStat = await stat(fullPath);
        const isDir = entryStat.isDirectory();
        const isFile = entryStat.isFile();

        if (type === "file" && !isFile) continue;
        if (type === "directory" && !isDir) continue;

        totalFound++;
        if (matches.length < maxLimit) {
          matches.push(relToProject);
        } else {
          truncated = true;
        }
      } catch {
        // Skip inaccessible entries
      }
    }

    matches.sort((a, b) => a.localeCompare(b));

    return {
      ok: true,
      pattern: cleanPattern,
      path: dirPath,
      matches,
      count: matches.length,
      total: totalFound,
      truncated,
      error: null,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      pattern,
      path: dirPath,
      matches: [],
      count: 0,
      total: 0,
      truncated: false,
      error: errorMessage(err),
    };
  }
}

export const globTool = llm.defineTool({
  name: "glob",
  description:
    "Find files and directories matching a glob pattern (e.g. '**/*.ts', 'src/**/*.{js,ts}', '*.json'). " +
    "Fast and automatically respects standard ignore directories like node_modules, .git, and dist.",
  validator: z.object({
    pattern: z
      .string()
      .default("**/*")
      .describe("Glob pattern to match files or directories (e.g. '**/*.ts', 'src/**/*.json')"),
    path: z
      .string()
      .default(".")
      .describe("Base directory to search from (relative to project root, default: '.')"),
    type: z
      .enum(["file", "directory", "all"])
      .default("file")
      .describe("Filter results by entry type: 'file' (default), 'directory', or 'all'"),
    ignore: z
      .array(z.string())
      .optional()
      .describe("Additional patterns or folder names to ignore"),
    limit: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe("Maximum number of results to return (default: 100, max: 500)"),
  }),
  tool: async (args) => {
    return await executeGlob(args);
  },
});

export type GrepMatchItem = {
  file: string;
  line: number;
  text: string;
  contextBefore: Array<{ line: number; text: string }> | null;
  contextAfter: Array<{ line: number; text: string }> | null;
};

export type GrepResult = {
  ok: boolean;
  pattern: string;
  path: string;
  matches: GrepMatchItem[];
  totalMatches: number;
  filesSearched: number;
  filesMatched: number;
  truncated: boolean;
  formatted: string;
  error: string | null;
};

export async function executeGrep(args: {
  pattern: string;
  path?: string;
  include?: string;
  ignore?: string[];
  caseSensitive?: boolean;
  isRegex?: boolean;
  contextLines?: number;
  limit?: number;
  maxFileSize?: number;
}): Promise<GrepResult> {
  const {
    pattern,
    path: searchTarget = ".",
    include,
    ignore,
    caseSensitive = false,
    isRegex = true,
    contextLines = 0,
    limit = 100,
    maxFileSize = 1_048_576,
  } = args;

  try {
    const resolvedTarget = assertInsideProject(searchTarget);
    const projectRoot = process.cwd();
    const maxLimit = Math.min(Math.max(1, limit), 300);

    let regex: RegExp;
    try {
      const rawPattern = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = caseSensitive ? "g" : "gi";
      regex = new RegExp(rawPattern, flags);
    } catch (err) {
      return {
        ok: false,
        pattern,
        path: searchTarget,
        matches: [],
        totalMatches: 0,
        filesSearched: 0,
        filesMatched: 0,
        truncated: false,
        formatted: "",
        error: `Invalid regular expression: ${errorMessage(err)}`,
      };
    }

    const targetStat = await stat(resolvedTarget);
    const candidateFiles: string[] = [];

    if (targetStat.isFile()) {
      const ext = path.extname(resolvedTarget).toLowerCase();
      if (!BINARY_EXTENSIONS.has(ext)) {
        candidateFiles.push(resolvedTarget);
      }
    } else if (targetStat.isDirectory()) {
      const filePattern = include || "**/*";
      const cleanFilePattern = filePattern.startsWith("./") ? filePattern.slice(2) : filePattern;

      const globIterator = glob(cleanFilePattern, {
        cwd: resolvedTarget,
      });

      for await (const entry of globIterator) {
        const fullPath = path.resolve(resolvedTarget, entry);
        const relToProject = path.relative(projectRoot, fullPath);

        if (shouldIgnorePath(relToProject, ignore)) {
          continue;
        }

        const ext = path.extname(fullPath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          continue;
        }

        try {
          const entryStat = await stat(fullPath);
          if (entryStat.isFile() && entryStat.size <= maxFileSize) {
            candidateFiles.push(fullPath);
          }
        } catch {
          // Skip inaccessible files
        }
      }
    }

    const matches: GrepMatchItem[] = [];
    const formattedLines: string[] = [];
    let totalMatches = 0;
    let filesMatched = 0;
    let truncated = false;

    for (const filePath of candidateFiles) {
      if (truncated) break;

      const relToProject = path.relative(projectRoot, filePath);
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        continue;
      }

      if (isBinaryBuffer(buffer)) {
        continue;
      }

      const content = buffer.toString("utf-8");
      const lines = content.split(/\r?\n/);
      let fileHadMatch = false;

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        regex.lastIndex = 0;

        if (regex.test(lineText)) {
          totalMatches++;
          fileHadMatch = true;

          const matchItem: GrepMatchItem = {
            file: relToProject,
            line: i + 1,
            text: lineText,
            contextBefore: null,
            contextAfter: null,
          };

          const startCtx = Math.max(0, i - contextLines);
          const endCtx = Math.min(lines.length - 1, i + contextLines);

          if (contextLines > 0) {
            const before: Array<{ line: number; text: string }> = [];
            for (let c = startCtx; c < i; c++) {
              before.push({ line: c + 1, text: lines[c] });
              formattedLines.push(`${relToProject}-${c + 1}- ${lines[c]}`);
            }
            matchItem.contextBefore = before;
          }

          formattedLines.push(`${relToProject}:${i + 1}: ${lineText}`);

          if (contextLines > 0) {
            const after: Array<{ line: number; text: string }> = [];
            for (let c = i + 1; c <= endCtx; c++) {
              after.push({ line: c + 1, text: lines[c] });
              formattedLines.push(`${relToProject}-${c + 1}- ${lines[c]}`);
            }
            matchItem.contextAfter = after;
          }

          matches.push(matchItem);

          if (matches.length >= maxLimit) {
            truncated = true;
            break;
          }
        }
      }

      if (fileHadMatch) {
        filesMatched++;
      }
    }

    return {
      ok: true,
      pattern,
      path: searchTarget,
      matches,
      totalMatches,
      filesSearched: candidateFiles.length,
      filesMatched,
      truncated,
      formatted: formattedLines.join("\n"),
      error: null,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      pattern,
      path: searchTarget,
      matches: [],
      totalMatches: 0,
      filesSearched: 0,
      filesMatched: 0,
      truncated: false,
      formatted: "",
      error: errorMessage(err),
    };
  }
}

export const grepTool = llm.defineTool({
  name: "grep",
  description:
    "Search file contents for regular expressions or text matches. " +
    "Returns matching files, line numbers, line content, and optional context lines. " +
    "Skips binary files and common ignore directories (node_modules, .git, dist).",
  validator: z.object({
    pattern: z.string().describe("Regular expression or literal text to search for inside files"),
    path: z
      .string()
      .default(".")
      .describe("Directory or file to search within (relative to project root)"),
    include: z
      .string()
      .optional()
      .describe("Optional glob pattern to filter files (e.g. '*.ts', 'src/**/*.{js,ts}')"),
    ignore: z
      .array(z.string())
      .optional()
      .describe("Additional patterns or folder names to ignore"),
    caseSensitive: z
      .boolean()
      .default(false)
      .describe("Whether the search is case-sensitive (default: false)"),
    isRegex: z
      .boolean()
      .default(true)
      .describe(
        "Whether to treat pattern as a regular expression (default: true). Set false for literal search.",
      ),
    contextLines: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(0)
      .describe("Number of context lines before and after each match (0-5, default: 0)"),
    limit: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe("Maximum number of matching lines to return (default: 100, max: 300)"),
    maxFileSize: z
      .number()
      .int()
      .default(1_048_576)
      .describe("Maximum file size in bytes to search (default: 1MB)"),
  }),
  tool: async (args) => {
    return await executeGrep(args);
  },
});

export const fileOutlineTool = llm.defineTool({
  name: "file_outline",
  description:
    "Extract code symbols (functions, classes, interfaces, types, exports, methods) and their line numbers from a file. " +
    "Useful for exploring code structure and architecture without reading entire files into context.",
  validator: z.object({
    path: z.string().describe("File path relative to project root"),
  }),
  tool: async ({ path: filePath }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const projectRoot = process.cwd();
      const relToProject = path.relative(projectRoot, resolved);

      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) {
        return {
          ok: false,
          path: filePath,
          language: "unknown",
          totalLines: 0,
          symbols: [],
          error: `Path is not a regular file: ${filePath}`,
        };
      }

      const buffer = await readFile(resolved);
      if (isBinaryBuffer(buffer)) {
        return {
          ok: false,
          path: filePath,
          language: "binary",
          totalLines: 0,
          symbols: [],
          error: "Cannot extract outline from a binary file.",
        };
      }

      const content = buffer.toString("utf-8");
      const lines = content.split(/\r?\n/);
      const ext = path.extname(resolved).toLowerCase();

      let language = "unknown";
      if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) language = "typescript";
      else if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) language = "javascript";
      else if (ext === ".py") language = "python";
      else if (ext === ".go") language = "go";
      else if (ext === ".rs") language = "rust";
      else if (ext === ".json") language = "json";
      else if (ext === ".md") language = "markdown";

      const symbols: Array<{
        name: string;
        kind: "function" | "class" | "interface" | "type" | "variable" | "enum" | "heading";
        line: number;
        signature: string;
      }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*")
        ) {
          continue;
        }

        // TypeScript / JavaScript
        if (language === "typescript" || language === "javascript") {
          let m = trimmed.match(
            /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+))?\s*(\([^)]*\))/,
          );
          if (m) {
            symbols.push({
              name: m[1] || "default (anonymous)",
              kind: "function",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(
            /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/,
          );
          if (m) {
            symbols.push({
              name: m[1],
              kind: "class",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "interface",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(/^(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "type",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(/^(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "enum",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(
            /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
          );
          if (m) {
            symbols.push({
              name: m[1],
              kind: "function",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(/^export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "variable",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }
        } else if (language === "python") {
          let m = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*(\([^)]*\))/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "function",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }

          m = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
          if (m) {
            symbols.push({
              name: m[1],
              kind: "class",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }
        } else if (language === "markdown") {
          const m = trimmed.match(/^(#{1,6})\s+(.+)$/);
          if (m) {
            symbols.push({
              name: m[2],
              kind: "heading",
              line: i + 1,
              signature: trimmed.slice(0, 100),
            });
            continue;
          }
        }
      }

      return {
        ok: true,
        path: relToProject,
        language,
        totalLines: lines.length,
        symbols,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        language: "unknown",
        totalLines: 0,
        symbols: [],
        error: errorMessage(err),
      };
    }
  },
});

export const fileInfoTool = llm.defineTool({
  name: "file_info",
  description:
    "Get detailed metadata about a file or directory (size, line count, permissions, timestamps, preview) without reading the entire file.",
  validator: z.object({
    path: z.string().describe("Path to inspect relative to project root"),
  }),
  tool: async ({ path: targetPath }) => {
    try {
      const resolved = assertInsideProject(targetPath);
      const projectRoot = process.cwd();
      const relToProject = path.relative(projectRoot, resolved);
      const targetStat = await stat(resolved);

      const isDir = targetStat.isDirectory();
      const isFile = targetStat.isFile();
      const isSymlink = targetStat.isSymbolicLink();

      let type: "file" | "directory" | "symlink" | "other" = "other";
      if (isFile) type = "file";
      else if (isDir) type = "directory";
      else if (isSymlink) type = "symlink";

      let totalLines: number | null = null;
      let isBinary = false;
      let preview: string | null = null;

      if (isFile) {
        const ext = path.extname(resolved).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          isBinary = true;
        } else {
          try {
            const buf = await readFile(resolved);
            if (isBinaryBuffer(buf)) {
              isBinary = true;
            } else {
              const text = buf.toString("utf-8");
              const lines = text.split(/\r?\n/);
              totalLines = lines.length;
              preview = lines.slice(0, 15).join("\n");
            }
          } catch {
            // Preview read failure
          }
        }
      }

      return {
        ok: true,
        path: relToProject,
        type,
        sizeBytes: targetStat.size,
        sizeFormatted: formatBytes(targetStat.size),
        totalLines,
        isBinary,
        created: targetStat.birthtime.toISOString(),
        modified: targetStat.mtime.toISOString(),
        preview,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: targetPath,
        type: "other",
        sizeBytes: 0,
        sizeFormatted: "0 B",
        totalLines: null,
        isBinary: false,
        created: "",
        modified: "",
        preview: null,
        error: errorMessage(err),
      };
    }
  },
});
