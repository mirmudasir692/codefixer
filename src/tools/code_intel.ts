import { llm } from "mirascope";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { assertInsideProject, errorMessage } from "../utils/index.js";
import { executeGlob, executeGrep } from "./search.js";

const execAsync = promisify(exec);

export const semanticSearchTool = llm.defineTool({
  name: "semantic_search",
  description:
    "Search the codebase using term frequency and lexical relevance ranking. " +
    "Useful for natural language or conceptual questions like 'where is authentication handled', 'session storage', etc.",
  validator: z.object({
    query: z
      .string()
      .describe(
        "Search query or conceptual description (e.g. 'handle auth token', 'history checkpoints')",
      ),
    path: z.string().default(".").describe("Directory to search within (default: '.')"),
    limit: z
      .number()
      .int()
      .positive()
      .default(10)
      .describe("Maximum ranked results to return (default: 10)"),
  }),
  tool: async ({ query, path: searchPath, limit }) => {
    try {
      assertInsideProject(searchPath);

      const terms = query
        .toLowerCase()
        .replace(/[^a-zA-Z0-9_]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2);

      if (terms.length === 0) {
        return {
          ok: false,
          query,
          totalFound: 0,
          results: [],
          error: "Query contains no searchable keywords.",
        };
      }

      const globResult = await executeGlob({
        pattern: "**/*",
        path: searchPath,
        type: "file",
        limit: 200,
      });

      if (!globResult.ok || !globResult.matches) {
        return {
          ok: false,
          query,
          totalFound: 0,
          results: [],
          error: globResult.error ?? "Failed to scan files.",
        };
      }

      const scoredFiles: Array<{
        file: string;
        score: number;
        matches: Array<{ line: number; text: string; score: number }>;
      }> = [];

      for (const filePath of globResult.matches) {
        let content = "";
        try {
          content = await readFile(path.resolve(process.cwd(), filePath), "utf-8");
        } catch {
          continue;
        }

        const lines = content.split(/\r?\n/);
        let fileScore = 0;
        const lineMatches: Array<{ line: number; text: string; score: number }> = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lower = line.toLowerCase();
          let lineScore = 0;

          for (const term of terms) {
            if (lower.includes(term)) {
              // Higher weight if term is part of a function/class/declaration
              if (/export|function|class|interface|type|const|let|def/.test(line)) {
                lineScore += 3;
              } else {
                lineScore += 1;
              }
            }
          }

          if (lineScore > 0) {
            fileScore += lineScore;
            lineMatches.push({
              line: i + 1,
              text: line.trim().slice(0, 140),
              score: lineScore,
            });
          }
        }

        if (fileScore > 0) {
          lineMatches.sort((a, b) => b.score - a.score);
          scoredFiles.push({
            file: filePath,
            score: fileScore,
            matches: lineMatches.slice(0, 4),
          });
        }
      }

      scoredFiles.sort((a, b) => b.score - a.score);
      const topResults = scoredFiles.slice(0, limit);

      return {
        ok: true,
        query,
        totalFound: scoredFiles.length,
        results: topResults,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        query,
        totalFound: 0,
        results: [],
        error: errorMessage(err),
      };
    }
  },
});

export const listDefinitionsTool = llm.defineTool({
  name: "list_definitions",
  description:
    "Find definition locations (function, class, interface, type, variable) of a given symbol name across project files.",
  validator: z.object({
    symbol: z.string().describe("Symbol or identifier name to find definitions for"),
  }),
  tool: async ({ symbol }) => {
    try {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = `\\b(export\\s+)?(function|class|interface|type|const|let|var|enum)\\s+${escaped}\\b`;

      const grepResult = await executeGrep({
        pattern,
        isRegex: true,
        caseSensitive: true,
        limit: 50,
      });

      if (!grepResult.ok) {
        return {
          ok: false,
          symbol,
          count: 0,
          definitions: [],
          error: grepResult.error,
        };
      }

      const definitions = grepResult.matches.map((m) => ({
        file: m.file,
        line: m.line,
        signature: m.text.trim(),
      }));

      return {
        ok: true,
        symbol,
        count: definitions.length,
        definitions,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        symbol,
        count: 0,
        definitions: [],
        error: errorMessage(err),
      };
    }
  },
});

export const findReferencesTool = llm.defineTool({
  name: "find_references",
  description: "Find all reference usages of a symbol across the project with line numbers.",
  validator: z.object({
    symbol: z.string().describe("Symbol or identifier to find references for"),
    limit: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe("Maximum references to return (default: 50)"),
  }),
  tool: async ({ symbol, limit }) => {
    try {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = `\\b${escaped}\\b`;

      const grepResult = await executeGrep({
        pattern,
        isRegex: true,
        caseSensitive: true,
        limit,
      });

      if (!grepResult.ok) {
        return {
          ok: false,
          symbol,
          total: 0,
          references: [],
          truncated: false,
          error: grepResult.error,
        };
      }

      const references = grepResult.matches.map((m) => ({
        file: m.file,
        line: m.line,
        text: m.text.trim(),
      }));

      return {
        ok: true,
        symbol,
        total: grepResult.totalMatches,
        references,
        truncated: grepResult.truncated,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        symbol,
        total: 0,
        references: [],
        truncated: false,
        error: errorMessage(err),
      };
    }
  },
});

export const getDiagnosticsTool = llm.defineTool({
  name: "get_diagnostics",
  description:
    "Run type checks (tsc) or linter (eslint) on a file or the project to catch TypeScript/lint errors immediately after edits.",
  validator: z.object({
    path: z
      .string()
      .optional()
      .describe("Specific file path relative to project root, or omit for whole project"),
    tool: z
      .enum(["tsc", "eslint", "auto"])
      .default("auto")
      .describe("Which tool to run: 'tsc', 'eslint', or 'auto'"),
  }),
  tool: async ({ path: filePath, tool: checkTool }) => {
    try {
      if (filePath) assertInsideProject(filePath);
      const cwd = process.cwd();

      let command = "";
      if (
        checkTool === "eslint" ||
        (checkTool === "auto" && filePath && /\.(js|ts|tsx|jsx)$/.test(filePath))
      ) {
        command = filePath
          ? `npx eslint "${filePath}" --format json`
          : `npx eslint . --format json`;
      } else {
        command = `npx tsc --noEmit --pretty false`;
      }

      try {
        const { stdout } = await execAsync(command, { cwd, timeout: 30_000 });
        return {
          ok: true,
          hasErrors: false,
          tool: checkTool,
          path: filePath ?? "project",
          output: stdout.trim(),
          error: null,
        };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string };
        const raw = (execErr.stdout || execErr.stderr || "").trim();

        return {
          ok: true,
          hasErrors: true,
          tool: checkTool,
          path: filePath ?? "project",
          output: raw.slice(0, 4000),
          error: null,
        };
      }
    } catch (err: unknown) {
      return {
        ok: false,
        hasErrors: false,
        tool: checkTool,
        path: filePath ?? "project",
        output: "",
        error: errorMessage(err),
      };
    }
  },
});

interface TodoItem {
  id: string;
  task: string;
  status: "pending" | "in_progress" | "completed";
  priority: string | null;
}

const TODO_FILE = path.join(process.cwd(), ".codefixer", "todos.json");

export const todoWriteTool = llm.defineTool({
  name: "todo_write",
  description:
    "Create or update the structured task/TODO list that Codefixer maintains during multi-step jobs.",
  validator: z.object({
    todos: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for task (e.g. 'task-1')"),
          task: z.string().describe("Task description"),
          status: z.enum(["pending", "in_progress", "completed"]).describe("Current status"),
          priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
        }),
      )
      .describe("Full updated list of todos"),
  }),
  tool: async ({ todos }) => {
    try {
      const normalizedTodos: TodoItem[] = todos.map((t) => ({
        id: t.id,
        task: t.task,
        status: t.status,
        priority: t.priority ?? null,
      }));

      await mkdir(path.dirname(TODO_FILE), { recursive: true });
      await writeFile(TODO_FILE, JSON.stringify(normalizedTodos, null, 2), "utf-8");
      return {
        ok: true,
        count: normalizedTodos.length,
        pending: normalizedTodos.filter((t) => t.status === "pending").length,
        inProgress: normalizedTodos.filter((t) => t.status === "in_progress").length,
        completed: normalizedTodos.filter((t) => t.status === "completed").length,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        count: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        error: errorMessage(err),
      };
    }
  },
});

export const todoReadTool = llm.defineTool({
  name: "todo_read",
  description: "Read the current structured TODO list for the session.",
  validator: z.object({}),
  tool: async () => {
    try {
      const raw = await readFile(TODO_FILE, "utf-8");
      const todos = JSON.parse(raw) as TodoItem[];
      const normalized = todos.map((t) => ({
        id: t.id,
        task: t.task,
        status: t.status,
        priority: t.priority ?? null,
      }));
      return {
        ok: true,
        todos: normalized,
        count: normalized.length,
        error: null,
      };
    } catch {
      return {
        ok: true,
        todos: [],
        count: 0,
        error: null,
      };
    }
  },
});

const SCRATCHPAD_FILE = path.join(process.cwd(), ".codefixer", "scratchpad.md");

export const scratchpadTool = llm.defineTool({
  name: "scratchpad",
  description:
    "Persistent memory/scratchpad to record or read notes, hypotheses, and architectural findings across steps or sessions.",
  validator: z.object({
    action: z
      .enum(["read", "write", "append", "clear"])
      .default("read")
      .describe("Action to perform"),
    content: z.string().optional().describe("Content to write or append"),
  }),
  tool: async ({ action, content = "" }) => {
    try {
      await mkdir(path.dirname(SCRATCHPAD_FILE), { recursive: true });

      if (action === "read") {
        try {
          const text = await readFile(SCRATCHPAD_FILE, "utf-8");
          return { ok: true, action: "read", content: text, error: null };
        } catch {
          return { ok: true, action: "read", content: "", error: null };
        }
      }

      if (action === "clear") {
        await writeFile(SCRATCHPAD_FILE, "", "utf-8");
        return { ok: true, action: "clear", content: "", error: null };
      }

      if (action === "append") {
        let existing = "";
        try {
          existing = await readFile(SCRATCHPAD_FILE, "utf-8");
        } catch {}
        const updated = existing ? `${existing}\n${content}` : content;
        await writeFile(SCRATCHPAD_FILE, updated, "utf-8");
        return { ok: true, action: "append", content: updated, error: null };
      }

      // write
      await writeFile(SCRATCHPAD_FILE, content, "utf-8");
      return { ok: true, action: "write", content, error: null };
    } catch (err: unknown) {
      return {
        ok: false,
        action,
        content: "",
        error: errorMessage(err),
      };
    }
  },
});
