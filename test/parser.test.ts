import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { safeParse, extractTextToolCalls } from "../src/utils/parser.js";

describe("safeParse", () => {
  test("parses valid JSON", () => {
    assert.deepEqual(safeParse('{"path":"a.py"}'), { path: "a.py" });
  });

  test("passes through non-string values unchanged", () => {
    const value = { path: "a.py" };
    assert.equal(safeParse(value), value);
  });

  test("repairs Python triple-quoted string values", () => {
    // Exact shape emitted by the model: Python-style triple quotes with
    // literal newlines and unescaped inner quotes inside a JSON string.
    const raw = `{
    "path": "mudasir.py",
    "content": """
def add_greeting(name):
    return f"Hello, {name}!"
"""
  }`;

    const parsed = safeParse(raw);
    assert.equal(parsed.path, "mudasir.py");
    assert.equal(
      parsed.content,
      '\ndef add_greeting(name):\n    return f"Hello, {name}!"\n',
    );
  });

  test("escapes raw newlines inside string values", () => {
    const raw = `{
  "path": "notes.txt",
  "content": "line one
line two"
}`;

    const parsed = safeParse(raw);
    assert.equal(parsed.path, "notes.txt");
    assert.equal(parsed.content, "line one\nline two");
  });

  test("returns null for unrepairable input", () => {
    assert.equal(safeParse("{ definitely not json"), null);
  });
});

describe("extractTextToolCalls", () => {
  test("extracts a fenced JSON tool call", () => {
    const text =
      '```json\n{\n  "name": "read_file",\n  "arguments": {\n    "path": "mudasir.py"\n  }\n}\n```';

    const calls = extractTextToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "read_file");
    assert.deepEqual(safeParse(calls[0].args), { path: "mudasir.py" });
  });

  test("keeps braces inside string values intact", () => {
    const text = `{"name":"write_file","arguments":{"path":"a.py","content":"print(f\\"{x}\\")"}}`;

    const calls = extractTextToolCalls(text);
    assert.equal(calls.length, 1);
    const parsed = safeParse(calls[0].args);
    assert.equal(parsed.content, 'print(f"{x}")');
  });
});
