export type FileState = "modified" | "created" | "deleted";

export type FileSnapshot = {
  path: string;
  state: FileState;
  backupBlobPath: string | null;
  timestamp: string;
};

export type Checkpoint = {
  id: string;
  timestamp: string;
  description: string;
  messageId?: number;
  messageText?: string;
  files: FileSnapshot[];
};

export type RevertResult = {
  ok: boolean;
  checkpointId?: string;
  messageId?: number;
  filesReverted: string[];
  error?: string;
};
