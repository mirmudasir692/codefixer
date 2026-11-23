import { llm } from "mirascope";
import { allTools } from "../tools/index.js";
import type { ConfiguredModel } from "../types/index.js";
import {
  getProviderLabel,
  getActiveModelName,
  getConfiguredModel,
  setActiveModelName,
} from "./models.js";
import { getActiveTui } from "../ui/tui.js";
import { logger } from "../utils/logger.js";

export let MODEL_ID = process.env.CODEFIXER_MODEL ?? "";

let activeConfiguredModel: ConfiguredModel | null = null;

export function getActiveConfiguredModel(): ConfiguredModel | null {
  return activeConfiguredModel;
}

export function getActiveConfiguredModelName(): string | null {
  return activeConfiguredModel ? activeConfiguredModel.name : null;
}

export function setActiveConfiguredModel(model: ConfiguredModel | null): void {
  activeConfiguredModel = model;
}

export function activateConfiguredModel(model: ConfiguredModel): string {
  const provider = new llm.OpenAIProvider({
    baseURL: model.url,
    apiKey: model.apiKey || process.env.OPENAI_API_KEY || "dummy-key",
  });
  (
    provider as unknown as {
      completionsProvider: { requestModelName?: (name: string) => string };
    }
  ).completionsProvider.requestModelName = () => model.name;

  const sanitized = model.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const scope = `custom-${sanitized}/`;
  llm.registerProvider(provider, { scope });

  const formatted = `${scope}${model.name}`;
  MODEL_ID = formatted;
  activeConfiguredModel = model;
  codeAgent = createCodeAgent(formatted);

  setActiveModelName(model.name).catch(() => {});

  const tui = getActiveTui();
  if (tui?.isActive) {
    tui.setStatus({
      model: model.name,
      provider: getProviderLabel(model.url),
    });
  }

  logger.info(`\n✓ Switched model to ${model.name} (${model.url})\n`);
  return formatted;
}

export async function initActiveModel(): Promise<void> {
  if (process.env.CODEFIXER_MODEL) return;
  try {
    const activeName = await getActiveModelName();
    if (activeName) {
      const model = await getConfiguredModel(activeName);
      if (model) {
        activateConfiguredModel(model);
      }
    }
  } catch {}
}

export function createCodeAgent(model = MODEL_ID) {
  if (!model) {
    throw new Error("No model configured. Please run /configure-model or set CODEFIXER_MODEL.");
  }
  return llm.defineCall<{
    history: string;
    input: string;
  }>({
    model,
    maxTokens: 2048,
    temperature: 0,
    tools: allTools,
    template: ({ history, input }) =>
      `
You are Codefixer, an expert AI terminal coding assistant running directly inside the user's project.
Current working directory: ${process.cwd()}

${history ? `# Conversation History\n${history}\n` : ""}

# User Request
${input}

CRITICAL RULES:
1. Autonomous Repository Inspection:
   - You are executing inside the user's actual project directory at "${process.cwd()}".
   - When asked what the project is about, how something works, or to explain the codebase: DO NOT stop after just listing directories! Inspect the directory structure AND read key manifest or documentation files (such as package.json, README.md, config files, or main source files) to understand what the application actually does, its tech stack, features, and purpose.
   - Use glob to find files matching specific patterns (e.g. "**/*.ts", "src/**/*.json") instead of recursively walking directories.
   - Use grep to search file contents for function definitions, classes, variables, or error strings across the codebase before reading entire files.
   - Use file_outline to quickly inspect top-level symbols, exports, classes, and function signatures in a file without reading entire large files.
   - Never stop with vague guesses like "it looks like the project might involve a backend" without reading the files first.
   - Never ask "Would you like me to proceed?" or "Do you have a specific file you want to inspect?". Act autonomously, inspect the relevant files, and provide a comprehensive, accurate answer.

2. Code Changes & Fixes:
   - Inspect the relevant code first, make precise targeted edits, and verify results.
   - For file edits, prefer edit_file for targeted modifications; only use write_file for new files or complete rewrites.

3. Quality of Responses:
   - Give complete, helpful answers with context and depth.
   - Format cleanly with bullet points, short section titles, and backticks for filenames and identifiers.
   - Be direct, professional, and accurate.

4. Tool Rules:
   - Read a file once; do not repeatedly read the same file.
   - Use strict JSON arguments for tool calls.
   - When the user asks an informational question, answer in plain text after gathering context with inspection tools.
   - When code changes are complete and verified, call finish with a concise summary.
`.trim(),
  });
}

export let codeAgent = MODEL_ID ? createCodeAgent(MODEL_ID) : null;

export function setModel(newModel: string): string {
  activeConfiguredModel = null;
  const formatted = newModel.startsWith("ollama/") ? newModel : `ollama/${newModel}`;
  MODEL_ID = formatted;
  codeAgent = createCodeAgent(formatted);
  return formatted;
}
