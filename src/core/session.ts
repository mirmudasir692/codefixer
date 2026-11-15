// Session state tracking read and written files to prevent accidental overwrites

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

