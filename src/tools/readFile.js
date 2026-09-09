import fs from "node:fs/promises";
import { resolveSafe } from "../safePath.js";

export const schema = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Lee el contenido completo de un archivo de texto dentro del workspace. " +
      "Usa esto antes de editar algo, para saber qué hay ahí.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Ruta del archivo, relativa a la raíz del workspace.",
        },
      },
      required: ["path"],
    },
  },
};

export async function execute({ path: relPath }, ctx) {
  const full = resolveSafe(ctx.workspaceDir, relPath);
  const content = await fs.readFile(full, "utf-8");
  // Recorte defensivo para no reventar el contexto con archivos gigantes
  const MAX = 20000;
  if (content.length > MAX) {
    return content.slice(0, MAX) + `\n\n[...archivo truncado, ${content.length} chars en total...]`;
  }
  return content;
}
