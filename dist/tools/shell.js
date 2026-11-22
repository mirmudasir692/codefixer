import { llm } from "mirascope";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { assertInsideProject, truncate, confirm, errorMessage } from "../utils/index.js";
const execAsync = promisify(exec);
export const runShellTool = llm.defineTool({
    name: "run_shell",
    description: "Run a shell command. Use to run tests, builds, or check output.",
    validator: z.object({
        command: z.string().describe("Command to run"),
        cwd: z.string().default(".").describe("Working directory"),
    }),
    tool: async ({ command, cwd }) => {
        try {
            assertInsideProject(cwd);
        }
        catch (err) {
            return {
                ok: false,
                command,
                stdout: null,
                stderr: null,
                exitCode: null,
                error: errorMessage(err),
            };
        }
        const approved = await confirm(`\n[run_shell] ${command} (cwd: ${cwd})\nAllow? [y/N] `);
        if (!approved) {
            return {
                ok: false,
                command,
                stdout: null,
                stderr: null,
                exitCode: null,
                error: "User denied shell permission.",
            };
        }
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd,
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            });
            return {
                ok: true,
                command,
                stdout: truncate(stdout),
                stderr: truncate(stderr),
                exitCode: 0,
                error: null,
            };
        }
        catch (err) {
            const execErr = err;
            return {
                ok: false,
                command,
                stdout: truncate(execErr?.stdout ?? ""),
                stderr: truncate(execErr?.stderr ?? errorMessage(err)),
                exitCode: typeof execErr?.code === "number" ? execErr.code : 1,
                error: errorMessage(err),
            };
        }
    },
});
