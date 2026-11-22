import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { codeAgent } from "./agent.js";
import { registry } from "./registry.js";
import { safeParse, extractTextToolCalls, logger, mutationPath } from "../utils/index.js";
import type { TurnResult, StopReason, AgentCallResponse } from "../types/index.js";

const MAX_TOOL_ROUNDS = 20;
const MAX_FILE_MUTATIONS = 3;
const MUTATING_TOOLS = new Set([
  "write_file",
  "edit_file",
  "insert_file",
  "replace_lines",
  "delete_file",
]);

export async function runTurn(userInput: string, history: string): Promise<TurnResult> {
  let workingHistory = history;

  const fileMentions = [...userInput.matchAll(/@([a-zA-Z0-9_.\-\/]+)/g)]
    .map((m) => m[1])
    .filter((p) => {
      try {
        const full = path.resolve(process.cwd(), p);
        return existsSync(full) && statSync(full).isFile();
      } catch {
        return false;
      }
    });

  if (fileMentions.length > 0) {
    const attachedSnippets: string[] = [];
    for (const filePath of fileMentions) {
      try {
        const full = path.resolve(process.cwd(), filePath);
        const raw = readFileSync(full, "utf-8");
        const preview =
          raw.length > 4000 ? raw.slice(0, 4000) + "\n... [truncated]" : raw;
        attachedSnippets.push(
          `[Attached context for @${filePath}]:\n\`\`\`\n${preview}\n\`\`\``,
        );
      } catch {}
    }
    if (attachedSnippets.length > 0) {
      workingHistory += `\n${attachedSnippets.join("\n\n")}\n`;
    }
  }

  let response = (await codeAgent({ history: workingHistory, input: userInput })) as unknown as AgentCallResponse;
  let rounds = 0;
  let finished = false;
  let finishSummary: string | undefined;
  let stopReason: StopReason = null;
  let totalMutations = 0;
  let stalledRounds = 0;
  const executedCalls = new Set<string>();
  const mutationCounts = new Map<string, number>();
  const changedFiles = new Set<string>();
  const wantsChange =
    /\b(write|create|add|edit|change|modify|fix|implement|refactor|update|remove|delete|rename)\b/i.test(
      userInput,
    );

  while (true) {
    if (response.toolCalls && response.toolCalls.length > 0) {
      if (++rounds > MAX_TOOL_ROUNDS) {
        stopReason = "round-limit";
        finished = true;
        break;
      }
      const hasFinish = response.toolCalls.some((c: { name: string }) => c.name === "finish");

      for (const call of response.toolCalls) {
        const args = safeParse<Record<string, unknown>>(call.args);
        logger.toolCall(call.name, args);
        if (call.name === "finish" && args && typeof args === "object" && "summary" in args) {
          finishSummary = typeof args.summary === "string" ? args.summary : undefined;
        }
      }

      let outputs: unknown;
      try {
        outputs = await response.executeTools();
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.toolError("tool batch", err);
        response = (await response.resume(
          `Tool execution failed: ${err.message}. Re-emit with valid arguments or answer in plain English.`,
        )) as unknown as AgentCallResponse;
        continue;
      }

      for (const call of response.toolCalls) {
        if (!MUTATING_TOOLS.has(call.name)) continue;
        const p = mutationPath(safeParse(call.args));
        const used = (mutationCounts.get(p) ?? 0) + 1;
        mutationCounts.set(p, used);
        totalMutations++;
        if (p) changedFiles.add(p);
        if (used >= MAX_FILE_MUTATIONS) stopReason = "mutation-limit";
      }

      if (hasFinish || stopReason === "mutation-limit") {
        finished = true;
        break;
      }
      response = (await response.resume(outputs)) as unknown as AgentCallResponse;
      continue;
    }

    const text = response.text() ?? "";
    const textCalls = extractTextToolCalls(text);
    if (textCalls.length === 0) break;
    if (++rounds > MAX_TOOL_ROUNDS) {
      stopReason = "round-limit";
      finished = true;
      break;
    }

    const results: string[] = [];
    const mutatedThisRound: string[] = [];
    let sawFinish = false;
    let blocked = false;
    let executedThisRound = 0;

    for (const call of textCalls) {
      const args = safeParse<Record<string, unknown>>(call.args);

      if (args === null && call.args.trim() !== "null") {
        const parseError =
          `${call.name} arguments could not be parsed as JSON. ` +
          `Re-emit this tool call with strict JSON: escape newlines as \\n and ` +
          `double quotes as \\" inside string values. Received: ${call.args.slice(0, 200)}`;
        logger.warn(parseError);
        results.push(`[${call.name} FAILED] ${parseError}`);
        continue;
      }

      const callKey = `${call.name}:${JSON.stringify(args)}`;

      if (executedCalls.has(callKey)) {
        results.push(`[${call.name}] STOP: this exact call already ran earlier in this turn and its result is above. Do not retry it. If it failed, change your approach (e.g., use write_file to create a missing file) or reply with a short summary.`);
        continue;
      }

      logger.toolCall(call.name, args);

      if (call.name === "finish") {
        if (args && typeof args === "object" && "summary" in args) {
          finishSummary = typeof args.summary === "string" ? args.summary : undefined;
        }
        sawFinish = true;
        continue;
      }

      if (MUTATING_TOOLS.has(call.name)) {
        const targetPath = mutationPath(args);
        const used = mutationCounts.get(targetPath) ?? 0;
        if (targetPath && used >= MAX_FILE_MUTATIONS) {
          blocked = true;
          const msg =
            `[${call.name} BLOCKED] ${targetPath} has already been modified ${used} times ` +
            `in this turn. Stop editing and summarize what was done.`;
          logger.warn(msg);
          results.push(msg);
          continue;
        }
      }

      try {
        executedThisRound++;
        const out = await registry.execute(call.name, args);
        executedCalls.add(callKey);
        const outObj = out as { ok?: boolean } | null;
        if (MUTATING_TOOLS.has(call.name) && outObj?.ok !== false) {
          const targetPath = mutationPath(args);
          mutationCounts.set(targetPath, (mutationCounts.get(targetPath) ?? 0) + 1);
          totalMutations++;
          mutatedThisRound.push(targetPath);
          if (targetPath) changedFiles.add(targetPath);
        }
        results.push(`[${call.name} result]\n${JSON.stringify(out).slice(0, 4000)}`);
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.toolError(call.name, err);
        results.push(`[${call.name} FAILED] ${err.message}`);
      }
    }

    if (sawFinish) {
      finished = true;
      break;
    }

    if (blocked) {
      stopReason = "mutation-limit";
      finished = true;
      break;
    }

    if (executedThisRound === 0) {
      if (++stalledRounds >= 2) {
        stopReason = "stalled";
        finished = true;
        break;
      }
    } else {
      stalledRounds = 0;
    }

    workingHistory +=
      `\nAssistant attempted tools:\n${textCalls.map((c) => `${c.name}(${c.args})`).join("\n")}\n` +
      `Tool results:\n${results.join("\n")}\n`;

    const nudge = mutatedThisRound.length
      ? ` You already modified ${[...new Set(mutatedThisRound)].join(", ")} in this turn — do NOT edit the same file again. If the task is complete, reply with one short sentence summarizing it.`
      : wantsChange
        ? " You have not modified any files yet. The user asked for a change: call write_file (full content) or edit_file (targeted change) now with the real new content. Do not call read_file again — its content is already above."
        : " The user asked an informational question (no files to edit). Synthesize your findings from the tool results above and answer in plain English now. Do not call any tools.";
    const workingInput = `User request: "${userInput}".\nUse the tool results above to fulfill the user's request. If changes are needed, proceed with the appropriate edit tool. If you have completed the task or have the full answer, respond in plain English. Do not re-call any tool whose result is already displayed above.${nudge}`;
    response = (await codeAgent({ history: workingHistory, input: workingInput })) as unknown as AgentCallResponse;
  }

  const rawText = response.text() ?? "";
  const cleanedText = rawText.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, "").trim();
  const looksLikeToolCall = /^\s*```?(?:json)?\s*\{\s*"name"\s*:/.test(rawText);
  const files = [...changedFiles];
  const filesSummary =
    files.length > 3
      ? `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`
      : files.join(", ");
  const changeNoun = totalMutations === 1 ? "change" : "changes";

  let answer =
    finishSummary ||
    (cleanedText.length > 0 ? cleanedText : looksLikeToolCall ? "" : rawText.trim());

  if (!answer && totalMutations > 0) {
    answer = `✓ Done — changed ${filesSummary} (${totalMutations} ${changeNoun}). /history to review, /undo to revert.`;
  } else if (!answer && rounds > 0 && !stopReason) {
    answer = "✓ Done.";
  }

  if (stopReason) {
    if (totalMutations === 0) {
      answer = wantsChange
        ? "⚠ Nothing was changed — I couldn't complete that. Try rephrasing, or reply to continue."
        : "⚠ Could not complete an answer from the tool outputs. Try asking a more specific question.";
    } else if (stopReason !== "stalled") {
      answer = `✓ Changed ${filesSummary} (${totalMutations} ${changeNoun}), but I stopped early — the task may be incomplete. Reply to continue.`;
    }
  }

  return {
    text: answer,
    transcriptLine: `User: ${userInput}\nAssistant: ${answer}\n${rounds ? `(used ${rounds} tool round(s))` : ""}`,
    toolRounds: rounds,
    finished,
    finishSummary,
  };
}
