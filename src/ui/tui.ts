import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  BOLD,
  CLEAR_SCREEN,
  CLEAR_TO_EOL,
  HIDE_CURSOR,
  HOME,
  NO_REVERSE,
  RESET,
  REVERSE,
  SHOW_CURSOR,
  colors,
  fit,
  paint,
  visualWidth,
} from "./ansi.js";
import { welcomeLines } from "./banner.js";

export interface TuiStatus {
  mode: string;
  model: string;
  provider: string;
  cwd: string;
  branch: string;
}

const MAX_TRANSCRIPT_LINES = 1000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Modern, rock-solid terminal UI with fixed responsive layout:
 * - Header with status badge & spinner
 * - Scrollable conversation & welcome pane
 * - Pixel-perfect framed input box
 * - Clean status & HUD bar
 * - Optional session & shortcut sidebar on wide screens
 */
export class Tui {
  private active = false;
  private transcript: string[] = [];
  private welcome: string[] = [];
  private version = "";
  private placeholder = "Type a message…";
  private input = "";
  private cursor = 0;
  private awaitingInput = false;
  private pendingInput: ((value: string) => void) | null = null;
  private pendingConfirm: ((value: boolean) => void) | null = null;
  private confirmText = "";
  private confirmInput = "";
  private commandHistory: string[] = [];
  private historyIndex = 0;
  private scrollOffset = 0;
  private status: TuiStatus = {
    mode: "Build",
    model: "",
    provider: "",
    cwd: "",
    branch: "",
  };
  private sessions: string[] = ["codefixer", "bash"];
  private busy = false;
  private spinnerIndex = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private renderScheduled = false;
  private hint = "";

  /** Called when the user presses Ctrl+C / Ctrl+D on empty input. */
  onExit: (() => void) | null = null;

  get isActive(): boolean {
    return this.active;
  }

  start(status: Partial<TuiStatus> = {}, version = ""): void {
    if (this.active) return;
    this.active = true;
    this.status = { ...this.status, ...status };
    this.version = version;
    this.welcome = welcomeLines(version);

    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
    this.paintScreen();
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);
    this.render();
  }

  destroy(): void {
    if (!this.active) return;
    this.active = false;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF + RESET);
    this.pendingInput?.("");
    this.pendingConfirm?.(false);
    this.pendingInput = null;
    this.pendingConfirm = null;
  }

  // ---- Output ------------------------------------------------------------

  print(text: string): void {
    if (!this.active) return;
    for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
      this.transcript.push(this.formatLine(rawLine));
    }
    if (this.transcript.length > MAX_TRANSCRIPT_LINES) {
      this.transcript = this.transcript.slice(-MAX_TRANSCRIPT_LINES);
    }
    // Snap scroll to bottom on new output
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  private formatLine(raw: string): string {
    if (!raw) return "";
    // If it already has ANSI styling, keep it
    if (raw.includes("\x1b[")) return raw;

    if (raw.startsWith("# ")) return paint(raw, colors.white, BOLD);
    if (raw.startsWith("## ")) return paint(raw, colors.accent, BOLD);
    if (raw.startsWith("### ")) return paint(raw, colors.cyan, BOLD);
    if (raw.startsWith("✓ ")) return paint(raw, colors.green, BOLD);
    if (raw.startsWith("✗ ")) return paint(raw, colors.red, BOLD);
    if (raw.startsWith("⚠ ")) return paint(raw, colors.orange, BOLD);
    if (/^\s*[-*•]\s/.test(raw)) {
      return raw.replace(/^\s*[-*•]\s/, paint("  • ", colors.accent));
    }
    return paint(raw, colors.text);
  }

  clear(): void {
    this.transcript = [];
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  setStatus(patch: Partial<TuiStatus>): void {
    this.status = { ...this.status, ...patch };
    this.scheduleRender();
  }

  setSessions(sessions: string[]): void {
    this.sessions = sessions;
    this.scheduleRender();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy && !this.spinnerTimer) {
      this.spinnerTimer = setInterval(() => {
        this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
        this.scheduleRender();
      }, 90);
    } else if (!busy && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      this.scheduleRender();
    }
  }

  // ---- Input -------------------------------------------------------------

  prompt(placeholder = "Ask Codefixer anything…"): Promise<string> {
    this.placeholder = placeholder;
    this.input = "";
    this.cursor = 0;
    this.hint = "";
    this.awaitingInput = true;
    this.historyIndex = this.commandHistory.length;
    return new Promise((resolve) => {
      this.pendingInput = resolve;
      this.scheduleRender();
    });
  }

  confirm(question: string, destructive = false): Promise<boolean> {
    this.print(question);
    this.confirmText = destructive
      ? 'Type "yes-really" to confirm, anything else to abort'
      : "Allow? [y/N]";
    this.confirmInput = "";
    return new Promise((resolve) => {
      this.pendingConfirm = resolve;
      this.scheduleRender();
    });
  }

  private onData = (data: Buffer): void => {
    if (!this.active) return;
    const s = data.toString("utf8");
    if (this.pendingConfirm) {
      this.handleConfirmKey(s);
    } else if (this.awaitingInput) {
      this.handleInputKey(s);
    } else if (s === "\x03" || s === "\x04") {
      this.onExit?.();
    }
  };

  private submitInput(): void {
    const resolve = this.pendingInput;
    const value = this.input.trimEnd();
    this.awaitingInput = false;
    this.pendingInput = null;
    if (value) {
      this.commandHistory.push(value);
      this.print(paint("❯ ", colors.accent, BOLD) + paint(value, colors.white, BOLD));
    }
    this.input = "";
    this.cursor = 0;
    resolve?.(value);
  }

  private handleEscape(seq: string): void {
    switch (seq) {
      case "\x1b[A": // Up arrow — previous command in history
        if (this.commandHistory.length) {
          this.historyIndex = Math.max(0, this.historyIndex - 1);
          this.input = this.commandHistory[this.historyIndex] ?? "";
          this.cursor = this.input.length;
        }
        break;
      case "\x1b[B": // Down arrow — newer command
        this.historyIndex = Math.min(
          this.commandHistory.length,
          this.historyIndex + 1,
        );
        this.input = this.commandHistory[this.historyIndex] ?? "";
        this.cursor = this.input.length;
        break;
      case "\x1b[C": // Right arrow
        this.cursor = Math.min(this.input.length, this.cursor + 1);
        break;
      case "\x1b[D": // Left arrow
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case "\x1b[H": // Home
      case "\x1b[1~":
        this.cursor = 0;
        break;
      case "\x1b[F": // End
      case "\x1b[4~":
        this.cursor = this.input.length;
        break;
      case "\x1b[5~": // PageUp — scroll back
      case "\x1b[1;5A": // Ctrl+Up
        this.scrollOffset = Math.min(
          Math.max(0, this.transcript.length - 1),
          this.scrollOffset + 5,
        );
        break;
      case "\x1b[6~": // PageDown — scroll forward
      case "\x1b[1;5B": // Ctrl+Down
        this.scrollOffset = Math.max(0, this.scrollOffset - 5);
        break;
      case "\x1b[Z": // Shift+Tab — agents hint
        this.hint = `Active agent: ${this.sessions[0] ?? "codefixer"} (default)`;
        break;
    }
  }

  private handleInputKey(s: string): void {
    let i = 0;
    while (i < s.length) {
      const ch = s[i];

      if (ch === "\x1b") {
        const match = /^\x1b\[[0-9;?]*[A-Za-z~]/.exec(s.slice(i));
        if (match) {
          this.handleEscape(match[0]);
          i += match[0].length;
          continue;
        }
        i++;
        continue;
      }

      if (ch === "\r" || ch === "\n") {
        this.submitInput();
      } else if (ch === "\x03" || ch === "\x04") {
        if (this.input.length > 0) {
          this.input = "";
          this.cursor = 0;
        } else {
          this.onExit?.();
        }
      } else if (ch === "\x7f" || ch === "\x08") {
        if (this.cursor > 0) {
          this.input =
            this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor--;
        }
      } else if (ch === "\x15") {
        // Ctrl+U: clear input
        this.input = "";
        this.cursor = 0;
      } else if (ch === "\x0b") {
        // Ctrl+K: clear to end of line
        this.input = this.input.slice(0, this.cursor);
      } else if (ch === "\x01") {
        // Ctrl+A: go to start
        this.cursor = 0;
      } else if (ch === "\x05") {
        // Ctrl+E: go to end
        this.cursor = this.input.length;
      } else if (ch === "\x10") {
        // Ctrl+P: show commands
        this.hint = "Commands: /messages /history /undo /revert file <path> /help";
      } else if (ch >= " ") {
        this.input =
          this.input.slice(0, this.cursor) + ch + this.input.slice(this.cursor);
        this.cursor++;
        this.hint = "";
      }
      i++;
    }
    this.scheduleRender();
  }

  private finishConfirm(result: boolean): void {
    const resolve = this.pendingConfirm;
    this.pendingConfirm = null;
    this.print(
      paint(result ? "✓ Allowed" : "✗ Cancelled", result ? colors.green : colors.red, BOLD),
    );
    resolve?.(result);
  }

  private handleConfirmKey(s: string): void {
    const destructive = this.confirmText.startsWith("Type");
    let i = 0;
    while (i < s.length) {
      const ch = s[i];

      if (ch === "\r" || ch === "\n") {
        if (destructive) {
          const resolve = this.pendingConfirm;
          const ok = this.confirmInput.trim() === "yes-really";
          this.pendingConfirm = null;
          this.confirmInput = "";
          this.print(
            paint(
              ok ? "✓ Confirmed" : "✗ Aborted",
              ok ? colors.green : colors.red,
              BOLD,
            ),
          );
          resolve?.(ok);
        } else {
          this.finishConfirm(false);
        }
        i++;
        continue;
      }

      if (destructive) {
        if (ch === "\x7f" || ch === "\x08") {
          this.confirmInput = this.confirmInput.slice(0, -1);
        } else if (ch >= " ") {
          this.confirmInput += ch;
        }
      } else {
        const lower = ch.toLowerCase();
        if (lower === "y") {
          this.finishConfirm(true);
          break;
        }
        if (lower === "n" || ch === "\x03") {
          this.finishConfirm(false);
          break;
        }
      }
      i++;
    }
    this.scheduleRender();
  }

  // ---- Rendering ---------------------------------------------------------

  private onResize = (): void => {
    if (!this.active) return;
    this.paintScreen();
    this.scheduleRender();
  };

  private paintScreen(): void {
    process.stdout.write(CLEAR_SCREEN + HOME + RESET);
  }

  private scheduleRender(): void {
    if (this.renderScheduled || !this.active) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private render(): void {
    if (!this.active) return;
    const cols = Math.max(48, process.stdout.columns || 100);
    const rows = Math.max(16, process.stdout.rows || 30);
    const sidebarW = cols >= 96 ? 26 : 0;
    const mainW = cols - sidebarW;
    const out: string[] = [];

    // Layout rows:
    // Row 1: Header bar
    // Rows 2 .. inputTop - 1: Conversation or Welcome Banner
    // Row inputTop: Input box top border ╭─────────╮
    // Row inputTop + 1: Input text line  │ ❯ ...   │
    // Row inputTop + 2: Input box bottom ╰─────────╯
    // Row rows - 1: Status bar
    // Row rows: Empty / border buffer
    const inputTop = Math.max(4, rows - 4);
    const visibleLines = Math.max(1, inputTop - 2);

    // Sidebar line buffer (if visible)
    const sidebarLines: string[] = [];
    if (sidebarW > 0) {
      sidebarLines.push(paint(" Sessions", colors.white, BOLD));
      for (let i = 0; i < this.sessions.length; i++) {
        const name = this.sessions[i];
        const isActive = i === 0;
        sidebarLines.push(
          (isActive ? paint("▸ ", colors.accent) : "  ") +
            paint(name, isActive ? colors.text : colors.dim, isActive ? BOLD : ""),
        );
      }
      sidebarLines.push(paint("─".repeat(sidebarW - 3), colors.dim));
      sidebarLines.push(paint(" Shortcuts", colors.white, BOLD));
      sidebarLines.push(paint("/help     ", colors.accent) + paint("commands", colors.dim));
      sidebarLines.push(paint("/history  ", colors.accent) + paint("checkpoints", colors.dim));
      sidebarLines.push(paint("/undo     ", colors.accent) + paint("revert last", colors.dim));
      sidebarLines.push(paint("/messages ", colors.accent) + paint("turns", colors.dim));
      sidebarLines.push(paint("─".repeat(sidebarW - 3), colors.dim));
      sidebarLines.push(paint(" Status", colors.white, BOLD));
      sidebarLines.push(
        paint("Mode: ", colors.dim) + paint(this.status.mode || "Build", colors.text),
      );
      if (this.status.provider) {
        sidebarLines.push(
          paint("Provider: ", colors.dim) + paint(this.status.provider, colors.green),
        );
      }
      if (this.status.branch) {
        sidebarLines.push(
          paint("Branch: ", colors.dim) + paint(this.status.branch, colors.text),
        );
      }
      if (this.version) {
        sidebarLines.push(paint("─".repeat(sidebarW - 3), colors.dim));
        sidebarLines.push(paint("v" + this.version, colors.dim));
      }
    }

    // Compose every row strictly to prevent any ghost artifacts or bleed
    for (let y = 1; y <= rows; y++) {
      let mainText = "";

      if (y === 1) {
        // --- Header Bar ---
        const badge = paint(" CODEFIXER ", colors.white, colors.accentBg, BOLD);
        const spinner = this.busy
          ? " " + paint(SPINNER[this.spinnerIndex] + " Thinking…", colors.accent, BOLD)
          : " " + paint("● Ready", colors.green);
        const left = " " + badge + spinner;
        const right = paint("Ctrl+C exit  ·  /help", colors.dim) + " ";
        const space = Math.max(1, mainW - 1 - visualWidth(left) - visualWidth(right));
        mainText = left + " ".repeat(space) + right;
      } else if (y >= 2 && y < inputTop) {
        // --- Main Conversation or Welcome Banner ---
        const convIndex = y - 2;
        const isWelcome = this.transcript.length === 0;

        if (isWelcome) {
          if (convIndex < this.welcome.length) {
            const line = this.welcome[convIndex] ?? "";
            const textWidth = visualWidth(line);
            const padLeft = Math.max(2, Math.floor((mainW - 1 - textWidth) / 2));
            mainText = " ".repeat(padLeft) + line;
          } else {
            mainText = "";
          }
        } else {
          // If at the bottom of the conversation area and there is a hint or scroll offset:
          if (convIndex === visibleLines - 1 && this.hint) {
            mainText = "  " + paint(this.hint, colors.orange);
          } else if (convIndex === visibleLines - 1 && this.scrollOffset > 0) {
            mainText =
              "  " +
              paint(
                `▲ Scrolled up (${this.scrollOffset} lines) — PageDown to scroll to bottom`,
                colors.orange,
              );
          } else {
            const total = this.transcript.length;
            const start = Math.max(0, total - visibleLines - this.scrollOffset);
            const lineIdx = start + convIndex;
            if (lineIdx >= 0 && lineIdx < total) {
              mainText = "  " + this.transcript[lineIdx];
            } else {
              mainText = "";
            }
          }
        }
      } else if (y === inputTop) {
        // --- Framed Input Box Top Border ---
        const boxW = Math.max(20, mainW - 4);
        const borderColor = this.busy ? colors.accent : colors.dim;
        mainText = "  " + paint("╭" + "─".repeat(boxW - 2) + "╮", borderColor);
      } else if (y === inputTop + 1) {
        // --- Framed Input Box Content Line ---
        const boxW = Math.max(20, mainW - 4);
        const borderColor = this.busy ? colors.accent : colors.dim;
        const isConfirm = Boolean(this.pendingConfirm);

        const mark = isConfirm
          ? paint(" ? ", colors.white, colors.orangeBg, BOLD)
          : paint(" ❯ ", colors.white, colors.accentBg, BOLD);

        // Box border length is boxW + 2 total visible characters.
        // Left side: "  " (2) + "│" (1) + " " (1) + mark (3) + " " (1) = 8
        // Right side: " " (1) + "│" (1) = 2
        // Total outer length: 8 + innerW + 2 = 10 + innerW
        // Box border outer length is boxW + 2, so innerW = boxW - 8
        const innerW = Math.max(1, boxW - 8);

        let inputFormatted = "";
        if (isConfirm) {
          const val =
            this.confirmText + (this.confirmInput ? " " + this.confirmInput : "");
          inputFormatted = paint(val, colors.orange, BOLD);
        } else if (this.input) {
          const before = this.input.slice(0, this.cursor);
          const cursorChar = this.input[this.cursor] ?? " ";
          const after = this.input.slice(this.cursor + 1);
          inputFormatted =
            paint(before, colors.text) +
            REVERSE +
            cursorChar +
            NO_REVERSE +
            paint(after, colors.text);
        } else {
          inputFormatted = paint(this.placeholder, colors.dim);
        }

        const fittedInput = fit(inputFormatted, innerW);
        mainText =
          "  " +
          paint("│", borderColor) +
          " " +
          mark +
          " " +
          fittedInput +
          " " +
          paint("│", borderColor);
      } else if (y === inputTop + 2) {
        // --- Framed Input Box Bottom Border ---
        const boxW = Math.max(20, mainW - 4);
        const borderColor = this.busy ? colors.accent : colors.dim;
        mainText = "  " + paint("╰" + "─".repeat(boxW - 2) + "╯", borderColor);
      } else if (y === rows - 1) {
        // --- Status Bar ---
        const status = this.status;
        const modeBadge = paint(` ${status.mode} `, colors.white, colors.panel, BOLD);
        const providerText = status.provider
          ? paint(`● ${status.provider}`, colors.green) + " · "
          : "";
        const modelText = paint(status.model || "default", colors.text, BOLD);
        const left = "  " + modeBadge + " " + providerText + modelText;

        const branchPart = status.branch ? `⎇ ${status.branch}  ` : "";
        const cwdPart = status.cwd ? `📁 ${status.cwd}  ` : "";
        const right = paint(cwdPart + branchPart + "↑/↓ history", colors.dim) + " ";

        const space = Math.max(1, mainW - 1 - visualWidth(left) - visualWidth(right));
        mainText = left + " ".repeat(space) + right;
      } else {
        // Bottom-most spacer line
        mainText = "";
      }

      // Exact fit to main pane width
      const fittedMain = fit(mainText, mainW - 1);

      // Append sidebar if active
      let sideText = "";
      if (sidebarW > 0) {
        const sideContent = sidebarLines[y - 1] ?? "";
        sideText = paint("│", colors.dim) + " " + fit(sideContent, sidebarW - 2);
      }

      out.push(`\x1b[${y};1H${fittedMain}${sideText}${CLEAR_TO_EOL}`);
    }

    process.stdout.write(out.join(""));
  }
}

// Active instance registry so the logger / confirmation helpers can route
// their output into the UI while it is running.
let activeTui: Tui | null = null;

export function setActiveTui(tui: Tui | null): void {
  activeTui = tui;
}

export function getActiveTui(): Tui | null {
  return activeTui;
}
