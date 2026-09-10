// Punto central para registrar todas las tools. Agregar nueva tool = importar + añadir a array.
import { readFileTool } from "./definitions/readFile/readFile.tool.js";
import { writeFileTool } from "./definitions/writeFile/writeFile.tool.js";
import { listDirectoryTool } from "./definitions/listDirectory/listDirectory.tool.js";
import { runCommandTool } from "./definitions/runCommand/runCommand.tool.js";
import { searchFilesTool } from "./definitions/searchFiles/searchFiles.tool.js";
import { deleteFileTool } from "./definitions/deleteFile/deleteFile.tool.js";
import { editFileTool } from "./definitions/editFile/editFile.tool.js";
import { ToolRegistry } from "./registry.js";

export const toolRegistry = new ToolRegistry();
toolRegistry.registerAll([readFileTool, writeFileTool, listDirectoryTool, runCommandTool, searchFilesTool, deleteFileTool, editFileTool]);
toolRegistry.freeze();

// Compatibilidad con agent.ts existente: expone mismas señales que antes (toolSchemas/toolExecutors)
export const toolSchemas = toolRegistry.getSchemas();
export const toolExecutors = toolRegistry.getExecutors();

// Re-exports útiles para extensión
export { ToolRegistry } from "./registry.js";
export type { ToolDefinition, ToolContext } from "./types.js";
