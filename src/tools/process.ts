import { llm } from "mirascope";
import { z } from "zod";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { assertInsideProject, confirm, errorMessage, truncate } from "../utils/index.js";

const execAsync = promisify(exec);

interface BackgroundProcess {
  id: string;
  pid: number | undefined;
  command: string;
  cwd: string;
  startTime: number;
  status: "running" | "exited";
  exitCode: number | null;
  outputBuffer: string[];
  child: ReturnType<typeof spawn>;
}

const activeProcesses = new Map<string, BackgroundProcess>();

export const runShellBackgroundTool = llm.defineTool({
  name: "run_shell_background",
  description:
    "Start a long-running command in the background (such as a dev server, watcher, or test daemon) without blocking.",
  validator: z.object({
    command: z.string().describe("Shell command to run in background"),
    cwd: z.string().default(".").describe("Working directory relative to project root"),
  }),
  tool: async ({ command, cwd }) => {
    try {
      assertInsideProject(cwd);
    } catch (err: unknown) {
      return {
        ok: false,
        processId: null,
        pid: null,
        command,
        status: "failed",
        error: errorMessage(err),
      };
    }

    const approved = await confirm(
      `\n[run_shell_background] ${command} (cwd: ${cwd})\nAllow background start? [y/N] `,
    );
    if (!approved) {
      return {
        ok: false,
        processId: null,
        pid: null,
        command,
        status: "denied",
        error: "User denied background shell execution.",
      };
    }

    try {
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const id = `proc_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
      const procInfo: BackgroundProcess = {
        id,
        pid: child.pid,
        command,
        cwd,
        startTime: Date.now(),
        status: "running",
        exitCode: null,
        outputBuffer: [],
        child,
      };

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        procInfo.outputBuffer.push(...lines);
        if (procInfo.outputBuffer.length > 500) {
          procInfo.outputBuffer = procInfo.outputBuffer.slice(-300);
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        procInfo.outputBuffer.push(...lines.map((l) => `[stderr] ${l}`));
        if (procInfo.outputBuffer.length > 500) {
          procInfo.outputBuffer = procInfo.outputBuffer.slice(-300);
        }
      });

      child.on("exit", (code) => {
        procInfo.status = "exited";
        procInfo.exitCode = code;
      });

      activeProcesses.set(id, procInfo);

      return {
        ok: true,
        processId: id,
        pid: child.pid ?? null,
        command,
        status: "running",
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        processId: null,
        pid: null,
        command,
        status: "failed",
        error: errorMessage(err),
      };
    }
  },
});

export const killProcessTool = llm.defineTool({
  name: "kill_process",
  description: "Terminate a background process previously started with run_shell_background.",
  validator: z.object({
    processId: z
      .string()
      .describe("Process ID returned by run_shell_background (e.g. 'proc_1234')"),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).default("SIGTERM").describe("Signal to send"),
  }),
  tool: async ({ processId, signal }) => {
    const proc = activeProcesses.get(processId);
    if (!proc) {
      return {
        ok: false,
        processId,
        killed: false,
        command: null,
        error: `Process "${processId}" not found. Use list_processes to see active processes.`,
      };
    }

    try {
      if (proc.status === "running") {
        proc.child.kill(signal);
        proc.status = "exited";
      }
      activeProcesses.delete(processId);
      return {
        ok: true,
        processId,
        killed: true,
        command: proc.command,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        processId,
        killed: false,
        command: proc.command,
        error: errorMessage(err),
      };
    }
  },
});

export const listProcessesTool = llm.defineTool({
  name: "list_processes",
  description:
    "List all background processes started during this session with their status and recent output.",
  validator: z.object({
    tailLines: z
      .number()
      .int()
      .default(20)
      .describe("Number of recent output lines to include per process"),
  }),
  tool: async ({ tailLines }) => {
    const list = Array.from(activeProcesses.values()).map((proc) => ({
      id: proc.id,
      pid: proc.pid ?? null,
      command: proc.command,
      status: proc.status,
      exitCode: proc.exitCode ?? null,
      uptimeSeconds: Math.floor((Date.now() - proc.startTime) / 1000),
      recentOutput: proc.outputBuffer.slice(-tailLines).join("\n"),
    }));

    return {
      ok: true,
      count: list.length,
      processes: list,
      error: null,
    };
  },
});

export const runTestsTool = llm.defineTool({
  name: "run_tests",
  description:
    "Run tests in the project and return structured pass/fail results. " +
    "Automatically runs 'npm test' or a custom test command.",
  validator: z.object({
    command: z.string().default("npm test").describe("Test command to execute"),
    timeoutSeconds: z.number().int().default(60).describe("Timeout in seconds"),
  }),
  tool: async ({ command, timeoutSeconds }) => {
    const approved = await confirm(`\n[run_tests] Run "${command}"?\nAllow? [y/N] `);
    if (!approved) {
      return {
        ok: false,
        passed: false,
        command,
        durationMs: 0,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "User denied test execution permission.",
      };
    }

    const startTime = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: timeoutSeconds * 1000,
        maxBuffer: 2 * 1024 * 1024,
      });

      const durationMs = Date.now() - startTime;
      return {
        ok: true,
        passed: true,
        command,
        durationMs,
        exitCode: 0,
        stdout: truncate(stdout, 4000),
        stderr: truncate(stderr, 2000),
        error: null,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number } | null;
      const durationMs = Date.now() - startTime;
      return {
        ok: true,
        passed: false,
        command,
        durationMs,
        exitCode: typeof execErr?.code === "number" ? execErr.code : 1,
        stdout: truncate(execErr?.stdout ?? "", 4000),
        stderr: truncate(execErr?.stderr ?? errorMessage(err), 2000),
        error: "Tests failed.",
      };
    }
  },
});
