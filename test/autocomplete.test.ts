import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, type SlashCommand } from "../src/ui/tui.js";

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

describe("Slash Command Autocomplete", () => {
  test("typing '/' lists all available commands", () => {
    const matches = filterCommands("/");
    assert.equal(matches.length, SLASH_COMMANDS.length);
    assert.ok(matches.some((c) => c.name === "/help"));
    assert.ok(matches.some((c) => c.name === "/model"));
    assert.ok(matches.some((c) => c.name === "/history"));
    assert.ok(matches.some((c) => c.name === "/undo"));
    assert.ok(matches.some((c) => c.name === "/clear"));
  });

  test("typing '/m' filters to /model and /messages", () => {
    const matches = filterCommands("/m");
    const names = matches.map((c) => c.name);
    assert.ok(names.includes("/model"));
    assert.ok(names.includes("/messages"));
    assert.ok(!names.includes("/help"));
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

