import { exec } from "node:child_process";
import { promisify } from "node:util";
import { truncate } from "../utils/index.js";
const execAsync = promisify(exec);
// Execute mechanical verifier command
export async function verifyGoal(goal) {
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
    }
    catch (err) {
        return {
            ok: false,
            exitCode: typeof err.code === "number" ? err.code : null,
            stdout: truncate(err.stdout ?? ""),
            stderr: truncate(err.stderr ?? err.message ?? String(err)),
        };
    }
}
// Format verification failure details into assistant prompt context
export function formatVerificationFailure(v) {
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
