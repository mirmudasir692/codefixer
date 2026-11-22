export function safeParse(args) {
    if (typeof args !== "string")
        return args;
    try {
        return JSON.parse(args);
    }
    catch {
        try {
            return JSON.parse(repairLooseJson(args));
        }
        catch {
            return null;
        }
    }
}
function repairLooseJson(raw) {
    const withQuotedValues = raw.replace(/:\s*("""|''')([\s\S]*?)\1/g, (_match, _quote, body) => `: ${JSON.stringify(body)}`);
    return escapeControlCharsInsideStrings(withQuotedValues);
}
function escapeControlCharsInsideStrings(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (const ch of text) {
        if (!inString) {
            if (ch === '"')
                inString = true;
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
export function extractTextToolCalls(text) {
    const calls = [];
    const re = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let depth = 0, i = re.lastIndex, start = -1;
        while (i < text.length) {
            const ch = text[i];
            if (ch === "{") {
                if (depth === 0)
                    start = i;
                depth++;
            }
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    i++;
                    break;
                }
            }
            i++;
        }
        if (start === -1)
            continue;
        try {
            calls.push({ name: m[1], args: text.slice(start, i) });
        }
        catch { }
        re.lastIndex = i;
    }
    return calls;
}
