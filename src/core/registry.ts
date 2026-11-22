import type { RegisteredTool, ToolCallPayload, MirascopeTool } from "../types/index.js";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(name: string, tool: RegisteredTool): void {
    this.tools.set(name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getAll<T extends RegisteredTool = MirascopeTool>(): T[] {
    return Array.from(this.tools.values()) as T[];
  }

  getMap(): Record<string, RegisteredTool> {
    return Object.fromEntries(this.tools.entries());
  }

  async execute(nameOrTool: string | RegisteredTool, args: unknown): Promise<unknown> {
    const tool = typeof nameOrTool === "string" ? this.get(nameOrTool) : nameOrTool;
    if (!tool) {
      throw new Error(`Tool not found: ${String(nameOrTool)}`);
    }

    if (typeof tool === "function") {
      const toolFn = tool as (args: unknown) => Promise<unknown> | unknown;
      return await toolFn(args ?? {});
    }

    if ("execute" in tool && typeof tool.execute === "function") {
      const rawArgs = typeof args === "string" ? args : JSON.stringify(args ?? {});
      const toolName = "name" in tool && typeof tool.name === "string" ? tool.name : "tool";
      const payload: ToolCallPayload = { id: "text-call", name: toolName, args: rawArgs };
      const out = await tool.execute(payload);
      if (out && typeof out === "object" && "result" in out) {
        const withResult = out as { result: unknown; error?: unknown };
        if (withResult.error) throw withResult.error;
        return withResult.result;
      }
      return out;
    }

    throw new Error(`Tool has no invokable method.`);
  }
}

export const registry = new ToolRegistry();
