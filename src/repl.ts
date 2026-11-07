import * as readline from "node:readline/promises";
import { runTurn } from "./loop.js";
import { MODEL_ID } from "./agent.js";  // ← new import

const MAX_HISTORY_CHARS = 6000;

export async function startRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ← was hardcoded "qwen2.5:3b"
  console.log(`Ollama Code Agent (${MODEL_ID}) — type 'exit' to quit.\n`);

  let history = "";

  while (true) {
    const input = await rl.question("> ");
    if (input.trim().toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    try {
      const { text, transcriptLine } = await runTurn(input, history);
      console.log("\n" + text);
      history = (history + "\n" + transcriptLine).slice(-MAX_HISTORY_CHARS);
    } catch (err: any) {
      console.error("\n[error]", err.message, "\n");
    }

    console.log("\n");
  }

  rl.close();
}