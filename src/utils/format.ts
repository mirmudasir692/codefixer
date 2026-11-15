// String formatting utilities

export function truncate(text: string, max = 5000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}

// Prefixes lines with line numbers for model reference
export function numberLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)}\t${line}`)
    .join("\n");
}

// Formats tool call arguments cleanly for display without dumping massive bodies
export function formatToolArgs(args: Record<string, any> | null): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      const preview = value.length > 50 ? `${value.slice(0, 47)}...` : value;
      parts.push(`${key}: "${preview.replace(/\n/g, "\\n")}"`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}: [${value.length} items]`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join(", ");
}

