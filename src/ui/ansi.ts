export const ESC = "\x1b[";

export const RESET = `${ESC}0m`;
export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;
export const REVERSE = `${ESC}7m`;
export const NO_REVERSE = `${ESC}27m`;
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
export const ALT_SCREEN_ON = `${ESC}?1049h`;
export const ALT_SCREEN_OFF = `${ESC}?1049l`;
export const CLEAR_SCREEN = `${ESC}2J`;
export const CLEAR_LINE = `${ESC}2K`;
export const CLEAR_TO_EOL = `${ESC}K`;
export const HOME = `${ESC}H`;

export function fg(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

export function bg(r: number, g: number, b: number): string {
  return `${ESC}48;2;${r};${g};${b}m`;
}

export const colors = {
  bg: bg(13, 13, 15),
  panel: bg(28, 28, 33),
  text: fg(212, 212, 216),
  white: fg(242, 242, 247),
  dim: fg(112, 112, 122),
  accent: fg(78, 167, 252),
  accentBg: bg(35, 104, 180),
  green: fg(80, 200, 140),
  purple: fg(197, 134, 192),
  orange: fg(240, 175, 105),
  orangeBg: bg(180, 90, 20),
  red: fg(235, 110, 110),
  cyan: fg(100, 210, 255),
};

export function paint(text: string, ...styles: string[]): string {
  return `${styles.join("")}${text}${RESET}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function visualWidth(text: string): number {
  return stripAnsi(text.replace(/\t/g, "  ")).length;
}

export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  text = text.replace(/\t/g, "  ");
  if (visualWidth(text) <= width) return text;
  if (width <= 1) return paint("…", colors.dim);

  const maxVisible = width - 1;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < text.length && visible < maxVisible) {
    if (text[i] === "\x1b") {
      const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(text.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    out += text[i];
    visible++;
    i++;
  }
  return out + paint("…", colors.dim);
}

export function pad(text: string, width: number): string {
  const diff = width - visualWidth(text);
  return diff > 0 ? text + " ".repeat(diff) : text;
}

export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = clip(text, width);
  const diff = width - visualWidth(clipped);
  return diff > 0 ? clipped + " ".repeat(diff) : clipped;
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 15) return [text];
  text = text.replace(/\t/g, "  ");
  if (visualWidth(text) <= width) return [text];

  const lines: string[] = [];
  const rawLines = text.split("\n");

  for (const rawLine of rawLines) {
    if (visualWidth(rawLine) <= width) {
      lines.push(rawLine);
      continue;
    }

    const plain = stripAnsi(rawLine);
    const indentMatch = /^(?:\s*[-*•]\s+|\s+)/.exec(plain);
    const prefix = indentMatch ? indentMatch[0] : "";
    const indent = indentMatch ? " ".repeat(indentMatch[0].length) : "";

    const body = indentMatch ? rawLine.slice(prefix.length) : rawLine;
    const words = body.split(/\s+/).filter(Boolean);
    let currentLine = prefix;

    for (const word of words) {
      const candidate = currentLine === prefix ? `${prefix}${word}` : `${currentLine} ${word}`;
      if (visualWidth(candidate) <= width) {
        currentLine = candidate;
      } else {
        if (currentLine && currentLine !== prefix) {
          lines.push(currentLine);
          currentLine = indent ? `${indent}${word}` : word;
        } else {
          lines.push(clip(candidate, width));
          currentLine = "";
        }
      }
    }
    if (currentLine && currentLine !== prefix) {
      lines.push(currentLine);
    }
  }

  return lines;
}
