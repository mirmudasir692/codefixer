import { codeAgent } from "./agent.js";
import { registry } from "./registry.js";
import { safeParse, extractTextToolCalls, logger } from "../utils/index.js";
import type { TurnResult } from "../types/index.js";

// Microkernel execution loop: coordinates prompt turns and tool plugin dispatch
export async function runTurn(userInput: string, history: string): Promise<TurnResult> {
  let response: any = await codeAgent({ history, input: userInput });
  let rounds = 0, finished = false, finishSummary: string | undefined;
  let workingHistory = history;
  const executedCalls = new Set<string>();

  while (true) {
    // Native tool calls from models with function calling support
    if (response.toolCalls?.length > 0) {
      if (++rounds > 20) throw new Error("Tool loop exceeded 20 rounds.");
      const hasFinish = response.toolCalls.some((c: any) => c.name === "finish");

      for (const call of response.toolCalls) {
        const args = safeParse(call.args);
        logger.toolCall(call.name, args);
        if (call.name === "finish") finishSummary = args?.summary;
      }

      const outputs = await response.executeTools();
      if (hasFinish) {
        finished = true;
        break;
      }
      response = await response.resume(outputs);
      continue;
    }

    // Fallback for models emitting tool calls in text
    const text = response.text() ?? "";
    const textCalls = extractTextToolCalls(text);
    if (textCalls.length === 0) break;
    if (++rounds > 20) throw new Error("Tool loop exceeded 20 rounds.");

    const results: string[] = [];
    let sawFinish = false;

    for (const call of textCalls) {
      const args = safeParse(call.args);
      const callKey = `${call.name}:${JSON.stringify(args)}`;

      if (executedCalls.has(callKey)) {
        results.push(`[${call.name}] You already executed this exact tool call and its result is above. Answer the user now in plain English.`);
        continue;
      }
      executedCalls.add(callKey);

      logger.toolCall(call.name, args);

      if (call.name === "finish") {
        finishSummary = args?.summary;
        sawFinish = true;
        continue;
      }

      try {
        const out = await registry.execute(call.name, args);
        results.push(`[${call.name} result]\n${JSON.stringify(out).slice(0, 4000)}`);
      } catch (e: any) {
        logger.toolError(call.name, e);
        results.push(`[${call.name} FAILED] ${e?.message ?? String(e)}`);
      }
    }

    if (sawFinish) {
      finished = true;
      break;
    }

    // Feed tool results back into history for next turn
    workingHistory +=
      `\nAssistant attempted tools:\n${textCalls.map((c) => `${c.name}(${c.args})`).join("\n")}\n` +
      `Tool results:\n${results.join("\n")}\n`;

    const workingInput = `User request: "${userInput}".\nUse the tool results above to fulfill the user's request. If changes are needed, proceed with the appropriate edit tool. If you have completed the task or have the full answer, respond in plain English. Do not re-call any tool whose result is already displayed above.`;
    response = await codeAgent({ history: workingHistory, input: workingInput });
  }

  const answer = response.text() || finishSummary || "";
  return {
    text: answer,
    transcriptLine: `User: ${userInput}\nAssistant: ${answer}\n${rounds ? `(used ${rounds} tool round(s))` : ""}`,
    toolRounds: rounds,
    finished,
    finishSummary,
  };
}

