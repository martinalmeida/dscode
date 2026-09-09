import { execa } from "execa";
import { resolveSafe } from "../safePath.js";

export const schema = {
  type: "function",
  function: {
    name: "search_files",
    description:
      "Busca un texto o patrón regex dentro de los archivos del workspace (como grep -r). " +
      "Devuelve archivo:línea:contenido de cada coincidencia. Útil para encontrar dónde " +
      "está definida una función, variable o texto antes de editar.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Texto o expresión regular (formato grep -E) a buscar.",
        },
        path: {
          type: "string",
          description:
            "Carpeta donde buscar, relativa al workspace. Por defecto '.' (todo el proyecto).",
        },
      },
      required: ["pattern"],
    },
  },
};

export async function execute({ pattern, path: relPath = "." }, ctx) {
  const full = resolveSafe(ctx.workspaceDir, relPath);

  try {
    const result = await execa(
      "grep",
      [
        "-rEn", // recursivo, regex extendido, con número de línea
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        "--", // evita que un pattern que empiece con "-" se confunda con una opción de grep
        pattern,
        full,
      ],
      { reject: false, timeout: 30_000 }
    );

    // grep usa exit code 0 = hubo coincidencias, 1 = no hubo coincidencias,
    // 2 = error real (ruta inválida, permiso denegado, etc). Sin distinguir
    // esto, un error se reportaría silenciosamente como "sin coincidencias".
    if (result.exitCode === 2) {
      return `Error en la búsqueda: ${result.stderr || "grep salió con código 2"}`;
    }

    if (!result.stdout) return "(sin coincidencias)";
    return result.stdout.length > 8000
      ? result.stdout.slice(0, 8000) + "\n[...resultados truncados...]"
      : result.stdout;
  } catch (err) {
    return `Error en la búsqueda: ${err.message}`;
  }
}
