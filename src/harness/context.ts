/**
 * Append a transcript line and compact if over budget.
 * Keeps the head (goal + early context) AND the tail (recent work),
 * dropping the middle — which is what long-running agents need.
 */
export function appendAndCompact(
  history: string,
  line: string,
  maxChars = 6000,
  headChars = 1500,
): string {
  const combined = (history + "\n" + line).trim();
  if (combined.length <= maxChars) return combined;

  const head = combined.slice(0, headChars);
  const tailBudget = maxChars - headChars - 40;
  const tail = combined.slice(-tailBudget);
  return `${head}\n\n[... middle history truncated to fit context ...]\n\n${tail}`;
}

export function formatTurnTranscript(
  turn: number,
  userInput: string,
  answer: string,
  toolRounds: number,
): string {
  return [
    `### Turn ${turn}`,
    `User: ${userInput}`,
    `Assistant: ${answer}`,
    toolRounds > 0 ? `(used ${toolRounds} tool round(s))` : "",
  ]
    .filter(Boolean)
    .join("\n");
}