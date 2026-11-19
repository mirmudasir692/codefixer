import { llm } from "mirascope";
import { z } from "zod";
import { historyManager } from "../core/history.js";
import { confirm, errorMessage } from "../utils/index.js";

// Revert a file to its previous state from persistent history
export const revertFileTool = llm.defineTool({
  name: "revert_file",
  description:
    "Revert a file to its previous version before recent edits or changes. " +
    "Use when an edit introduced an error or when the user asks to revert/undo changes to a file.",
  validator: z.object({
    path: z.string().describe("File path to revert"),
  }),
  tool: async ({ path: filePath }) => {
    const approved = await confirm(`\n[revert_file] Revert ${filePath} to previous state? [y/N] `);
    if (!approved) {
      return {
        ok: false,
        path: filePath,
        checkpointId: null,
        filesReverted: [],
        error: "User denied revert permission.",
      };
    }

    try {
      const result = await historyManager.revertFile(filePath);
      return {
        ok: result.ok,
        path: filePath,
        checkpointId: result.checkpointId ?? null,
        filesReverted: result.filesReverted ?? [],
        error: result.error ?? null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        path: filePath,
        checkpointId: null,
        filesReverted: [],
        error: errorMessage(err),
      };
    }
  },
});
