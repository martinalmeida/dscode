import * as readFile from "./readFile.js";
import * as writeFile from "./writeFile.js";
import * as listDirectory from "./listDirectory.js";
import * as runCommand from "./runCommand.js";
import * as searchFiles from "./searchFiles.js";

// Cada tool exporta { schema, execute }. Aquí las juntamos en un solo mapa
// por nombre, que es como las busca el loop del agente cuando el modelo
// pide usarlas.
const modules = [readFile, writeFile, listDirectory, runCommand, searchFiles];

export const toolSchemas = modules.map((m) => m.schema);

export const toolExecutors = Object.fromEntries(
  modules.map((m) => [m.schema.function.name, m.execute])
);
