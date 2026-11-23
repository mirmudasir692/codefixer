import { llm } from "mirascope";
import { z } from "zod";

export const finishTool = llm.defineTool({
  name: "finish",
  description:
    "Call this ONLY when the task is complete AND you have verified it works " +
    "(tests pass, tsc passes, command exits 0, etc.). " +
    "Calling finish ends the agent loop. " +
    "Do NOT call finish if verification is still failing.",
  validator: z.object({
    summary: z.string().describe("One-sentence summary of what you accomplished"),
    files_changed: z.array(z.string()).describe("Paths of files you created or modified"),
    result: z
      .string()
      .optional()
      .describe("Optional structured result summary or serialized JSON metadata"),
  }),
  tool: async ({ summary, files_changed, result }) => {
    return {
      ok: true,
      acknowledged: true,
      summary,
      files_changed,
      result: result ?? null,
      error: null,
    };
  },
});
