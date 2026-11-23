import { llm } from "mirascope";
import { z } from "zod";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { confirm, errorMessage } from "../utils/index.js";

const execAsync = promisify(exec);

export const envInfoTool = llm.defineTool({
  name: "env_info",
  description:
    "Get detailed environment information: operating system, architecture, Node.js version, working directory, git branch, and available CLI tools.",
  validator: z.object({}),
  tool: async () => {
    try {
      let gitBranch = "unknown";
      try {
        const { stdout } = await execAsync("git branch --show-current", {
          cwd: process.cwd(),
          timeout: 5000,
        });
        gitBranch = stdout.trim() || "detached";
      } catch {}

      const checkBinaries = ["git", "node", "npm", "tsc", "python3", "docker", "rg", "curl"];
      const availableBinaries: Record<string, boolean> = {};

      await Promise.all(
        checkBinaries.map(async (bin) => {
          try {
            await execAsync(`which ${bin}`, { timeout: 2000 });
            availableBinaries[bin] = true;
          } catch {
            availableBinaries[bin] = false;
          }
        }),
      );

      return {
        ok: true,
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        platform: os.platform(),
        nodeVersion: process.version,
        cwd: process.cwd(),
        homedir: os.homedir(),
        cpuCores: os.cpus().length,
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
        gitBranch,
        availableBinaries,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        os: "",
        platform: "",
        nodeVersion: "",
        cwd: "",
        homedir: "",
        cpuCores: 0,
        freeMemoryMB: 0,
        totalMemoryMB: 0,
        gitBranch: "",
        availableBinaries: {},
        error: errorMessage(err),
      };
    }
  },
});

export const getEnvTool = llm.defineTool({
  name: "get_env",
  description: "Read an environment variable value for the current session.",
  validator: z.object({
    key: z.string().describe("Environment variable name (e.g. 'NODE_ENV', 'PATH')"),
  }),
  tool: async ({ key }) => {
    const value = process.env[key];
    return {
      ok: true,
      key,
      exists: value !== undefined,
      value: value ?? null,
      error: null,
    };
  },
});

export const setEnvTool = llm.defineTool({
  name: "set_env",
  description: "Set an environment variable for the current session.",
  validator: z.object({
    key: z.string().describe("Environment variable name"),
    value: z.string().describe("Value to set"),
  }),
  tool: async ({ key, value }) => {
    process.env[key] = value;
    return {
      ok: true,
      key,
      value,
      error: null,
    };
  },
});

export const installPackageTool = llm.defineTool({
  name: "install_package",
  description:
    "Install a package or dependency using npm, pnpm, yarn, or pip with version pinning.",
  validator: z.object({
    packageName: z.string().describe("Package name (e.g. 'zod', 'lodash@^4.17.21')"),
    packageManager: z
      .enum(["npm", "pnpm", "yarn", "pip"])
      .default("npm")
      .describe("Package manager to use"),
    dev: z.boolean().default(false).describe("Install as dev dependency"),
  }),
  tool: async ({ packageName, packageManager, dev }) => {
    let cmd = "";
    if (packageManager === "npm") {
      cmd = `npm install ${dev ? "-D " : ""}${packageName}`;
    } else if (packageManager === "pnpm") {
      cmd = `pnpm add ${dev ? "-D " : ""}${packageName}`;
    } else if (packageManager === "yarn") {
      cmd = `yarn add ${dev ? "--dev " : ""}${packageName}`;
    } else if (packageManager === "pip") {
      cmd = `pip install ${packageName}`;
    }

    const approved = await confirm(`\n[install_package] Run "${cmd}"?\nAllow? [y/N] `);
    if (!approved) {
      return {
        ok: false,
        packageName,
        command: cmd,
        stdout: "",
        stderr: "",
        error: "User denied package installation.",
      };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: process.cwd(),
        timeout: 120_000,
      });

      return {
        ok: true,
        packageName,
        command: cmd,
        stdout: stdout.trim().slice(-1000),
        stderr: stderr.trim().slice(-1000),
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        packageName,
        command: cmd,
        stdout: "",
        stderr: "",
        error: errorMessage(err),
      };
    }
  },
});

export const executeSqlTool = llm.defineTool({
  name: "execute_sql",
  description: "Execute a SQL query against a SQLite database file using the sqlite3 CLI.",
  validator: z.object({
    databasePath: z.string().describe("Path to the SQLite database file relative to project root"),
    query: z.string().describe("SQL query to execute"),
  }),
  tool: async ({ databasePath, query }) => {
    try {
      const approved = await confirm(
        `\n[execute_sql] Run SQL query on ${databasePath}:\n${query}\nAllow? [y/N] `,
      );
      if (!approved) {
        return {
          ok: false,
          databasePath,
          output: "",
          stderr: null,
          error: "User denied SQL execution.",
        };
      }

      // Execute via sqlite3 CLI
      const safeQuery = query.replace(/"/g, '\\"');
      const { stdout, stderr } = await execAsync(
        `sqlite3 -header -column "${databasePath}" "${safeQuery}"`,
        {
          cwd: process.cwd(),
          timeout: 15_000,
        },
      );

      return {
        ok: true,
        databasePath,
        output: stdout.trim(),
        stderr: stderr.trim() || null,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        databasePath,
        output: "",
        stderr: null,
        error: errorMessage(err),
      };
    }
  },
});
