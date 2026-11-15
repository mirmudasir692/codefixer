// Microkernel Tool Registry: manages pluggable tools and unified invocation

export class ToolRegistry {
  private tools = new Map<string, any>();

  // Registers a tool plugin
  register(name: string, tool: any): void {
    this.tools.set(name, tool);
  }

  // Gets a tool by name
  get(name: string): any {
    return this.tools.get(name);
  }

  // Returns all registered tool names
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // Returns all registered tool instances for LLM definition
  getAll(): any[] {
    return Array.from(this.tools.values());
  }

  // Returns a dictionary map of tools by name
  getMap(): Record<string, any> {
    return Object.fromEntries(this.tools.entries());
  }

  // Executes a tool shape-agnostically with error handling
  async execute(nameOrTool: string | any, args: any): Promise<unknown> {
    const tool = typeof nameOrTool === "string" ? this.get(nameOrTool) : nameOrTool;
    if (!tool) {
      throw new Error(`Tool not found: ${String(nameOrTool)}`);
    }

    // Direct Mirascope callable
    if (typeof tool === "function") {
      return await tool(args ?? {});
    }

    // Object with execute method
    if (typeof tool.execute === "function") {
      const rawArgs = typeof args === "string" ? args : JSON.stringify(args ?? {});
      const out = await tool.execute({ id: "text-call", name: tool.name ?? "tool", args: rawArgs });
      if (out && typeof out === "object" && "result" in out) {
        if (out.error) throw out.error;
        return out.result;
      }
      return out;
    }

    throw new Error(`Tool has no invokable method.`);
  }
}

// Global default tool registry singleton
export const registry = new ToolRegistry();

