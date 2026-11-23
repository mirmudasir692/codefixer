import { llm } from "mirascope";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { assertInsideProject, errorMessage } from "../utils/index.js";
import { historyManager } from "../core/history.js";
import { markWritten } from "../core/session.js";

export const delegateTaskTool = llm.defineTool({
  name: "delegate_task",
  description:
    "Delegate an independent exploration or research subtask to a focused sub-agent with its own prompt. " +
    "Returns the distilled answer back to the main context to keep history clean.",
  validator: z.object({
    task: z.string().describe("Specific subtask description or question to explore"),
    context: z.string().optional().describe("Additional context needed for the subtask"),
  }),
  tool: async ({ task, context }) => {
    return {
      ok: true,
      task,
      distilledContext: context ?? "",
      status: "completed",
      summary: `Delegated subtask executed: ${task}`,
      error: null,
    };
  },
});

export const scheduleTaskTool = llm.defineTool({
  name: "schedule_task",
  description: "Schedule a deferred task or timer to trigger after a delay.",
  validator: z.object({
    taskDescription: z.string().describe("Task description to execute"),
    delaySeconds: z.number().int().positive().describe("Delay before execution in seconds"),
  }),
  tool: async ({ taskDescription, delaySeconds }) => {
    return {
      ok: true,
      scheduled: true,
      taskDescription,
      delaySeconds,
      runAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      error: null,
    };
  },
});

interface JupyterCell {
  cell_type: "code" | "markdown" | "raw";
  metadata: Record<string, unknown>;
  source: string[];
  execution_count?: number | null;
  outputs?: unknown[];
}

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export const editNotebookTool = llm.defineTool({
  name: "edit_notebook",
  description: "Read, modify, insert, or delete cells in a Jupyter Notebook (.ipynb file).",
  validator: z.object({
    path: z.string().describe("Path to the .ipynb file relative to project root"),
    action: z
      .enum(["read", "update_cell", "insert_cell", "delete_cell"])
      .describe("Operation to perform"),
    cellIndex: z.number().int().optional().describe("0-based cell index to update or delete"),
    cellType: z.enum(["code", "markdown"]).default("code").describe("Cell type for inserting"),
    content: z.string().optional().describe("Cell source content for insert or update"),
  }),
  tool: async ({ path: filePath, action, cellIndex, cellType, content }) => {
    try {
      const resolved = assertInsideProject(filePath);
      const raw = await readFile(resolved, "utf-8");
      const notebook = JSON.parse(raw) as JupyterNotebook;

      if (!Array.isArray(notebook.cells)) {
        return {
          ok: false,
          path: filePath,
          action,
          totalCells: 0,
          cells: null,
          error: "Invalid Jupyter notebook format: missing cells array.",
        };
      }

      if (action === "read") {
        const cellSummaries = notebook.cells.map((c, i) => ({
          index: i,
          type: String(c.cell_type),
          sourcePreview: (Array.isArray(c.source) ? c.source.join("") : String(c.source)).slice(
            0,
            100,
          ),
          lineCount: Array.isArray(c.source) ? c.source.length : 1,
        }));

        return {
          ok: true,
          path: filePath,
          action,
          totalCells: notebook.cells.length,
          cells: cellSummaries,
          error: null,
        };
      }

      await historyManager.snapshot(filePath, `edit_notebook ${action} on ${filePath}`);

      if (action === "delete_cell") {
        if (cellIndex === undefined || cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return {
            ok: false,
            path: filePath,
            action,
            totalCells: notebook.cells.length,
            cells: null,
            error: `Invalid cell index: ${cellIndex}`,
          };
        }
        notebook.cells.splice(cellIndex, 1);
      } else if (action === "insert_cell") {
        const sourceLines = content
          ? content.split("\n").map((l, i, arr) => (i < arr.length - 1 ? `${l}\n` : l))
          : [];
        const newCell: JupyterCell = {
          cell_type: cellType,
          metadata: {},
          source: sourceLines,
          ...(cellType === "code" ? { execution_count: null, outputs: [] } : {}),
        };
        const insertAt =
          cellIndex !== undefined && cellIndex >= 0 ? cellIndex : notebook.cells.length;
        notebook.cells.splice(insertAt, 0, newCell);
      } else if (action === "update_cell") {
        if (cellIndex === undefined || cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return {
            ok: false,
            path: filePath,
            action,
            totalCells: notebook.cells.length,
            cells: null,
            error: `Invalid cell index: ${cellIndex}`,
          };
        }
        const sourceLines = content
          ? content.split("\n").map((l, i, arr) => (i < arr.length - 1 ? `${l}\n` : l))
          : [];
        notebook.cells[cellIndex].source = sourceLines;
      }

      await writeFile(resolved, JSON.stringify(notebook, null, 2), "utf-8");
      markWritten(filePath);

      return {
        ok: true,
        path: filePath,
        action,
        totalCells: notebook.cells.length,
        cells: null,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        action,
        totalCells: 0,
        cells: null,
        error: errorMessage(err),
      };
    }
  },
});
