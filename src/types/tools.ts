import type { llm } from "mirascope";

export type CallTools = NonNullable<Parameters<typeof llm.defineCall>[0]["tools"]>;
export type MirascopeTool = CallTools[number];

export type ToolResponse<T = Record<string, unknown>> = {
  ok: boolean;
  error: string | null;
} & T;

export type ToolCallPayload = {
  id: string;
  name: string;
  args: string;
};

export type ToolPlugin = {
  name: string;
  description: string;
  execute: (payload: ToolCallPayload) => Promise<unknown>;
};

export type RegisteredTool =
  | MirascopeTool
  | ToolPlugin
  | ((...args: unknown[]) => unknown)
  | { execute: (payload: ToolCallPayload) => Promise<unknown>; name?: string };
