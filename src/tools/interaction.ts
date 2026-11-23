import { llm } from "mirascope";
import { z } from "zod";
import { promptInput, logger } from "../utils/index.js";

export const askUserTool = llm.defineTool({
  name: "ask_user",
  description:
    "Ask the user a clarifying question when requirements are ambiguous, or when a high-level architectural decision is needed.",
  validator: z.object({
    question: z.string().describe("The question or choice to ask the user"),
    options: z
      .array(z.string())
      .optional()
      .describe("Optional list of choices for the user to pick from"),
  }),
  tool: async ({ question, options }) => {
    let promptText = question;
    if (options && options.length > 0) {
      promptText += "\n" + options.map((opt, i) => `  ${i + 1}. ${opt}`).join("\n");
    }

    try {
      const answer = await promptInput(`\n[Question from Codefixer]: ${promptText}\nYour answer: `);
      return {
        ok: true,
        question,
        answer: answer.trim(),
        error: null,
      };
    } catch {
      return {
        ok: false,
        question,
        answer: "",
        error: "Failed to read user response.",
      };
    }
  },
});

export const notifyUserTool = llm.defineTool({
  name: "notify_user",
  description:
    "Send a real-time progress update, status message, or milestone alert to the user without completing the turn.",
  validator: z.object({
    message: z.string().describe("Progress message to display to the user"),
    level: z.enum(["info", "warn", "success"]).default("info").describe("Notification level"),
  }),
  tool: async ({ message, level }) => {
    if (level === "warn") {
      logger.warn(message);
    } else {
      logger.info(`ℹ ${message}`);
    }

    return {
      ok: true,
      delivered: true,
      level,
      message,
      error: null,
    };
  },
});
