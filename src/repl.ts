import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { MODEL_ID } from "./agent.js";
import { runTurn } from "./loop.js";
import { resetSession } from "./session.js";
import { historyManager } from "./core/history.js";
import { logger, usePromptInterface } from "./utils/index.js";
import { Tui, setActiveTui, type TuiStatus } from "./ui/tui.js";

const MAX_HISTORY_CHARS = 8000;

interface State {
  history: string;
  messageIndex: number;
  messages: { index: number; text: string }[];
}

function newState(): State {
  return { history: "", messageIndex: 0, messages: [] };
}

// Shared command / agent dispatch used by both the TUI and plain readline REPL.
async function handleInput(
  trimmed: string,
  state: State,
  onBusy?: (busy: boolean) => void,
): Promise<boolean> {
  if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
    return true;
  }
  if (!trimmed) return false;

  // Built-in History Management Commands
  if (trimmed === "/help") {
    logger.info("\nAvailable Commands:");
    logger.info("  /messages            List your messages with their change counts");
    logger.info("  /history             Show recent checkpoints");
    logger.info("  /undo                Revert the most recent change");
    logger.info("  /revert <n>          Revert all changes made from message n onward");
    logger.info("  /revert <id>         Revert to a specific checkpoint ID");
    logger.info("  /revert file <path>  Revert a specific file to its previous state");
    logger.info("  exit / quit          Exit the REPL\n");
    return false;
  }

  if (trimmed === "/messages") {
    const checkpoints = await historyManager.getCheckpoints();
    const known = new Map<number, string>();
    for (const m of state.messages) known.set(m.index, m.text);
    for (const cp of checkpoints) {
      if (cp.messageId === undefined) continue;
      if (!known.get(cp.messageId)) {
        known.set(cp.messageId, cp.messageText ?? "(earlier session)");
      }
    }

    if (known.size === 0) {
      logger.info("\nNo messages yet.\n");
    } else {
      logger.info("\nMessages:");
      const sorted = [...known.entries()].sort((a, b) => a[0] - b[0]);
      for (const [index, text] of sorted) {
        const count = checkpoints.filter((c) => c.messageId === index).length;
        const changeLabel =
          count === 0 ? "no changes" : `${count} change${count === 1 ? "" : "s"}`;
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
    } else {
      logger.info("\nRecent Checkpoints:");
      for (const cp of checkpoints) {
        const fileList = cp.files
          .map(
            (f) =>
              `${f.state === "created" ? "+" : f.state === "deleted" ? "-" : "~"} ${f.path}`,
          )
          .join(", ");
        logger.info(
          `  • [${cp.id}] ${new Date(cp.timestamp).toLocaleTimeString()} - ${cp.description} (${fileList})`,
        );
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
      state.history = (
        state.history + `\n(user undid the last change: ${files})\n`
      ).slice(-MAX_HISTORY_CHARS);
    } else {
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
        state.history = (
          state.history + `\n(user reverted ${filePath} to its previous version)\n`
        ).slice(-MAX_HISTORY_CHARS);
      } else {
        logger.warn(result.error ?? `Failed to revert ${filePath}.`);
      }
    } else if (/^\d+$/.test(arg)) {
      const targetMessage = Number(arg);
      const result = await historyManager.revertToMessage(targetMessage);
      if (result.ok) {
        const files = result.filesReverted.length
          ? result.filesReverted.join(", ")
          : "(no files changed)";
        logger.info(
          `\n✓ Reverted all changes from message ${targetMessage} onward: ${files}\n`,
        );
        state.history = (
          state.history +
          `\n(user reverted all file changes made from message ${targetMessage} onward)\n`
        ).slice(-MAX_HISTORY_CHARS);
      } else {
        logger.warn(result.error ?? `Failed to revert message ${targetMessage}.`);
      }
    } else {
      const result = await historyManager.revertToCheckpoint(arg);
      if (result.ok) {
        logger.info(
          `\n✓ Reverted to checkpoint [${arg}]: ${result.filesReverted.join(", ")}\n`,
        );
        state.history = (
          state.history +
          `\n(user reverted to checkpoint ${arg}: ${result.filesReverted.join(", ")})\n`
        ).slice(-MAX_HISTORY_CHARS);
      } else {
        logger.warn(result.error ?? `Failed to revert to ${arg}.`);
      }
    }
    return false;
  }

  // Delegate all general requests to the agent kernel
  state.messageIndex++;
  state.messages.push({ index: state.messageIndex, text: trimmed });
  historyManager.beginMessage(state.messageIndex, trimmed);

  onBusy?.(true);
  try {
    const { text, transcriptLine, toolRounds } = await runTurn(
      trimmed,
      state.history,
    );
    if (text) {
      logger.info("\n" + text + "\n");
    } else if (toolRounds > 0) {
      logger.info("\n✓ Done.\n");
    }
    state.history = (state.history + "\n" + transcriptLine).slice(
      -MAX_HISTORY_CHARS,
    );
  } catch (err: any) {
    logger.error(err.message);
  } finally {
    onBusy?.(false);
  }
  return false;
}

// --- Status line data -----------------------------------------------------

function getStatus(): TuiStatus {
  let model = MODEL_ID;
  let provider = "";
  const slash = model.indexOf("/");
  if (slash !== -1) {
    const prefix = model.slice(0, slash).toLowerCase();
    model = model.slice(slash + 1);
    if (prefix.startsWith("ollama")) provider = "Ollama";
    else if (prefix.includes("anthropic")) provider = "Anthropic";
    else if (prefix.includes("openai")) provider = "OpenAI";
    else if (prefix.includes("google")) provider = "Google";
    else provider = prefix;
  }

  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Not a git repository — leave the branch blank.
  }

  const home = homedir();
  const cwd = process.cwd();
  const shortCwd = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

  return { mode: "Build", model, provider, cwd: shortCwd, branch };
}

function getVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")).version ?? "";
  } catch {
    return "";
  }
}

// --- REPL implementations -------------------------------------------------

async function startTuiRepl(): Promise<void> {
  const tui = new Tui();
  setActiveTui(tui);
  let exiting = false;
  const exit = () => {
    if (exiting) return;
    exiting = true;
    tui.destroy();
    setActiveTui(null);
    process.exit(0);
  };
  tui.onExit = exit;
  process.on("SIGINT", exit);

  tui.start(getStatus(), getVersion());
  const state = newState();

  try {
    while (!exiting) {
      const input = await tui.prompt("Ask Codefixer anything…");
      if (exiting) break;
      const trimmed = input.trim();
      if (await handleInput(trimmed, state, (busy) => tui.setBusy(busy))) break;
    }
  } finally {
    tui.destroy();
    setActiveTui(null);
    process.off("SIGINT", exit);
  }
}

async function startPlainRepl(): Promise<void> {
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

  logger.info(`Codefixer (${MODEL_ID}) — type 'exit' to quit.`);
  logger.info(`Commands: /messages, /history, /undo, /revert <n>, /help\n`);

  const state = newState();
  const closed = new Promise<null>((resolve) => rl.once("close", () => resolve(null)));

  try {
    while (true) {
      let input: string | null;
      try {
        input = await Promise.race([rl.question("> "), closed]);
      } catch (err: any) {
        if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
          logger.info("\nExiting.");
          break;
        }
        throw err;
      }

      if (input === null) {
        logger.info("\nExiting.");
        break;
      }

      if (await handleInput(input.trim(), state)) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
    usePromptInterface(null);
    rl.close();
  }
}

// Interactive terminal REPL — full TUI when attached to a terminal, plain
// readline otherwise (e.g. piped input, CI, or test runners).
export async function startRepl(): Promise<void> {
  resetSession();
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await startTuiRepl();
  } else {
    await startPlainRepl();
  }
}
