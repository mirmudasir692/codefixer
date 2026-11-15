import * as readline from "node:readline/promises";

// Prompts the user with a standard yes/no question
export async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

// Prompts the user for destructive actions requiring exact confirmation
export async function confirmDestructive(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === "yes-really";
}

// Formats an error into a string message
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

