import * as readline from "node:readline/promises";
import { MODEL_ID } from "./agent.js";
import { runTurn } from "./loop.js";
import { runGoalLoop } from "./harness/loop.js";
import { verifyGoal } from "./harness/verify.js";
import { looksLikeAction, detectVerifyCommand } from "./harness/auto.js";
import type { Goal } from "./harness/types.js";

const MAX_HISTORY_CHARS = 6000;
const AUTO_MAX_TURNS = 10;

export async function startRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`Ollama Code Agent (${MODEL_ID}) — type 'exit' to quit.\n`);
  console.log(`Modes:`);
  console.log(`  <prompt>              single turn (read / explain)`);
  console.log(`  <action prompt>       auto-loop until verify passes`);
  console.log(`    e.g. "implement X", "add Y", "fix Z"`);
  console.log(`  /goal <prompt> --verify "<cmd>" [--turns N]   explicit loop`);
  console.log(``);

  let history = "";

  while (true) {
    const input = await rl.question("> ");
    if (input.trim().toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    // ── Explicit /goal ─────────────────────────────────────────────────
    if (input.startsWith("/goal ")) {
      const parsed = parseGoalCommand(input);
      if (!parsed) {
        console.log('Usage: /goal <prompt> [--verify "<cmd>"] [--turns N]');
        continue;
      }
      try {
        const result = await runGoalLoop(parsed.goal, {
          maxTurns: parsed.maxTurns ?? 10,
          maxHistoryChars: MAX_HISTORY_CHARS,
        });
        console.log(
          `\n[loop ended: ${result.status} after ${result.turns} turn(s)]`,
        );
        history = result.history;
      } catch (err: any) {
        console.error("\n[loop error]", err.message, "\n");
      }
      continue;
    }

    // ── Auto-route action prompts → goal loop ──────────────────────────
    if (looksLikeAction(input)) {
      const verifyCommand = await detectVerifyCommand();

      // Baseline check: warn if verifier was already failing before this task.
      if (verifyCommand) {
        const baseline = await verifyGoal({ prompt: "", verifyCommand });
        if (!baseline.ok) {
          console.log(
            `[note: \`${verifyCommand}\` was already failing (exit ${baseline.exitCode}) before this task.]`,
          );
        }
        console.log(
          `[auto-loop: I'll keep working until \`${verifyCommand}\` passes. Max ${AUTO_MAX_TURNS} turns.]`,
        );
      } else {
        console.log(
          `[auto-loop: no verifier found — I'll stop when the task looks done. Max ${AUTO_MAX_TURNS} turns.]`,
        );
      }

      try {
        const result = await runGoalLoop(
          {
            prompt: input,
            verifyCommand,
            description: input,
          },
          { maxTurns: AUTO_MAX_TURNS, maxHistoryChars: MAX_HISTORY_CHARS },
        );
        console.log(
          `\n[loop ended: ${result.status} after ${result.turns} turn(s)]`,
        );
        history = result.history;
      } catch (err: any) {
        console.error("\n[loop error]", err.message, "\n");
      }
      continue;
    }

    // ── Single turn (question / explanation) ──────────────────────────
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

function parseGoalCommand(
  input: string,
): { goal: Goal; maxTurns?: number } | null {
  let rest = input.slice(6).trim();
  if (!rest) return null;

  let maxTurns: number | undefined;
  let verifyCommand: string | undefined;

  const turnsMatch = rest.match(/--turns\s+(\d+)/);
  if (turnsMatch) {
    maxTurns = parseInt(turnsMatch[1], 10);
    rest = rest.replace(turnsMatch[0], "").trim();
  }

  const verifyQuoted = rest.match(/--verify\s+"([^"]+)"/);
  const verifyBare = rest.match(/--verify\s+(.+)$/);
  if (verifyQuoted) {
    verifyCommand = verifyQuoted[1];
    rest = rest.replace(verifyQuoted[0], "").trim();
  } else if (verifyBare) {
    verifyCommand = verifyBare[1].trim();
    rest = rest.replace(verifyBare[0], "").trim();
  }

  return {
    goal: { prompt: rest, verifyCommand, description: rest },
    maxTurns,
  };
}