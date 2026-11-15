import { formatToolArgs } from "./format.js";

// Clean, unified terminal logger for agent operations
export const logger = {
  toolCall(name: string, args: any) {
    const formatted = formatToolArgs(args);
    console.log(`\n→ ${name}(${formatted})`);
  },

  toolError(name: string, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ↳ [${name} error] ${msg}`);
  },

  info(message: string) {
    console.log(message);
  },

  warn(message: string) {
    console.log(`\n⚠ ${message}`);
  },

  error(message: string) {
    console.error(`\n[error] ${message}`);
  },
};

