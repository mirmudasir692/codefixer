// Tool and plugin contract types

export type ToolResponse<T = Record<string, unknown>> = {
  ok: boolean;
  error: string | null;
} & T;

export type ToolPlugin = {
  name: string;
  description: string;
  execute: (args: any) => Promise<unknown>;
};

