import fs from "node:fs";
import path from "node:path";

/**
 * Resuelve una ruta relativa al workspace y lanza error si intenta salir.
 * Guard crítico: usa `=== base || startsWith(base + sep)` + realpath para symlinks.
 */
export function resolveSafe(workspaceDir: string, relativePath: string): string {
  const baseResolved = path.resolve(workspaceDir);
  let baseReal: string;
  try {
    baseReal = fs.realpathSync(baseResolved);
  } catch {
    baseReal = baseResolved;
  }
  const targetResolved = path.resolve(baseReal, relativePath || ".");

  // String-level check first (cubre .. y absolutos)
  const isSameDir = targetResolved === baseReal;
  const isInsideDir = targetResolved.startsWith(baseReal + path.sep);
  if (!isSameDir && !isInsideDir) {
    throw new Error(
      `Ruta fuera del workspace permitido: "${relativePath}". Workspace: ${baseReal}`
    );
  }

  // Symlink-aware: resolver target real si existe, si no su ancestro existente
  let realTarget = targetResolved;
  let probe = targetResolved;
  while (true) {
    try {
      const real = fs.realpathSync(probe);
      // Si probe es el target, real es el target real; si probe es ancestro, reconstruir sufijo
      if (probe === targetResolved) realTarget = real;
      else {
        const suffix = path.relative(probe, targetResolved);
        realTarget = path.join(real, suffix);
      }
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") break; // otro error → no afirmar
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
      // Si llegamos al baseReal o por encima y no existe nada, salir con check previo
      if (probe.length < baseReal.length) break;
    }
  }

  const realSame = realTarget === baseReal;
  const realInside = realTarget.startsWith(baseReal + path.sep);
  if (!realSame && !realInside) {
    throw new Error(
      `Ruta fuera del workspace permitido (vía symlink): "${relativePath}" → "${realTarget}". Workspace: ${baseReal}`
    );
  }
  return targetResolved;
}
