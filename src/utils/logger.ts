import { formatToolArgs } from "./format.js";
import { getActiveTui } from "../ui/tui.js";
import { BOLD, colors, paint } from "../ui/ansi.js";

export const logger = {
  toolCall(name: string, args: unknown) {
    const formatted = formatToolArgs(
      args && typeof args === "object" ? (args as Record<string, unknown>) : null,
    );
    const tui = getActiveTui();
    if (tui?.isActive) {
      tui.print(
        paint("  ⚡ ", colors.cyan, BOLD) +
          paint(name, colors.white, BOLD) +
          (formatted ? paint(`(${formatted})`, colors.dim) : ""),
      );
    } else {
      console.log(`\n⚡ ${name}(${formatted})`);
    }
  },

  toolError(name: string, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const tui = getActiveTui();
    if (tui?.isActive) {
      tui.print(paint(`  ✗ [${name} error] ${msg}`, colors.red, BOLD));
    } else {
      console.error(`  ↳ [${name} error] ${msg}`);
    }
  },

  info(message: string) {
    const tui = getActiveTui();
    if (tui?.isActive) tui.print(message);
    else console.log(message);
  },

  warn(message: string) {
    const tui = getActiveTui();
    if (tui?.isActive) {
      tui.print(paint(`  ⚠ ${message}`, colors.orange));
    } else {
      console.log(`\n⚠ ${message}`);
    }
  },

  error(message: string) {
    const tui = getActiveTui();
    if (tui?.isActive) {
      tui.print(paint(`  ✗ ${message}`, colors.red, BOLD));
    } else {
      console.error(`\n✗ ${message}`);
    }
  },
};
