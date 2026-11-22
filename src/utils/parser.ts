// Parses JSON strings safely without throwing, repairing common LLM mistakes
export function safeParse(args: unknown): any {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args);
  } catch {
    // Models often emit JSON-ish arguments with Python-style triple-quoted
    // values or raw newlines inside strings. Try to repair before giving up.
    try {
      return JSON.parse(repairLooseJson(args));
    } catch {
      return null;
    }
  }
}

// Repairs JSON-ish tool arguments emitted by models: converts Python-style
// triple-quoted values to JSON strings and escapes raw control characters
// that appear inside string literals.
function repairLooseJson(raw: string): string {
  const withQuotedValues = raw.replace(
    /:\s*("""|''')([\s\S]*?)\1/g,
    (_match, _quote: string, body: string) => `: ${JSON.stringify(body)}`,
  );
  return escapeControlCharsInsideStrings(withQuotedValues);
}

// Escapes raw newlines/tabs/carriage returns that appear inside JSON strings
function escapeControlCharsInsideStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }
    out += ch;
  }
  return out;
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
