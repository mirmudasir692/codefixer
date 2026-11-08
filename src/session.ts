// Tracks which files have been read in the current session.
// write_file refuses to overwrite a file that hasn't been read first.

const readFiles = new Set<string>();

export function markRead(filePath: string): void {
  readFiles.add(filePath);
}

export function markWritten(filePath: string): void {
  readFiles.add(filePath);
}

export function hasBeenRead(filePath: string): boolean {
  return readFiles.has(filePath);
}

export function resetSession(): void {
  readFiles.clear();
}