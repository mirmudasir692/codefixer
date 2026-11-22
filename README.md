# Codefixer

A fast, autonomous terminal coding assistant powered by [Mirascope](https://mirascope.com).

Codefixer inspects your repository, answers complex architectural questions, and executes surgical code modifications directly in your terminal. It features a pluggable microkernel architecture, zero-risk persistent file checkpoints, and full support for any OpenAI-compatible LLM provider (Ollama, OpenAI, Groq, OpenRouter, Together, DeepSeek, and more).

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Configuring LLM Providers & Models](#configuring-llm-providers--models)
  - [Adding a Model (`/configure-model`)](#adding-a-model-configure-model)
  - [Choosing an Active Model (`/models`)](#choosing-an-active-model-models)
  - [Common Provider Examples](#common-provider-examples)
- [Terminal Interface (TUI)](#terminal-interface-tui)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Slash Command Autocomplete](#slash-command-autocomplete)
  - [`@` File & Directory Mentions](#-file--directory-mentions)
- [CLI Commands Reference](#cli-commands-reference)
- [Persistent History Management](#persistent-history-management)
  - [How It Works](#how-it-works)
  - [Rollback Examples](#rollback-examples)
- [Architecture & Tools](#architecture--tools)
- [Development & Testing](#development--testing)

---

## Features

- **Provider Agnostic**: Use any local LLM (via Ollama, LM Studio, vLLM) or cloud API (OpenAI, Groq, OpenRouter, DeepSeek). Configure endpoints and credentials directly from the CLI.
- **Zero-Dependency Terminal UI (TUI)**: Full-screen interactive terminal interface featuring real-time spinner feedback, formatted conversational history, status bar, and collapsible sidebar.
- **`@` Path Mentions**: Type `@` to autocomplete project files and directories, automatically attaching targeted file content as context.
- **Zero-Risk File Mutations**: Built-in snapshotting before any file creation, edit, or deletion. Roll back individual files, recent changes, or entire conversation turns anytime with `/undo` and `/revert`.
- **Microkernel Architecture**: Pluggable tool registry with safe filesystem tools (`read_file`, `write_file`, `edit_file`, `insert_file`, `replace_lines`, `delete_file`), sandboxed shell execution (`run_shell`), and task completion (`finish`).

---

## Prerequisites

- **Node.js**: Version `>= 22.0.0`
- **An LLM Provider** of your choice:
  - **Local (Ollama)**: Running locally on `http://localhost:11434`
  - **Cloud API**: OpenAI, Groq, OpenRouter, Anthropic, Together, etc.

---

## Installation & Setup

### Option 1: Install Globally via GitHub (Recommended)

You can install Codefixer directly from GitHub using npm:

```bash
npm install -g github:mirmudasir692/codefixer
```

Now you can run Codefixer from **any project or directory**:

```bash
codefixer
```

To update to the latest version anytime:

```bash
npm install -g github:mirmudasir692/codefixer
```

---

### Option 2: Run Instantly with `npx` (Zero Install)

Run Codefixer directly in any folder without installing it permanently:

```bash
npx github:mirmudasir692/codefixer
```

---

### Option 3: Local Development Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/mirmudasir692/codefixer.git
   cd codefixer
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Build TypeScript**:

   ```bash
   npm run build
   ```

4. **Link globally for local development**:

   ```bash
   npm link
   # now 'codefixer' command points to your local repo!
   ```

5. **Start Codefixer**:
   ```bash
   codefixer
   # or run directly with tsx:
   npm run dev
   ```

---

## Configuring LLM Providers & Models

Codefixer is decoupled from any hardcoded model. You can configure multiple models and switch between them anytime.

### Adding a Model (`/configure-model`)

Run `/configure-model` inside the REPL. You will be prompted for:

1. **Model URL**: The API base URL (e.g. `http://localhost:11434/v1` or `https://api.openai.com/v1`). If `/v1` is omitted, Codefixer normalizes it automatically.
2. **API Key**: Your API key (leave blank for local Ollama models).
3. **Model Name**: The model identifier (e.g. `qwen2.5-coder:7b`, `gpt-4o`, `llama3.3:70b`).

```text
> /configure-model

--- Configure Model ---
Model URL (e.g. http://localhost:11434/v1 or https://api.openai.com/v1): http://localhost:11434/v1
API Key (leave blank if not required):
Model Name (e.g. qwen2.5:7b, gpt-4o): qwen2.5-coder:7b

✓ Model "qwen2.5-coder:7b" configured and saved successfully!
Choose it anytime using /models or /models qwen2.5-coder:7b
```

Models are saved persistently in `~/.codefixer/models.json` (or the path set by `CODEFIXER_MODELS_PATH`).

### Choosing an Active Model (`/models`)

Run `/models` to view all saved models:

```text
> /models

Configured Models:
  1. qwen2.5-coder:7b (http://localhost:11434/v1) [active]
  2. gpt-4o (https://api.openai.com/v1)
  3. deepseek-coder (https://api.deepseek.com/v1)

Select a model (1-3 or name, or press Enter to cancel): 2

✓ Switched model to gpt-4o (https://api.openai.com/v1)
```

You can also switch directly by number or name:

```text
> /models 1
> /models gpt-4o
```

### Common Provider Examples

| Provider           | Endpoint URL                     | API Key     | Model Name Example                |
| ------------------ | -------------------------------- | ----------- | --------------------------------- |
| **Ollama (Local)** | `http://localhost:11434/v1`      | _(blank)_   | `qwen2.5-coder:7b`, `llama3.2:3b` |
| **OpenAI**         | `https://api.openai.com/v1`      | `sk-...`    | `gpt-4o`, `gpt-4o-mini`           |
| **Groq**           | `https://api.groq.com/openai/v1` | `gsk_...`   | `llama-3.3-70b-versatile`         |
| **OpenRouter**     | `https://openrouter.ai/api/v1`   | `sk-or-...` | `anthropic/claude-3.5-sonnet`     |
| **DeepSeek**       | `https://api.deepseek.com/v1`    | `sk-...`    | `deepseek-chat`, `deepseek-coder` |

> **Environment Variable Override**: You can also launch Codefixer with a specific model directly via `CODEFIXER_MODEL=ollama/qwen2.5:7b npm start`.

---

## Terminal Interface (TUI)

When executed in a standard terminal (TTY), Codefixer launches a full-screen interactive interface with zero external GUI or heavy TUI dependencies.

```text
╭─────────────────────────────────────────────────────────────────────────────╮
│ CODEFIXER ● Ready                                      Ctrl+C exit · /help │
│                                                                             │
│ ❯ Explain the authentication flow in src/auth.ts                            │
│ ⚡ read_file(path: "src/auth.ts")                                           │
│ The authentication system utilizes JWT bearer tokens verified against...     │
│                                                                             │
│ ╭─────────────────────────────────────────────────────────────────────────╮ │
│ │ ❯ Ask Codefixer anything…                                               │ │
│ ╰─────────────────────────────────────────────────────────────────────────╯ │
│   Build  ● Ollama · qwen2.5-coder:7b  📁 ~/my-project  ⎇ main  ↑/↓ history  │
╰─────────────────────────────────────────────────────────────────────────────╯
```

### Keyboard Shortcuts

| Key                                     | Description                                                  |
| --------------------------------------- | ------------------------------------------------------------ |
| <kbd>Enter</kbd>                        | Send input or confirm selected autocomplete item             |
| <kbd>↑</kbd> / <kbd>↓</kbd>             | Navigate command history or autocomplete suggestions         |
| <kbd>←</kbd> / <kbd>→</kbd>             | Move input cursor left/right                                 |
| <kbd>Tab</kbd>                          | Accept top suggestion or autocomplete command / file mention |
| <kbd>Esc</kbd>                          | Close suggestion box                                         |
| <kbd>PageUp</kbd> / <kbd>PageDown</kbd> | Scroll conversation transcript history up/down               |
| <kbd>Ctrl+C</kbd>                       | Clear current line; exit if input is empty                   |
| <kbd>Ctrl+U</kbd>                       | Clear input line                                             |
| <kbd>Ctrl+A</kbd> / <kbd>Ctrl+E</kbd>   | Move cursor to beginning / end of line                       |

_(Non-TTY environments, such as CI pipelines or redirected inputs, automatically fall back to a standard readline prompt)._

### Slash Command Autocomplete

Type `/` to instantly display an interactive command palette. As you type (e.g. `/m` or `/con`), suggestions narrow down. Press <kbd>Tab</kbd> or <kbd>Enter</kbd> to autocomplete.

### `@` File & Directory Mentions

Type `@` followed by any path characters (e.g. `@src/core/`) to trigger the file picker. Selecting a file injects an attached context preview into the conversation turn so the agent has immediate access to that file's contents.

---

## CLI Commands Reference

| Command            | Usage                   | Description                                                        |
| ------------------ | ----------------------- | ------------------------------------------------------------------ |
| `/configure-model` | `/configure-model`      | Interactively configure URL, API key, and name for an LLM provider |
| `/models`          | `/models [name\|index]` | List saved models and select active model                          |
| `/model`           | `/model [name]`         | View active model or switch directly                               |
| `/messages`        | `/messages`             | View numbered conversation messages with file change counters      |
| `/history`         | `/history`              | View recent file modification checkpoints with hashes & timestamps |
| `/undo`            | `/undo`                 | Immediately revert the most recent file change                     |
| `/revert <n>`      | `/revert 2`             | Revert all file changes made from message `n` onward               |
| `/revert <id>`     | `/revert cp_173169...`  | Roll back repository state to a specific checkpoint ID             |
| `/revert file`     | `/revert file <path>`   | Restore a specific file to its previous state                      |
| `/clear`           | `/clear`                | Clear the current conversation transcript                          |
| `/help`            | `/help`                 | Print all available interactive commands                           |
| `exit` / `quit`    | `exit`                  | Exit Codefixer                                                     |

---

## Persistent History Management

Codefixer includes **Persistent History Management** to ensure zero-risk code modifications. Every time the agent creates, edits, or deletes a file, a pre-mutation snapshot is captured in `.codefixer/history/blobs/` and recorded in `checkpoints.json`.

### How It Works

- **Pre-Mutation Snapshots**: Before executing any file write, line replace, or deletion, the existing state is snapshotted using SHA-256 content hashing.
- **Git Friendly**: Works cleanly alongside Git or in non-git directories. `.codefixer/` is ignored by default.
- **Deterministic User Revert**: Revert actions are strictly user commands (`/undo`, `/revert`) handled directly by the REPL runtime—the LLM is never prompted to revert its own changes.

### Rollback Examples

```text
# 1. Ask the agent to modify code
> Refactor logger format in src/utils/logger.ts
⚡ edit_file(path: "src/utils/logger.ts")
✓ Done — changed src/utils/logger.ts (1 change).

# 2. Inspect checkpoints
> /history
Recent Checkpoints:
  • [cp_1732304910_a1b2c3] 10:15:10 PM - edit_file: src/utils/logger.ts (~ src/utils/logger.ts)

# 3. Undo the change
> /undo
✓ Reverted change [cp_1732304910_a1b2c3]: src/utils/logger.ts

# 4. Or revert to a specific message number
> /revert 1
✓ Reverted all changes from message 1 onward: src/utils/logger.ts
```

---

## Architecture & Tools

Codefixer is organized around a clean **Microkernel Architecture**:

```
src/
├── core/
│   ├── agent.ts       # Mirascope LLM call definition, provider registration & agent setup
│   ├── kernel.ts      # Turn execution engine, intent routing & tool execution loop
│   ├── models.ts      # Model configuration store, URL normalization & provider detection
│   ├── history.ts     # Persistent history snapshot & checkpoint manager
│   ├── registry.ts    # Extensible tool registry
│   └── session.ts     # File read/write session cache
├── tools/
│   ├── fs.ts          # Filesystem tools (list_directory, read_file, write_file, edit_file, etc.)
│   ├── shell.ts       # Shell tool (run_shell)
│   ├── finish.ts      # Turn termination tool (finish)
│   └── index.ts       # Tool definitions & exports
├── types/             # Domain interfaces (models, history, tools, TUI)
├── ui/
│   ├── tui.ts         # Full-screen terminal rendering engine
│   ├── ansi.ts        # ANSI formatting & screen layout primitives
│   └── banner.ts      # ASCII logo and welcome screen
├── utils/             # Path normalization, JSON repair, logging & CLI helpers
├── repl.ts            # REPL event loops (TUI and plain fallback)
└── index.ts           # CLI binary entry point
```

### Registered Tools

The agent has access to the following deterministic tools:

1. `list_directory`: Recursively inspects project trees.
2. `read_file`: Reads file content with line numbers.
3. `edit_file`: Performs targeted search-and-replace edits.
4. `write_file`: Writes complete file contents or creates new files.
5. `insert_file`: Inserts content at specific line numbers.
6. `replace_lines`: Replaces ranges of line numbers.
7. `delete_file`: Deletes files with automatic checkpointing.
8. `run_shell`: Executes test runs, linting, and shell commands.
9. `finish`: Concludes multi-step tool turns with a concise summary.

---

## Development & Testing

Run unit tests via Node's native test runner with `tsx`:

```bash
# Run all tests
npm test

# Run tests in watch mode
npx tsx --test --watch test/**/*.test.ts

# Type-check and compile
npm run build
```

---

## License

ISC License. See package configuration for details.
