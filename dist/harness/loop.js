import { runTurn } from "../loop.js";
import { verifyGoal, formatVerificationFailure } from "./verify.js";
import { appendAndCompact, formatTurnTranscript } from "./context.js";
import { logger } from "../utils/index.js";
const HARD_SAFETY_CAP = 20;
// Autonomous goal verification loop
export async function runGoalLoop(goal, config = {}) {
    const hardCap = config.maxTurns ?? HARD_SAFETY_CAP;
    const maxHistoryChars = config.maxHistoryChars ?? 6000;
    const headChars = config.headChars ?? 1500;
    const verbose = config.verbose ?? true;
    let history = "";
    let lastAnswer = "";
    let turn = 0;
    while (turn < hardCap) {
        turn++;
        logger.info(`\n━━━ Turn ${turn} ━━━`);
        const turnPrompt = turn === 1
            ? goal.prompt
            : "Continue. Fix the verification failure shown above, then call finish.";
        let result;
        try {
            result = await runTurn(turnPrompt, history);
        }
        catch (err) {
            logger.error(`Turn ${turn} failed: ${err.message}`);
            return { status: "aborted", turns: turn, history, lastAnswer };
        }
        lastAnswer = result.text;
        history = appendAndCompact(history, formatTurnTranscript(turn, turnPrompt, result.text, result.toolRounds), maxHistoryChars, headChars);
        // ── CASE A: model called finish ────────────────────────────────────
        if (result.finished) {
            if (!goal.verifyCommand) {
                logger.info(`\n[✓ Model called finish — accepting]`);
                return { status: "completed", turns: turn, history, lastAnswer };
            }
            if (verbose)
                logger.info(`\n[verify] ${goal.verifyCommand}`);
            const verification = await verifyGoal(goal);
            if (verification.ok) {
                logger.info(`\n[✓ Verification passed on turn ${turn}]`);
                return { status: "completed", turns: turn, history, lastAnswer };
            }
            // Verification failed — push back to model
            const failure = formatVerificationFailure(verification);
            logger.warn(`Finish claim rejected (exit ${verification.exitCode})`);
            history = appendAndCompact(history, `### Turn ${turn}: You called finish but verification REJECTED it.\n${failure}`, maxHistoryChars, headChars);
            continue;
        }
        // ── CASE B: model did nothing (no tools, no finish) ────────────────
        if (result.toolRounds === 0) {
            if (turn === 1) {
                return { status: "completed", turns: turn, history, lastAnswer };
            }
            logger.info(`[Model produced text without calling tools or finish — nudging]`);
            history = appendAndCompact(history, `### Turn ${turn}: You did not call a tool or finish. ` +
                `If done, call finish. If not, continue working.`, maxHistoryChars, headChars);
            continue;
        }
        // ── CASE C: model did work but didn't call finish ──────────────────
        if (!goal.verifyCommand) {
            return { status: "completed", turns: turn, history, lastAnswer };
        }
        if (verbose)
            logger.info(`\n[verify] ${goal.verifyCommand}`);
        const verification = await verifyGoal(goal);
        if (verification.ok) {
            logger.info(`\n[✓ Verification passed on turn ${turn} — accepting]`);
            return { status: "completed", turns: turn, history, lastAnswer };
        }
        const failure = formatVerificationFailure(verification);
        logger.warn(`Verification failed (exit ${verification.exitCode})`);
        history = appendAndCompact(history, `### Verification after turn ${turn}\n${failure}`, maxHistoryChars, headChars);
    }
    logger.warn(`Safety cap (${hardCap}) reached without verified finish.`);
    return { status: "turn_limit", turns: turn, history, lastAnswer };
}
