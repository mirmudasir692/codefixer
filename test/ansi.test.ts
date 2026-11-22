import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  stripAnsi,
  visualWidth,
  clip,
  fit,
  pad,
  paint,
  colors,
  BOLD,
} from "../src/ui/ansi.js";

describe("ANSI and Layout Utilities", () => {
  test("stripAnsi removes all escape codes", () => {
    const styled = paint("Hello world", colors.accent, BOLD);
    assert.equal(stripAnsi(styled), "Hello world");
  });

  test("visualWidth measures visible width accurately", () => {
    const styled = paint("Status: OK", colors.green);
    assert.equal(visualWidth(styled), 10);
    assert.equal(visualWidth("hello\tworld"), 12); // tab converted to 2 spaces
  });

  test("clip truncates text exceeding width and preserves length constraint", () => {
    const text = "123456789012345";
    const clipped = clip(text, 10);
    assert.equal(visualWidth(clipped), 10);
    assert.ok(clipped.endsWith("…\x1b[0m"));

    const short = "hello";
    assert.equal(clip(short, 10), "hello");
  });

  test("fit guarantees exact terminal cell width", () => {
    const short = paint("hi", colors.accent);
    const fittedShort = fit(short, 10);
    assert.equal(visualWidth(fittedShort), 10);

    const long = "This is a very long string that needs truncation";
    const fittedLong = fit(long, 15);
    assert.equal(visualWidth(fittedLong), 15);

    const empty = fit("", 8);
    assert.equal(empty, "        ");
    assert.equal(visualWidth(empty), 8);
  });

  test("pad appends spaces up to target width", () => {
    const text = "test";
    assert.equal(pad(text, 6), "test  ");
    assert.equal(pad(text, 2), "test");
  });
});

