export interface ConfiguredModel {
  name: string;
  url: string;
  apiKey?: string;
  createdAt?: number;
}

export type TurnResult = {
  text: string;
  transcriptLine: string;
  toolRounds: number;
  finished: boolean;
  finishSummary?: string;
};

export type StopReason = "mutation-limit" | "round-limit" | "stalled" | null;

export type ParsedToolCall = {
  name: string;
  args: string;
};

export type MessageEntry = {
  index: number;
  text: string;
};

export type ReplState = {
  history: string;
  messageIndex: number;
  messages: MessageEntry[];
};

export interface AgentToolCall {
  name: string;
  args: unknown;
}

export interface AgentCallResponse {
  toolCalls?: AgentToolCall[];
  executeTools: () => Promise<unknown>;
  resume: (content: unknown) => Promise<AgentCallResponse>;
  text: () => string | undefined;
}
