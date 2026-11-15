// Core agent execution types
export type TurnResult = {
  text: string;
  transcriptLine: string;
  toolRounds: number;
  finished: boolean;
  finishSummary?: string;
};

// Tool execution call shape
export type ParsedToolCall = {
  name: string;
  args: any;
};

