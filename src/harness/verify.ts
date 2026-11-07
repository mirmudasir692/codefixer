import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Goal, VerificationResult } from "./types.js";

const execAsync = promisify(exec);

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}

export async function verifyGoal(goal: Goal): Promise<VerificationResult> {
  if (!goal.verifyCommand) {
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }

  try {
    const { stdout, stderr } = await execAsync(goal.verifyCommand, {
      cwd: goal.cwd ?? process.cwd(),
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
    };
  } catch (err: any) {
    return {
      ok: false,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: truncate(err.stdout ?? ""),
      stderr: truncate(err.stderr ?? err.message ?? String(err)),
    };
  }
}

export function formatVerificationFailure(v: VerificationResult): string {
  return [
    "The goal is NOT complete. Verification failed.",
    `Exit code: ${v.exitCode ?? "unknown"}`,
    v.stdout ? `stdout:\n${v.stdout}` : "",
    v.stderr ? `stderr:\n${v.stderr}` : "",
    "",
    "Fix the underlying problem, then try again. Do not claim success.",
  ]
    .filter(Boolean)
    .join("\n");
}