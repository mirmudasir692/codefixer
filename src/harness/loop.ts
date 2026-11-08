import { runTurn } from "../loop.js";
import { verifyGoal, formatVerificationFailure } from "./verify.js";
import { appendAndCompact, formatTurnTranscript } from "./context.js";
import type { Goal, LoopConfig, LoopResult } from "./types.js";

const HARD_SAFETY_CAP = 20;

export async function runGoalLoop(
  goal: Goal,
  config: LoopConfig = {},
): Promise<LoopResult> {
  const hardCap = config.maxTurns ?? HARD_SAFETY_CAP;
  const maxHistoryChars = config.maxHistoryChars ?? 6000;
  const headChars = config.headChars ?? 1500;
  const verbose = config.verbose ?? true;

  let history = "";
  let lastAnswer = "";
  let turn = 0;

  while (turn < hardCap) {
    turn++;
    console.log(`\n━━━ Turn ${turn} (model controls stop) ━━━`);

    const turnPrompt =
      turn === 1
        ? goal.prompt
        : "Continue. Fix the verification failure shown above, then call finish.";

    let result;
    try {
      result = await runTurn(turnPrompt, history);
    } catch (err: any) {
      console.error(`\n[turn error] ${err.message}`);
      return { status: "aborted", turns: turn, history, lastAnswer };
    }

    lastAnswer = result.text;
    history = appendAndCompact(
      history,
      formatTurnTranscript(turn, turnPrompt, result.text, result.toolRounds),
      maxHistoryChars,
      headChars,
    );

    // ── CASE A: model called finish ────────────────────────────────────
    if (result.finished) {
      if (!goal.verifyCommand) {
        console.log(`\n[✓ model called finish — no verifier, accepting]`);
        return { status: "completed", turns: turn, history, lastAnswer };
      }

      if (verbose) console.log(`\n[verify] ${goal.verifyCommand} (after finish)`);
      const verification = await verifyGoal(goal);

 if (verification.ok) {
  // Verifier passes, but the model never claimed completion. Push back once.
  console.log(
    `\n[? verification passed on turn ${turn}, but model did not call finish]`,
  );
  history = appendAndCompact(
    history,
    `### Turn ${turn}: Verification passed, but you did not call finish.\n` +
      `If the task is truly complete, call the finish tool NOW with a summary and files_changed. ` +
      `If it is not complete, continue working.`,
    maxHistoryChars,
    headChars,
  );
  continue;
}

      // Model said done, but reality disagrees. Push back.
      const failure = formatVerificationFailure(verification);
      console.log(
        `\n[✗ finish claim REJECTED — exit ${verification.exitCode}]\n` +
          failure.slice(0, 800),
      );
      history = appendAndCompact(
        history,
        `### Turn ${turn}: You called finish but verification REJECTED it.\n${failure}`,
        maxHistoryChars,
        headChars,
      );
      continue;
    }

    // ── CASE B: model did nothing (no tools, no finish) ────────────────
    if (result.toolRounds === 0) {
      if (turn === 1) {
        // First turn, model just answered a question — treat as completed
        return { status: "completed", turns: turn, history, lastAnswer };
      }
      console.log(
        `\n[model produced text without tools or finish — nudging]`,
      );
      history = appendAndCompact(
        history,
        `### Turn ${turn}: You did not call a tool or finish. ` +
          `If done, call finish. If not, continue working.`,
        maxHistoryChars,
        headChars,
      );
      continue;
    }

    // ── CASE C: model did work but didn't call finish ──────────────────
    if (!goal.verifyCommand) {
      return { status: "completed", turns: turn, history, lastAnswer };
    }

    if (verbose) console.log(`\n[verify] ${goal.verifyCommand}`);
    const verification = await verifyGoal(goal);

    if (verification.ok) {
      console.log(
        `\n[✓ verification passed on turn ${turn} (model didn't call finish — accepting)]`,
      );
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

  console.log(
    `\n[!] Hard safety cap (${hardCap}) reached without verified finish.`,
  );
  return { status: "turn_limit", turns: turn, history, lastAnswer };
}