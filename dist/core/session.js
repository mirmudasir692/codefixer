const readFiles = new Set();
export function markRead(filePath) {
    readFiles.add(filePath);
}
export function markWritten(filePath) {
    readFiles.add(filePath);
}
export function hasBeenRead(filePath) {
    return readFiles.has(filePath);
}
export function resetSession() {
    readFiles.clear();
}
