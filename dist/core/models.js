import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
export function getModelsFilePath() {
    if (process.env.CODEFIXER_MODELS_PATH) {
        return process.env.CODEFIXER_MODELS_PATH;
    }
    return path.join(homedir(), ".codefixer", "models.json");
}
export async function readConfigFile() {
    const filePath = getModelsFilePath();
    try {
        const raw = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { models: parsed };
        }
        if (parsed && typeof parsed === "object") {
            return {
                activeModel: typeof parsed.activeModel === "string" ? parsed.activeModel : undefined,
                models: Array.isArray(parsed.models) ? parsed.models : [],
            };
        }
        return { models: [] };
    }
    catch {
        return { models: [] };
    }
}
export async function writeConfigFile(config) {
    const filePath = getModelsFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
}
export async function loadConfiguredModels() {
    const config = await readConfigFile();
    return config.models;
}
export async function getConfiguredModel(name) {
    const models = await loadConfiguredModels();
    return models.find((m) => m.name.toLowerCase() === name.toLowerCase());
}
export async function saveConfiguredModel(model) {
    const config = await readConfigFile();
    const idx = config.models.findIndex((m) => m.name.toLowerCase() === model.name.toLowerCase());
    if (idx !== -1) {
        config.models[idx] = { ...config.models[idx], ...model };
    }
    else {
        config.models.push(model);
    }
    await writeConfigFile(config);
    return model;
}
export async function deleteConfiguredModel(name) {
    const config = await readConfigFile();
    const initialLen = config.models.length;
    config.models = config.models.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
    if (config.models.length !== initialLen) {
        if (config.activeModel?.toLowerCase() === name.toLowerCase()) {
            delete config.activeModel;
        }
        await writeConfigFile(config);
        return true;
    }
    return false;
}
export async function getActiveModelName() {
    const config = await readConfigFile();
    return config.activeModel;
}
export async function setActiveModelName(name) {
    const config = await readConfigFile();
    config.activeModel = name;
    await writeConfigFile(config);
}
export function normalizeModelUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url)
        return url;
    url = url.replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) {
        url = `http://${url}`;
    }
    try {
        const parsed = new URL(url);
        if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname === "") {
            parsed.pathname = "/v1";
            url = parsed.toString().replace(/\/+$/, "");
        }
    }
    catch { }
    return url;
}
export function getProviderLabel(url) {
    const lower = url.toLowerCase();
    if (lower.includes("ollama") || lower.includes(":11434"))
        return "Ollama";
    if (lower.includes("groq"))
        return "Groq";
    if (lower.includes("openrouter"))
        return "OpenRouter";
    if (lower.includes("together"))
        return "Together";
    if (lower.includes("deepseek"))
        return "DeepSeek";
    if (lower.includes("anthropic"))
        return "Anthropic";
    if (lower.includes("google"))
        return "Google";
    if (lower.includes("openai"))
        return "OpenAI";
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    }
    catch {
        return "Custom";
    }
}
