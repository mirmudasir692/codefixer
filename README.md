# codefixer

A fast, terminal coding assistant powered by [Mirascope](https://mirascope.com) and local Ollama models.

## Overview

Codefixer is an autonomous CLI coding agent that inspects your repository, answers architectural questions, and executes surgical code edits. It runs directly in your terminal using a pluggable microkernel architecture.

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
| `/history` | View recent checkpoints with timestamps, descriptions, and changed files |
| `/undo` | Revert the most recent change |
| `/revert <checkpoint_id>` | Rollback all modifications to a specific checkpoint ID |
| `/revert file <path>` | Revert an individual file to its previous state |
| `/help` | Display available commands |
| `exit` or `quit` | Exit the REPL |

### Example Usage

```text
> Add an exported slugify helper to src/utils/format.ts
→ read_file(path: "src/utils/format.ts")
→ edit_file(path: "src/utils/format.ts")
Added slugify helper to src/utils/format.ts.

> /history
Recent Checkpoints:
  • [cp_1731693800_a1b2c3] 11:23:20 PM - edit_file: src/utils/format.ts (~ src/utils/format.ts)

> /undo
✓ Reverted change [cp_1731693800_a1b2c3]: src/utils/format.ts
```

### Agent Tool: `revert_file`

The agent also has access to the `revert_file` tool. If a test or edit causes a regression, or if you ask the agent directly (`"revert the changes to src/utils/format.ts"`), the agent can revert the file autonomously with your confirmation.

---

## Architecture

Codefixer is built using a **Microkernel Architecture**:

```
src/
├── core/
│   ├── agent.ts     # Mirascope LLM definition and system prompt
│   ├── kernel.ts    # Execution kernel coordinating prompt turns & tool dispatch
│   ├── history.ts   # Persistent History & Checkpoint Manager
│   ├── registry.ts  # Microkernel Tool Registry
│   └── session.ts   # Session state tracking
├── tools/
│   ├── fs.ts        # File tools (read, write, edit, insert, replace, delete)
│   ├── revert.ts    # Revert tool plugin
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
