import path from "node:path";

/**
 * Resuelve una ruta relativa al workspace y lanza error si el resultado
 * intenta salir de esa carpeta (evita que el modelo, por error o mal
 * prompt, termine leyendo/escribiendo fuera de donde tú quieres).
 */
export function resolveSafe(workspaceDir, relativePath) {
  const base = path.resolve(workspaceDir);
  const target = path.resolve(base, relativePath || ".");

  // OJO: "target.startsWith(base)" NO es suficiente — "/home/proj-evil"
  // también empieza con el texto "/home/proj" aunque sea una carpeta
  // hermana, no una subcarpeta. Hay que exigir que sea igual a base o que
  // empiece con base + separador de carpetas.
  const isSameDir = target === base;
  const isInsideDir = target.startsWith(base + path.sep);

  if (!isSameDir && !isInsideDir) {
    throw new Error(
      `Ruta fuera del workspace permitido: "${relativePath}". ` +
        `Workspace: ${base}`
    );
  }
  return target;
}
