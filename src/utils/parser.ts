// Parses JSON strings safely without throwing
export function safeParse(args: unknown): any {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return null;
    }
  }
  return args;
}

// Extracts {"name":"...","arguments":{...}} from text with nested braces support
export function extractTextToolCalls(text: string): { name: string; args: string }[] {
  const calls: { name: string; args: string }[] = [];
  const re = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let depth = 0, i = re.lastIndex, start = -1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    if (start === -1) continue;
    try {
      calls.push({ name: m[1], args: text.slice(start, i) });
    } catch {}
    re.lastIndex = i;
  }
  return calls;
}

