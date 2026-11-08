import { codeAgent } from "./agent.js";

export type TurnResult = {
  text: string;
  transcriptLine: string;
  toolRounds: number;
  finished: boolean;
  finishSummary?: string;
};

export async function runTurn(
  userInput: string,
  history: string,
): Promise<TurnResult> {
  let response = await codeAgent({ history, input: userInput });

  let rounds = 0;
  let finished = false;
  let finishSummary: string | undefined;

  while (response.toolCalls.length > 0) {
    if (++rounds > 20) {
      throw new Error("Tool loop exceeded 20 rounds — aborting.");
    }

    const hasFinish = response.toolCalls.some((c) => c.name === "finish");

    for (const call of response.toolCalls) {
      let argsForDisplay: unknown = call.args;
      try {
        argsForDisplay = JSON.parse(call.args);
      } catch {}
      console.log(`\n[→ ${call.name}(${JSON.stringify(argsForDisplay)})]`);

      if (call.name === "finish") {
        try {
          const parsed = JSON.parse(call.args);
          finishSummary = parsed.summary;
        } catch {}
      }
    }

    const outputs = await response.executeTools();

    if (hasFinish) {
      finished = true;
      break;
    }

    response = await response.resume(outputs);
  }

  const answer = response.text() || finishSummary || "";

  const transcriptLine =
    `User: ${userInput}\n` +
    `Assistant: ${answer}\n` +
    (rounds > 0 ? `(used ${rounds} tool round(s))` : "") +
    (finished ? `\n(model called finish)` : "");

  return {
    text: answer,
    transcriptLine,
    toolRounds: rounds,
    finished,
    finishSummary,
  };
}