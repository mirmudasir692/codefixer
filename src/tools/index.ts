import { registry } from "../core/registry.js";
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

// Register all core tool plugins in the microkernel registry
registry.register("list_directory", listDirectoryTool);
registry.register("read_file", readFileTool);
registry.register("run_shell", runShellTool);
registry.register("write_file", writeFileTool);
registry.register("edit_file", editFileTool);
registry.register("insert_file", insertFileTool);
registry.register("replace_lines", replaceLinesTool);
registry.register("delete_file", deleteFileTool);
registry.register("finish", finishTool);

export const toolsByName = registry.getMap();
export const allTools = registry.getAll();

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
};

