import { registry } from "../core/registry.js";
import type { CallTools } from "../types/index.js";
import {
  listDirectoryTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  insertFileTool,
  replaceLinesTool,
  deleteFileTool,
} from "./fs.js";
import { runShellTool } from "./shell.js";
import { finishTool } from "./finish.js";
import { grepTool, globTool, fileOutlineTool, fileInfoTool } from "./search.js";
import {
  moveFileTool,
  copyFileTool,
  applyPatchTool,
  multiEditTool,
  undoEditTool,
  readManyFilesTool,
  treeTool,
  diffFilesTool,
} from "./fs_extra.js";
import {
  semanticSearchTool,
  listDefinitionsTool,
  findReferencesTool,
  getDiagnosticsTool,
  todoWriteTool,
  todoReadTool,
  scratchpadTool,
} from "./code_intel.js";
import {
  runShellBackgroundTool,
  killProcessTool,
  listProcessesTool,
  runTestsTool,
} from "./process.js";
import { webFetchTool, webSearchTool, httpRequestTool } from "./web.js";
import { askUserTool, notifyUserTool } from "./interaction.js";
import { envInfoTool, getEnvTool, setEnvTool, installPackageTool, executeSqlTool } from "./env.js";
import { delegateTaskTool, scheduleTaskTool, editNotebookTool } from "./advanced.js";

// Core File System
registry.register("list_directory", listDirectoryTool);
registry.register("read_file", readFileTool);
registry.register("write_file", writeFileTool);
registry.register("edit_file", editFileTool);
registry.register("insert_file", insertFileTool);
registry.register("replace_lines", replaceLinesTool);
registry.register("delete_file", deleteFileTool);
registry.register("move_file", moveFileTool);
registry.register("rename_file", moveFileTool);
registry.register("copy_file", copyFileTool);
registry.register("apply_patch", applyPatchTool);
registry.register("multi_edit", multiEditTool);
registry.register("undo_edit", undoEditTool);
registry.register("read_many_files", readManyFilesTool);
registry.register("tree", treeTool);
registry.register("diff_files", diffFilesTool);

// Search & Code Intelligence
registry.register("grep", grepTool);
registry.register("glob", globTool);
registry.register("file_outline", fileOutlineTool);
registry.register("file_info", fileInfoTool);
registry.register("semantic_search", semanticSearchTool);
registry.register("list_definitions", listDefinitionsTool);
registry.register("find_references", findReferencesTool);
registry.register("get_diagnostics", getDiagnosticsTool);
registry.register("todo_write", todoWriteTool);
registry.register("todo_read", todoReadTool);
registry.register("scratchpad", scratchpadTool);

// Shell & Process
registry.register("run_shell", runShellTool);
registry.register("run_shell_background", runShellBackgroundTool);
registry.register("kill_process", killProcessTool);
registry.register("list_processes", listProcessesTool);
registry.register("run_tests", runTestsTool);

// Web & Network
registry.register("web_fetch", webFetchTool);
registry.register("web_search", webSearchTool);
registry.register("http_request", httpRequestTool);

// User Interaction
registry.register("ask_user", askUserTool);
registry.register("notify_user", notifyUserTool);
registry.register("finish", finishTool);

// Environment & Data
registry.register("env_info", envInfoTool);
registry.register("get_env", getEnvTool);
registry.register("set_env", setEnvTool);
registry.register("install_package", installPackageTool);
registry.register("execute_sql", executeSqlTool);

// Advanced & Delegation
registry.register("delegate_task", delegateTaskTool);
registry.register("schedule_task", scheduleTaskTool);
registry.register("edit_notebook", editNotebookTool);

export const toolsByName = registry.getMap();
export const allTools: CallTools = registry.getAll();

export {
  listDirectoryTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  insertFileTool,
  replaceLinesTool,
  deleteFileTool,
  runShellTool,
  finishTool,
  grepTool,
  globTool,
  fileOutlineTool,
  fileInfoTool,
  moveFileTool,
  copyFileTool,
  applyPatchTool,
  multiEditTool,
  undoEditTool,
  readManyFilesTool,
  treeTool,
  diffFilesTool,
  semanticSearchTool,
  listDefinitionsTool,
  findReferencesTool,
  getDiagnosticsTool,
  todoWriteTool,
  todoReadTool,
  scratchpadTool,
  runShellBackgroundTool,
  killProcessTool,
  listProcessesTool,
  runTestsTool,
  webFetchTool,
  webSearchTool,
  httpRequestTool,
  askUserTool,
  notifyUserTool,
  envInfoTool,
  getEnvTool,
  setEnvTool,
  installPackageTool,
  executeSqlTool,
  delegateTaskTool,
  scheduleTaskTool,
  editNotebookTool,
};
