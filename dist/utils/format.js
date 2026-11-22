export function truncate(text, max = 5000) {
    if (text.length <= max)
        return text;
    return text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}
export function numberLines(lines, startLine) {
    const width = String(startLine + lines.length - 1).length;
    return lines
        .map((line, i) => `${String(startLine + i).padStart(width)}\t${line}`)
        .join("\n");
}
export function formatToolArgs(args) {
    if (!args || typeof args !== "object")
        return "";
    const parts = [];
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string") {
            const preview = value.length > 50 ? `${value.slice(0, 47)}...` : value;
            parts.push(`${key}: "${preview.replace(/\n/g, "\\n")}"`);
        }
        else if (Array.isArray(value)) {
            parts.push(`${key}: [${value.length} items]`);
        }
        else {
            parts.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    return parts.join(", ");
}
export function looksNumbered(text) {
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    if (lines.length < 3)
        return false;
    const numbered = lines.filter((line) => /^\d+\t/.test(line)).length;
    return numbered / lines.length > 0.5;
}
export function rejectNumberedContent(tool, text) {
    if (!looksNumbered(text))
        return null;
    return (`Rejected ${tool}: the content still has line-number prefixes copied from ` +
        `read_file (lines like "1\\t..."). Those numbers are display-only. ` +
        `Re-send the real file content with the numbers removed.`);
}
