# codefixer

A fast, terminal coding assistant powered by [Mirascope](https://mirascope.com).

## Overview

Codefixer is an autonomous CLI coding agent that inspects your repository, answers architectural questions, and executes surgical code edits. It runs directly in your terminal using a pluggable microkernel architecture. Users can configure any LLM provider (Ollama, OpenAI, OpenRouter, Groq, Anthropic, etc.) directly in the terminal using `/configure-model`.

## Terminal Interface

When run in a real terminal, Codefixer opens a full-screen TUI (no extra
dependencies) with a progress header, a scrolling conversation pane, a framed
input box, a status bar showing the model/provider and current directory &
branch, and a session sidebar on wide terminals.

| Key | Action |
|---|---|
| `Enter` | Send the current message |
| `↑` / `↓` | Browse previous messages |
| `←` / `→` | Move the cursor in the input |
| `Ctrl+C` / `Ctrl+D` | Clear the input, or exit when it is empty |
| `Ctrl+P` | Show available slash commands |
| `Shift+Tab` | Show available agents |

If stdin/stdout are not a TTY (for example in CI or when piping input),
Codefixer falls back to a plain `readline` prompt with the same commands.

## Getting Started

### Prerequisites
- Node.js >= 22
- [Ollama](https://ollama.com) running locally with your desired coding model:
  ```bash
  ollama pull hhao/qwen2.5-coder-tools:1.5b
  ```

### Installation & Run

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start interactive CLI
npm start
# or during development:
npm run dev
```

### Configuring a Model

Configure your model and LLM provider interactively in the REPL:

```text
> /configure-model
Enter model URL (e.g. http://localhost:11434/v1 or https://api.openai.com/v1)
Enter API key (leave blank for local models)
Enter model name
```

Or select from configured models using `/models`. You can also specify an initial model with the `CODEFIXER_MODEL` environment variable.
with no changes — rephrase the request or switch models if that happens.

---

## Persistent History Management

Codefixer includes built-in, zero-risk change tracking with **Persistent History Management**. Every time the agent creates, modifies, or deletes a file, a pre-mutation snapshot is automatically captured in `.codefixer/history/`.

### Key Features
- **Automatic Checkpointing**: File contents are snapshotted and deduplicated via content hashing before any write or delete occurs.
- **Instant Rollback**: Revert single changes, restore deleted files, or undo entire turns at any time.
- **Git Friendly**: Works standalone or alongside Git without creating dirty worktree clutter. `.codefixer/` is ignored by default.

### CLI Commands

Within the interactive REPL:

| Command | Description |
|---|---|
| `/configure-model` | Add and configure a new model (prompts for URL, API key, and name) |
| `/models` | List stored models and select an active model |
| `/model [name]` | View active model or switch directly |
| `/messages` | List your numbered messages with how many file changes each produced |
| `/history` | View recent checkpoints with timestamps, descriptions, and changed files |
| `/undo` | Revert the most recent change |
| `/revert <n>` | Revert all changes made from message `n` onward |
| `/revert <checkpoint_id>` | Rollback all modifications to a specific checkpoint ID |
| `/revert file <path>` | Revert an individual file to its previous state |
| `/clear` | Clear conversation screen |
| `/help` | Display available commands |
| `exit` or `quit` | Exit the REPL |

### Example Usage

```text
> Add an exported slugify helper to src/utils/format.ts
→ read_file(path: "src/utils/format.ts")
→ edit_file(path: "src/utils/format.ts")
Added slugify helper to src/utils/format.ts.

> /messages
Messages:
  1. Add an exported slugify helper to src/utils/format.ts  (1 change)

> /history
Recent Checkpoints:
   • [cp_1731693800_a1b2c3] 11:23:20 PM - edit_file: src/utils/format.ts (~ src/utils/format.ts)

> /revert 1
✓ Reverted all changes from message 1 onward: src/utils/format.ts
```

> Revert is intentionally **not** an agent tool. Like other coding agents, history actions are deterministic user commands (`/undo`, `/revert`) executed directly by the REPL — the model is never asked to revert on its own.

---

## Architecture

Codefixer is built using a **Microkernel Architecture**:

```
src/
├── core/
│   ├── agent.ts     # Mirascope LLM definition and system prompt
│   ├── kernel.ts    # Execution kernel coordinating prompt turns & tool dispatch
│   ├── history.ts   # Persistent History & Checkpoint Manager
│   ├── models.ts    # Configured Models Storage & Provider Management
│   ├── registry.ts  # Microkernel Tool Registry
│   └── session.ts   # Session state tracking
├── tools/
│   ├── fs.ts        # File tools (read, write, edit, insert, replace, delete)
│   ├── shell.ts     # Shell execution tool
│   ├── finish.ts    # Task completion tool
│   └── index.ts     # Tool plugin registration & exports
├── types/           # Strongly typed domain & contract definitions
├── utils/           # Shared utilities (path safety, formatting, parsers, logger)
├── repl.ts          # Terminal REPL interface
└── index.ts         # Executable entry point
```

## Running Tests

Unit tests run using Node's native test runner via `tsx`:

```bash
npm test
```
