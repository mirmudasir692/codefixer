import * as readline from "node:readline/promises";
import { MODEL_ID } from "./agent.js";
import { runTurn } from "./loop.js";
import { resetSession } from "./session.js";
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

  logger.info(`Codefixer (${MODEL_ID}) — type 'exit' to quit.\n`);

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
