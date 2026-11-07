export type Goal = {
  /** What the user wants done — becomes the prompt for each turn. */
  prompt: string;
  /** Optional: a shell command whose exit 0 means "done". */
  verifyCommand?: string;
  /** Human-readable description of what "done" means. */
  description?: string;
  /** Working directory for verification (defaults to process.cwd()). */
  cwd?: string;
};

export type VerificationResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type LoopStatus =
  | "completed"          // verification passed
  | "turn_limit"         // hit maxTurns without passing
  | "aborted";           // user cancelled or a hard error

export type LoopResult = {
  status: LoopStatus;
  turns: number;
  history: string;
  lastAnswer: string;
};

export type LoopConfig = {
  /** Hard cap on outer turns. Default 10. */
  maxTurns?: number;
  /** Chars of history to keep. Default 6000. */
  maxHistoryChars?: number;
  /** Head chars preserved during compaction. Default 1500. */
  headChars?: number;
  /** Print each verification result. Default true. */
  verbose?: boolean;
};