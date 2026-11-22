import { llm } from "mirascope";
import { allTools } from "../tools/index.js";
import { getProviderLabel, getActiveModelName, getConfiguredModel, setActiveModelName, } from "./models.js";
import { getActiveTui } from "../ui/tui.js";
import { logger } from "../utils/logger.js";
export let MODEL_ID = process.env.CODEFIXER_MODEL ?? "";
let activeConfiguredModel = null;
export function getActiveConfiguredModel() {
    return activeConfiguredModel;
}
export function getActiveConfiguredModelName() {
    return activeConfiguredModel ? activeConfiguredModel.name : null;
}
export function setActiveConfiguredModel(model) {
    activeConfiguredModel = model;
}
export function activateConfiguredModel(model) {
    const provider = new llm.OpenAIProvider({
        baseURL: model.url,
        apiKey: model.apiKey || process.env.OPENAI_API_KEY || "dummy-key",
    });
    provider.completionsProvider.requestModelName = () => model.name;
    const sanitized = model.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const scope = `custom-${sanitized}/`;
    llm.registerProvider(provider, { scope });
    const formatted = `${scope}${model.name}`;
    MODEL_ID = formatted;
    activeConfiguredModel = model;
    codeAgent = createCodeAgent(formatted);
    setActiveModelName(model.name).catch(() => { });
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
export async function initActiveModel() {
    if (process.env.CODEFIXER_MODEL)
        return;
    try {
        const activeName = await getActiveModelName();
        if (activeName) {
            const model = await getConfiguredModel(activeName);
            if (model) {
                activateConfiguredModel(model);
            }
        }
    }
    catch { }
}
export function createCodeAgent(model = MODEL_ID) {
    if (!model) {
        throw new Error("No model configured. Please run /configure-model or set CODEFIXER_MODEL.");
    }
    return llm.defineCall({
        model,
        maxTokens: 2048,
        temperature: 0,
        tools: allTools,
        template: ({ history, input }) => `
You are Codefixer, an expert AI terminal coding assistant. You help developers understand, build, debug, and refactor code directly in their terminal.

${history ? `# Conversation History\n${history}\n` : ""}

# User Request
${input}

CRITICAL RULES:
1. Intent Recognition:
   - Question / Overview: When asked what was built, how something works, or to explain code, inspect files using list_directory and read_file. Provide a thorough, well-structured, insightful explanation in plain English. Describe architecture, core concepts, and key features.
   - Code Changes / Fixes: Inspect the relevant code first, make precise targeted edits, and verify results.

2. Quality of Responses:
   - Give complete, helpful answers with context and depth.
   - Format cleanly with bullet points, short section titles, and backticks for filenames and identifiers.
   - Be direct, professional, and accurate.

3. Tool Rules:
   - Read a file once; do not repeatedly read the same file.
   - Use strict JSON arguments for tool calls.
   - For file edits, prefer edit_file for targeted modifications; only use write_file for new files or complete rewrites.
   - When the user asks an informational question, answer in plain text without calling mutation tools.
   - When code changes are complete and verified, call finish with a concise summary.
`.trim(),
    });
}
export let codeAgent = MODEL_ID ? createCodeAgent(MODEL_ID) : null;
export function setModel(newModel) {
    activeConfiguredModel = null;
    const formatted = newModel.startsWith("ollama/") ? newModel : `ollama/${newModel}`;
    MODEL_ID = formatted;
    codeAgent = createCodeAgent(formatted);
    return formatted;
}
