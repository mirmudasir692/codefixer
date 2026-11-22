import * as readline from "node:readline/promises";
import { getActiveTui } from "../ui/tui.js";

// Shared prompt interface so tool confirmations reuse the REPL's readline
// instance — two interfaces on the same stdin cannot both receive input.
let sharedInterface: readline.Interface | null = null;

export function usePromptInterface(rl: readline.Interface | null): void {
  sharedInterface = rl;
}

async function ask(question: string): Promise<string> {
  if (sharedInterface) return sharedInterface.question(question);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// Prompts the user with a standard yes/no question
export async function confirm(question: string): Promise<boolean> {
  const tui = getActiveTui();
  if (tui?.isActive) return tui.confirm(question);
  return (await ask(question)).trim().toLowerCase() === "y";
}

// Prompts the user for destructive actions requiring exact confirmation
export async function confirmDestructive(question: string): Promise<boolean> {
  const tui = getActiveTui();
  if (tui?.isActive) return tui.confirm(question, true);
  return (await ask(question)).trim() === "yes-really";
}

// Formats an error into a string message
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
