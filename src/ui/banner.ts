import { colors, paint, BOLD } from "./ansi.js";

const LETTERS: Record<string, string[]> = {
  C: [" ████ ", "██    ", "██    ", "██    ", " ████ "],
  O: [" ████ ", "██  ██", "██  ██", "██  ██", " ████ "],
  D: ["█████ ", "██  ██", "██  ██", "██  ██", "█████ "],
  E: ["██████", "██    ", "█████ ", "██    ", "██████"],
  F: ["██████", "██    ", "█████ ", "██    ", "██    "],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
  X: ["██  ██", " ██ ██", "  ██  ", " ██ ██", "██  ██"],
  R: ["█████ ", "██  ██", "█████ ", "██  ██", "██  ██"],
};

export function logoLines(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    rows.push(
      "CODEFIXER"
        .split("")
        .map((ch) => LETTERS[ch]?.[r] ?? "     ")
        .join(" "),
    );
  }
  return rows.map((line) => paint(line, colors.accent, BOLD));
}

export function welcomeLines(version = "0.1.0"): string[] {
  const v = version ? `v${version}` : "v0.1.0";
  return [
    "",
    ...logoLines(),
    "",
    paint("  A terminal coding agent powered by Mirascope + Ollama", colors.text),
    paint(`  ${v}  ·  Ready to help build, fix, and explain code`, colors.dim),
    "",
    paint("  Commands:", colors.accent, BOLD),
    paint("    /help      List all available interactive commands", colors.dim),
    paint("    /history   View checkpoints and recent changes", colors.dim),
    paint("    /undo      Revert the most recent change", colors.dim),
    paint("    /messages  Inspect conversation history & diffs", colors.dim),
    "",
    paint("  Quick start:", colors.accent, BOLD),
    paint('    • "Explain the codebase structure"', colors.dim),
    paint('    • "Run tests and fix any failing cases"', colors.dim),
    paint('    • "Refactor a file or add a new feature"', colors.dim),
    "",
  ];
}
