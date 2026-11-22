import * as readline from "node:readline/promises";
import { readFileSync } from "node:fs";
import { getActiveTui } from "../ui/tui.js";

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

export async function promptInput(question: string, placeholder?: string): Promise<string> {
  const tui = getActiveTui();
  if (tui?.isActive) {
    tui.print(question);
    const res = await tui.prompt(placeholder ?? question);
    return res.trim();
  }
  const res = await ask(question);
  return res.trim();
}

export async function confirm(question: string): Promise<boolean> {
  const tui = getActiveTui();
  if (tui?.isActive) return tui.confirm(question);
  return (await ask(question)).trim().toLowerCase() === "y";
}

export async function confirmDestructive(question: string): Promise<boolean> {
  const tui = getActiveTui();
  if (tui?.isActive) return tui.confirm(question, true);
  return (await ask(question)).trim() === "yes-really";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")).version ?? "";
  } catch {
    return "";
  }
}
