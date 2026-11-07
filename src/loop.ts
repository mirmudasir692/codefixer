import { codeAgent } from "./agent.js";

export type TurnResult = {
  text: string;
  transcriptLine: string;
  toolRounds: number;
};

export async function runTurn(
  userInput: string,
  history: string,
): Promise<TurnResult> {
  let response = await codeAgent({ history, input: userInput });

  let rounds = 0;
  while (response.toolCalls.length > 0) {
    if (++rounds > 8) {
      throw new Error("Tool loop exceeded 8 rounds — the model may be stuck.");
    }

    for (const call of response.toolCalls) {
      let argsForDisplay: unknown = call.args;
      try {
        argsForDisplay = JSON.parse(call.args);
      } catch {
        // keep raw string if malformed
      }
      console.log(`\n[→ ${call.name}(${JSON.stringify(argsForDisplay)})]`);
    }

    const outputs = await response.executeTools();
    response = await response.resume(outputs);
  }

  const answer = response.text();

  const transcriptLine =
    `User: ${userInput}\n` +
    `Assistant: ${answer}\n` +
    (rounds > 0 ? `(used ${rounds} tool round(s))\n` : "");

  return { text: answer, transcriptLine, toolRounds: rounds };
}