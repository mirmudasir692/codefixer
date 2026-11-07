import { runTurn } from "../loop.js";
import { verifyGoal, formatVerificationFailure } from "./verify.js";
import { appendAndCompact, formatTurnTranscript } from "./context.js";
import type { Goal, LoopConfig, LoopResult } from "./types.js";

export async function runGoalLoop(
  goal: Goal,
  config: LoopConfig = {},
): Promise<LoopResult> {
  const maxTurns = config.maxTurns ?? 10;
  const maxHistoryChars = config.maxHistoryChars ?? 6000;
  const headChars = config.headChars ?? 1500;
  const verbose = config.verbose ?? true;

  let history = "";
  let lastAnswer = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    console.log(`\n━━━ Turn ${turn}/${maxTurns} ━━━`);
    if (goal.description) console.log(`Goal: ${goal.description}`);

  const turnPrompt =
  turn === 1
    ? `Goal: ${goal.prompt}\n\nBefore acting, briefly outline your plan (1-3 sentences). Then execute it step by step.`
    : "Continue. Fix the verification failure shown above.";
    
    let answer: string;
    let toolRounds = 0;
    try {
      const result = await runTurn(turnPrompt, history);
      answer = result.text;
      toolRounds = result.toolRounds;
      lastAnswer = answer;
    } catch (err: any) {
      console.error(`\n[turn error] ${err.message}`);
      return { status: "aborted", turns: turn, history, lastAnswer };
    }

    history = appendAndCompact(
      history,
      formatTurnTranscript(turn, turnPrompt, answer, toolRounds),
      maxHistoryChars,
      headChars,
    );

    if (!goal.verifyCommand) {
      return { status: "completed", turns: turn, history, lastAnswer };
    }

    if (verbose) console.log(`\n[verify] ${goal.verifyCommand}`);
    const verification = await verifyGoal(goal);

    if (verification.ok) {
      console.log(`\n[✓ verification passed on turn ${turn}]`);
      return { status: "completed", turns: turn, history, lastAnswer };
    }

    const failure = formatVerificationFailure(verification);
    console.log(
      `\n[✗ verification failed — exit ${verification.exitCode}]\n` +
        failure.slice(0, 800),
    );

    history = appendAndCompact(
      history,
      `### Verification after turn ${turn}\n${failure}`,
      maxHistoryChars,
      headChars,
    );
  }

  console.log(`\n[!] Reached maxTurns (${maxTurns}) without passing verification.`);
  return { status: "turn_limit", turns: maxTurns, history, lastAnswer };
}