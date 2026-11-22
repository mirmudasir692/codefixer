import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, type SlashCommand } from "../src/ui/tui.js";
import { getProjectFiles } from "../src/utils/path.js";

function filterCommands(input: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const spaceIndex = input.indexOf(" ");
  const query = input.slice(0, spaceIndex === -1 ? input.length : spaceIndex).toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().startsWith(query) ||
      (query.length > 1 && cmd.name.toLowerCase().includes(query)),
  );
}

function parseActiveMention(input: string, cursor = input.length): { start: number; query: string } | null {
  const textBefore = input.slice(0, cursor);
  const atIndex = textBefore.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0 && !/[\s([{"',:=]/.test(textBefore[atIndex - 1])) {
    return null;
  }
  const query = textBefore.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, query };
}

describe("Slash Command Autocomplete", () => {
  test("typing '/' lists all available commands", () => {
    const matches = filterCommands("/");
    assert.equal(matches.length, SLASH_COMMANDS.length);
    assert.ok(matches.some((c) => c.name === "/help"));
    assert.ok(matches.some((c) => c.name === "/model"));
    assert.ok(matches.some((c) => c.name === "/models"));
    assert.ok(matches.some((c) => c.name === "/configure-model"));
    assert.ok(matches.some((c) => c.name === "/history"));
    assert.ok(matches.some((c) => c.name === "/undo"));
    assert.ok(matches.some((c) => c.name === "/clear"));
  });

  test("typing '/m' filters to /model, /models, and /messages", () => {
    const matches = filterCommands("/m");
    const names = matches.map((c) => c.name);
    assert.ok(names.includes("/model"));
    assert.ok(names.includes("/models"));
    assert.ok(names.includes("/messages"));
    assert.ok(!names.includes("/help"));
  });

  test("typing '/con' filters to /configure-model", () => {
    const matches = filterCommands("/con");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "/configure-model");
  });

  test("typing '/und' precisely filters to /undo", () => {
    const matches = filterCommands("/und");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "/undo");
  });

  test("typing '/c' matches /clear", () => {
    const matches = filterCommands("/c");
    assert.ok(matches.some((c) => c.name === "/clear"));
  });

  test("non-slash inputs return empty suggestions", () => {
    assert.deepEqual(filterCommands("hello"), []);
    assert.deepEqual(filterCommands("write some code"), []);
  });
});

describe("@ File & Directory Mentions", () => {
  test("getProjectFiles returns workspace files and folders", () => {
    const files = getProjectFiles();
    assert.ok(files.length > 0);
    assert.ok(files.some((f) => f.path === "src/" && f.isDir));
    assert.ok(files.some((f) => f.path === "package.json" && !f.isDir));
    assert.ok(files.some((f) => f.path.includes("src/ui/tui.ts")));
  });

  test("detects active @ mention at start of input", () => {
    const mention = parseActiveMention("@");
    assert.deepEqual(mention, { start: 0, query: "" });
  });

  test("detects active @ mention inside sentence", () => {
    const mention = parseActiveMention("please inspect @src/ui/t");
    assert.deepEqual(mention, { start: 15, query: "src/ui/t" });
  });

  test("does not trigger on email addresses", () => {
    const mention = parseActiveMention("contact user@email.com");
    assert.equal(mention, null);
  });

  test("does not trigger when cursor has moved past a space", () => {
    const mention = parseActiveMention("@src/ui/tui.ts and then some");
    assert.equal(mention, null);
  });

  test("filters project files by query", () => {
    const files = getProjectFiles();
    const query = "tui";
    const matches = files.filter(
      (f) =>
        f.path.toLowerCase().startsWith(query) ||
        f.name.toLowerCase().startsWith(query) ||
        f.path.toLowerCase().includes(query),
    );
    assert.ok(matches.length >= 1);
    assert.ok(matches.some((f) => f.path.includes("src/ui/tui.ts")));
  });
});
