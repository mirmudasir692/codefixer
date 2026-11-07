import { readFile } from "node:fs/promises";

const ACTION_VERBS = [
  "implement", "add", "create", "build", "make", "write", "generate", "scaffold",
  "fix", "refactor", "update", "change", "modify", "rename", "move",
  "remove", "delete",
];

/**
 * Should this input trigger the autonomous goal loop instead of a single turn?
 * False for questions and explanations; true for action-style requests.
 */
export function looksLikeAction(input: string): boolean {
  const trimmed = input.trim();

  // Question mark → user wants an answer, not an edit
  if (trimmed.endsWith("?")) return false;

  // Question words at the start → explanation, not action
  if (/^(how|why|what|where|when|who|explain|show|tell\s+me|describe)\b/i.test(trimmed)) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  return ACTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`).test(lower));
}

/**
 * Pick a reasonable mechanical verifier for the current project.
 * Order of preference:
 *   1. package.json "build" script
 *   2. package.json "test" script (if it isn't the npm-init stub)
 *   3. package.json "typecheck" script
 *   4. tsconfig.json → `npx tsc --noEmit`
 *   5. undefined → turn-based loop (model decides stop)
 */
export async function detectVerifyCommand(): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    const scripts = pkg.scripts ?? {};
    if (typeof scripts.build === "string") return "npm run build --silent";
    if (
      typeof scripts.test === "string" &&
      !/no test specified/i.test(scripts.test)
    ) {
      return "npm test --silent";
    }
    if (typeof scripts.typecheck === "string") return "npm run typecheck --silent";
  } catch {
    /* no package.json */
  }

  try {
    await readFile("tsconfig.json", "utf-8");
    return "npx tsc --noEmit";
  } catch {
    /* no tsconfig */
  }

  return undefined;
}