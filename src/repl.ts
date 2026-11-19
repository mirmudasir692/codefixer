import * as readline from "node:readline/promises";
import { MODEL_ID } from "./agent.js";
import { runTurn } from "./loop.js";
import { resetSession } from "./session.js";
import { historyManager } from "./core/history.js";
import { logger } from "./utils/index.js";

const MAX_HISTORY_CHARS = 8000;

// Interactive terminal REPL
export async function startRepl() {
  resetSession();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const onSigint = () => {
    logger.info("\nExiting.");
    rl.close();
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  logger.info(`Codefixer (${MODEL_ID}) — type 'exit' to quit.`);
  logger.info(`Commands: /history (view checkpoints), /undo (revert last change), /help\n`);

  let history = "";

  try {
    while (true) {
      let input: string;
      try {
        input = await rl.question("> ");
      } catch (err: any) {
        if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
          logger.info("\nExiting.");
          break;
        }
        throw err;
      }

      const trimmed = input.trim();
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") break;
      if (!trimmed) continue;

      // Built-in History Management Commands
      if (trimmed === "/help") {
        logger.info("\nAvailable Commands:");
        logger.info("  /history             Show recent checkpoints");
        logger.info("  /undo                Revert the most recent change");
        logger.info("  /revert <id>         Revert to a specific checkpoint ID");
        logger.info("  /revert file <path>  Revert a specific file to its previous state");
        logger.info("  exit / quit          Exit the REPL\n");
        continue;
      }

      if (trimmed === "/history") {
        const checkpoints = await historyManager.listCheckpoints(10);
        if (checkpoints.length === 0) {
          logger.info("\nNo checkpoints recorded yet.\n");
        } else {
          logger.info("\nRecent Checkpoints:");
          for (const cp of checkpoints) {
            const fileList = cp.files.map((f) => `${f.state === "created" ? "+" : f.state === "deleted" ? "-" : "~"} ${f.path}`).join(", ");
            logger.info(`  • [${cp.id}] ${new Date(cp.timestamp).toLocaleTimeString()} - ${cp.description} (${fileList})`);
          }
          logger.info("");
        }
        continue;
      }

      if (trimmed === "/undo") {
        const result = await historyManager.revertLast();
        if (result.ok) {
          logger.info(`\n✓ Reverted change [${result.checkpointId}]: ${result.filesReverted.join(", ")}\n`);
        } else {
          logger.warn(result.error ?? "Failed to revert.");
        }
        continue;
      }

      if (trimmed.startsWith("/revert ")) {
        const arg = trimmed.slice(8).trim();
        if (arg.startsWith("file ")) {
          const filePath = arg.slice(5).trim();
          const result = await historyManager.revertFile(filePath);
          if (result.ok) {
            logger.info(`\n✓ Reverted ${filePath} to previous version.\n`);
          } else {
            logger.warn(result.error ?? `Failed to revert ${filePath}.`);
          }
        } else {
          const result = await historyManager.revertToCheckpoint(arg);
          if (result.ok) {
            logger.info(`\n✓ Reverted to checkpoint [${arg}]: ${result.filesReverted.join(", ")}\n`);
          } else {
            logger.warn(result.error ?? `Failed to revert to ${arg}.`);
          }
        }
        continue;
      }

      // Delegate all general requests to the agent kernel
      try {
        const { text, transcriptLine } = await runTurn(trimmed, history);
        if (text) {
          logger.info("\n" + text + "\n");
        }
        history = (history + "\n" + transcriptLine).slice(-MAX_HISTORY_CHARS);
      } catch (err: any) {
        logger.error(err.message);
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    rl.close();
  }
}
