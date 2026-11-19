// Persistent history & checkpoint management types

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
  files: FileSnapshot[];
};

export type RevertResult = {
  ok: boolean;
  checkpointId?: string;
  filesReverted: string[];
  error?: string;
};

