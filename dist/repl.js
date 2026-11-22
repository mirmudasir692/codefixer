import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { MODEL_ID, codeAgent, setModel, activateConfiguredModel, getActiveConfiguredModel, getActiveConfiguredModelName, initActiveModel, } from "./agent.js";
import { loadConfiguredModels, saveConfiguredModel, getConfiguredModel, normalizeModelUrl, getProviderLabel, } from "./core/models.js";
import { runTurn } from "./loop.js";
import { resetSession } from "./session.js";
import { historyManager } from "./core/history.js";
import { logger, usePromptInterface, promptInput, getVersion } from "./utils/index.js";
import { Tui, setActiveTui, getActiveTui } from "./ui/tui.js";
const MAX_HISTORY_CHARS = 8000;
function newState() {
    return { history: "", messageIndex: 0, messages: [] };
}
async function handleInput(trimmed, state, onBusy) {
    if (trimmed === "/exit" ||
        trimmed === "/quit" ||
        trimmed.toLowerCase() === "exit" ||
        trimmed.toLowerCase() === "quit") {
        return true;
    }
    if (!trimmed)
        return false;
    if (trimmed === "/clear") {
        const tui = getActiveTui();
        if (tui?.isActive) {
            tui.clear();
        }
        else {
            console.clear();
        }
        return false;
    }
    if (trimmed === "/help") {
        logger.info("\nAvailable Commands:");
        logger.info("  /model [name]        View current model or switch (e.g. /model qwen2.5:7b)");
        logger.info("  /models [name]       List and choose configured models");
        logger.info("  /configure-model     Add and configure a new model (URL, API key, name)");
        logger.info("  /messages            List your messages with their change counts");
        logger.info("  /history             Show recent checkpoints");
        logger.info("  /undo                Revert the most recent change");
        logger.info("  /revert <n>          Revert all changes made from message n onward");
        logger.info("  /revert <id>         Revert to a specific checkpoint ID");
        logger.info("  /revert file <path>  Revert a specific file to its previous state");
        logger.info("  exit / quit          Exit the REPL\n");
        return false;
    }
    if (trimmed === "/configure-model" || trimmed.startsWith("/configure-model ")) {
        logger.info("\n--- Configure Model ---");
        const rawUrl = await promptInput("Model URL (e.g. http://localhost:11434/v1 or https://api.openai.com/v1): ");
        if (!rawUrl) {
            logger.warn("Model URL cannot be empty. Aborted.\n");
            return false;
        }
        const url = normalizeModelUrl(rawUrl);
        const apiKey = await promptInput("API Key (leave blank if not required): ");
        const name = await promptInput("Model Name (e.g. qwen2.5:7b, gpt-4o): ");
        if (!name) {
            logger.warn("Model name cannot be empty. Aborted.\n");
            return false;
        }
        const model = {
            name,
            url,
            apiKey: apiKey || undefined,
            createdAt: Date.now(),
        };
        await saveConfiguredModel(model);
        logger.info(`\n✓ Model "${model.name}" configured and saved successfully!`);
        logger.info(`Choose it anytime using /models or /models ${model.name}\n`);
        return false;
    }
    if (trimmed === "/models" || trimmed.startsWith("/models ")) {
        const arg = trimmed.slice(7).trim();
        const models = await loadConfiguredModels();
        if (models.length === 0) {
            logger.info("\nNo configured models found.");
            logger.info("Use /configure-model to add a model.\n");
            return false;
        }
        if (arg) {
            if (/^\d+$/.test(arg)) {
                const idx = parseInt(arg, 10) - 1;
                if (idx >= 0 && idx < models.length) {
                    activateConfiguredModel(models[idx]);
                    return false;
                }
                logger.warn(`Invalid model index "${arg}". Choose 1 to ${models.length}.\n`);
                return false;
            }
            const match = models.find((m) => m.name.toLowerCase() === arg.toLowerCase());
            if (match) {
                activateConfiguredModel(match);
                return false;
            }
            logger.warn(`Model "${arg}" not found in configured models.\n`);
            return false;
        }
        logger.info("\nConfigured Models:");
        const currentActive = getActiveConfiguredModelName() ?? MODEL_ID;
        models.forEach((m, idx) => {
            const isActive = m.name.toLowerCase() === currentActive.toLowerCase() ||
                MODEL_ID.endsWith(`/${m.name}`) ||
                MODEL_ID === m.name;
            const marker = isActive ? " [active]" : "";
            logger.info(`  ${idx + 1}. ${m.name} (${m.url})${marker}`);
        });
        logger.info("");
        const choice = await promptInput(`Select a model (1-${models.length} or name, or press Enter to cancel): `, `1-${models.length} or model name`);
        if (!choice) {
            return false;
        }
        if (/^\d+$/.test(choice)) {
            const idx = parseInt(choice, 10) - 1;
            if (idx >= 0 && idx < models.length) {
                activateConfiguredModel(models[idx]);
                return false;
            }
            logger.warn(`Invalid selection: ${choice}.\n`);
            return false;
        }
        const match = models.find((m) => m.name.toLowerCase() === choice.toLowerCase());
        if (match) {
            activateConfiguredModel(match);
            return false;
        }
        logger.warn(`Model "${choice}" not found.\n`);
        return false;
    }
    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
        const target = trimmed.slice(6).trim();
        if (!target) {
            const activeConf = getActiveConfiguredModel();
            const currentName = activeConf ? `${activeConf.name} (${activeConf.url})` : MODEL_ID;
            logger.info(`\nActive Model: ${currentName}`);
            logger.info("To switch, run: /model <name> or use /models to view/choose configured models\n");
        }
        else {
            const configured = await getConfiguredModel(target);
            if (configured) {
                activateConfiguredModel(configured);
            }
            else {
                const updated = setModel(target);
                const tui = getActiveTui();
                if (tui?.isActive) {
                    tui.setStatus(getStatus());
                }
                logger.info(`\n✓ Switched model to ${updated}\n`);
            }
        }
        return false;
    }
    if (trimmed === "/messages") {
        const checkpoints = await historyManager.getCheckpoints();
        const known = new Map();
        for (const m of state.messages)
            known.set(m.index, m.text);
        for (const cp of checkpoints) {
            if (cp.messageId === undefined)
                continue;
            if (!known.get(cp.messageId)) {
                known.set(cp.messageId, cp.messageText ?? "(earlier session)");
            }
        }
        if (known.size === 0) {
            logger.info("\nNo messages yet.\n");
        }
        else {
            logger.info("\nMessages:");
            const sorted = [...known.entries()].sort((a, b) => a[0] - b[0]);
            for (const [index, text] of sorted) {
                const count = checkpoints.filter((c) => c.messageId === index).length;
                const changeLabel = count === 0 ? "no changes" : `${count} change${count === 1 ? "" : "s"}`;
                logger.info(`  ${index}. ${text}  (${changeLabel})`);
            }
            logger.info("");
        }
        return false;
    }
    if (trimmed === "/history") {
        const checkpoints = await historyManager.listCheckpoints(10);
        if (checkpoints.length === 0) {
            logger.info("\nNo checkpoints recorded yet.\n");
        }
        else {
            logger.info("\nRecent Checkpoints:");
            for (const cp of checkpoints) {
                const fileList = cp.files
                    .map((f) => `${f.state === "created" ? "+" : f.state === "deleted" ? "-" : "~"} ${f.path}`)
                    .join(", ");
                logger.info(`  • [${cp.id}] ${new Date(cp.timestamp).toLocaleTimeString()} - ${cp.description} (${fileList})`);
            }
            logger.info("");
        }
        return false;
    }
    if (trimmed === "/undo") {
        const result = await historyManager.revertLast();
        if (result.ok) {
            const files = result.filesReverted.join(", ");
            logger.info(`\n✓ Reverted change [${result.checkpointId}]: ${files}\n`);
            state.history = (state.history + `\n(user undid the last change: ${files})\n`).slice(-MAX_HISTORY_CHARS);
        }
        else {
            logger.warn(result.error ?? "Failed to revert.");
        }
        return false;
    }
    if (trimmed === "/revert") {
        logger.info("\nUsage:");
        logger.info("  /revert <n>          Revert all changes made from message n onward");
        logger.info("  /revert <id>         Revert to a checkpoint ID");
        logger.info("  /revert file <path>  Revert a specific file");
        logger.info("  /messages            List messages and their changes\n");
        return false;
    }
    if (trimmed.startsWith("/revert ")) {
        const arg = trimmed.slice(8).trim();
        if (arg.startsWith("file ")) {
            const filePath = arg.slice(5).trim();
            const result = await historyManager.revertFile(filePath);
            if (result.ok) {
                logger.info(`\n✓ Reverted ${filePath} to previous version.\n`);
                state.history = (state.history + `\n(user reverted ${filePath} to its previous version)\n`).slice(-MAX_HISTORY_CHARS);
            }
            else {
                logger.warn(result.error ?? `Failed to revert ${filePath}.`);
            }
        }
        else if (/^\d+$/.test(arg)) {
            const targetMessage = Number(arg);
            const result = await historyManager.revertToMessage(targetMessage);
            if (result.ok) {
                const files = result.filesReverted.length
                    ? result.filesReverted.join(", ")
                    : "(no files changed)";
                logger.info(`\n✓ Reverted all changes from message ${targetMessage} onward: ${files}\n`);
                state.history = (state.history +
                    `\n(user reverted all file changes made from message ${targetMessage} onward)\n`).slice(-MAX_HISTORY_CHARS);
            }
            else {
                logger.warn(result.error ?? `Failed to revert message ${targetMessage}.`);
            }
        }
        else {
            const result = await historyManager.revertToCheckpoint(arg);
            if (result.ok) {
                logger.info(`\n✓ Reverted to checkpoint [${arg}]: ${result.filesReverted.join(", ")}\n`);
                state.history = (state.history +
                    `\n(user reverted to checkpoint ${arg}: ${result.filesReverted.join(", ")})\n`).slice(-MAX_HISTORY_CHARS);
            }
            else {
                logger.warn(result.error ?? `Failed to revert to ${arg}.`);
            }
        }
        return false;
    }
    if (!codeAgent && !getActiveConfiguredModel() && !MODEL_ID) {
        logger.warn("\n⚠ No model configured. Please run /configure-model to add an LLM provider and model.\n");
        return false;
    }
    state.messageIndex++;
    state.messages.push({ index: state.messageIndex, text: trimmed });
    historyManager.beginMessage(state.messageIndex, trimmed);
    onBusy?.(true);
    try {
        const { text, transcriptLine, toolRounds } = await runTurn(trimmed, state.history);
        if (text) {
            logger.info("\n" + text + "\n");
        }
        else if (toolRounds > 0) {
            logger.info("\n✓ Done.\n");
        }
        state.history = (state.history + "\n" + transcriptLine).slice(-MAX_HISTORY_CHARS);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(msg);
    }
    finally {
        onBusy?.(false);
    }
    return false;
}
function getStatus() {
    let branch = "";
    try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
            stdio: ["ignore", "pipe", "ignore"],
        })
            .toString()
            .trim();
    }
    catch { }
    const home = homedir();
    const cwd = process.cwd();
    const shortCwd = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const activeConf = getActiveConfiguredModel();
    if (activeConf) {
        return {
            mode: "Build",
            model: activeConf.name,
            provider: getProviderLabel(activeConf.url),
            cwd: shortCwd,
            branch,
        };
    }
    let model = MODEL_ID || "(none)";
    let provider = "";
    if (model !== "(none)") {
        const slash = model.indexOf("/");
        if (slash !== -1) {
            const prefix = model.slice(0, slash).toLowerCase();
            model = model.slice(slash + 1);
            if (prefix.startsWith("ollama"))
                provider = "Ollama";
            else if (prefix.includes("anthropic"))
                provider = "Anthropic";
            else if (prefix.includes("openai"))
                provider = "OpenAI";
            else if (prefix.includes("google"))
                provider = "Google";
            else
                provider = prefix;
        }
    }
    return { mode: "Build", model, provider, cwd: shortCwd, branch };
}
async function startTuiRepl() {
    const tui = new Tui();
    setActiveTui(tui);
    let exiting = false;
    const exit = () => {
        if (exiting)
            return;
        exiting = true;
        tui.destroy();
        setActiveTui(null);
        process.exit(0);
    };
    tui.onExit = exit;
    process.on("SIGINT", exit);
    tui.start(getStatus(), getVersion());
    if (!MODEL_ID && !getActiveConfiguredModel()) {
        tui.print("⚠ No model configured. Run /configure-model to add an LLM provider and model.");
    }
    const state = newState();
    try {
        while (!exiting) {
            const input = await tui.prompt("Ask Codefixer anything…");
            if (exiting)
                break;
            const trimmed = input.trim();
            if (await handleInput(trimmed, state, (busy) => tui.setBusy(busy)))
                break;
        }
    }
    finally {
        tui.destroy();
        setActiveTui(null);
        process.off("SIGINT", exit);
    }
}
async function startPlainRepl() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    usePromptInterface(rl);
    const onSigint = () => {
        logger.info("\nExiting.");
        rl.close();
        process.exit(0);
    };
    process.on("SIGINT", onSigint);
    if (!MODEL_ID && !getActiveConfiguredModel()) {
        logger.warn("No model configured. Run /configure-model to add an LLM provider and model.\n");
    }
    else {
        const activeConf = getActiveConfiguredModel();
        const modelLabel = activeConf ? `${activeConf.name} (${activeConf.url})` : MODEL_ID;
        logger.info(`Codefixer (${modelLabel}) — type 'exit' to quit.`);
    }
    logger.info(`Commands: /models, /configure-model, /messages, /history, /undo, /revert <n>, /help\n`);
    const state = newState();
    const closed = new Promise((resolve) => rl.once("close", () => resolve(null)));
    try {
        while (true) {
            let input;
            try {
                input = await Promise.race([rl.question("> "), closed]);
            }
            catch (err) {
                if (err && typeof err === "object" && ("code" in err || "name" in err)) {
                    const e = err;
                    if (e.code === "ABORT_ERR" || e.name === "AbortError") {
                        logger.info("\nExiting.");
                        break;
                    }
                }
                throw err;
            }
            if (input === null) {
                logger.info("\nExiting.");
                break;
            }
            if (await handleInput(input.trim(), state))
                break;
        }
    }
    finally {
        process.off("SIGINT", onSigint);
        usePromptInterface(null);
        rl.close();
    }
}
export async function startRepl() {
    resetSession();
    await initActiveModel();
    if (process.stdin.isTTY && process.stdout.isTTY) {
        await startTuiRepl();
    }
    else {
        await startPlainRepl();
    }
}
