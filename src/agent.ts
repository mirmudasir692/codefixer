import { llm } from "mirascope";
import {
  listDirectoryTool,
  readFileTool,
  runShellTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
} from "./tools.js";

export const MODEL_ID = "ollama/qwen2.5-agent-7b";

export const codeAgent = llm.defineCall<{
  history: string;
  input: string;
}>({
  model: MODEL_ID,
  maxTokens: 2048,
  temperature: 0,
  tools: [
    listDirectoryTool,
    readFileTool,
    runShellTool,
    writeFileTool,
    editFileTool,
    deleteFileTool,
  ],
  template: ({ history, input }) => `
You are a coding agent in a terminal inside the user's project.
You have 6 tools: list_directory, read_file, run_shell, write_file, edit_file, delete_file.

${history ? `# Previous conversation\n${history}\n` : ""}

# New user request
${input}

CRITICAL RULES:
- If the user asks about the project, files, code, or anything in this directory,
  you MUST call a tool first.
- If the user asks "what is this project", "what are we building", or any similar
  question, you MUST read BOTH README.md AND package.json before answering.
  Do not answer from filenames alone.
- If the user names MULTIPLE files (e.g. "read A and B"), you MUST call read_file
  on EACH one, one call per file, before answering. Never answer having read
  only one of the requested files.
- Read a file ONCE per conversation. If a file's contents are already in the
  Previous conversation section, use them — do NOT re-read the same file.
- When the user refers to "those", "that", or "the previous", look at the
  Previous conversation section first. Do NOT call a tool to re-fetch it.
- ALWAYS read a file before editing it. edit_file requires the exact current text.
- Prefer edit_file over write_file for existing files. Only use write_file to
  create new files or when you genuinely need to replace the whole file.
- For multi-line edits, include enough surrounding lines in old_string to make
  it unique in the file.
- delete_file cannot be undone. Only use it when the user explicitly asks to
  remove something.
- NEVER say "I would call", "I will call", or "I should call" a tool.
  Emit the tool call directly.
- Only reply TOOL CALL FAILED if a tool genuinely cannot help with this request.
- Keep final answers short.
  `.trim(),
});