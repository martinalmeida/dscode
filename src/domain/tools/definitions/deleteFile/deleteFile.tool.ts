import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../../../../shared/safePath.js";
import type { ToolContext, ToolDefinition } from "../../types.js";
import {
  deleteFileTransaction,
  formatEditTransaction,
} from "../../../execution/editTransaction.js";

export const deleteFileTool: ToolDefinition<{ path: string; expected_hash?: string }> = {
  name: "delete_file",
  description:
    'Elimina un archivo o directorio vacío dentro del workspace. Requiere SIEMPRE {path} no vacío. Si omites extensión (ej: "xddvd") sugiere "xddvd.md". Autónomo: borra inmediato si el LLM lo ordena, sin pedir confirmación.',
  readOnly: false,
  schema: {
    type: "function",
    function: {
      name: "delete_file",
      description:
        'Elimina un archivo o directorio vacío dentro del workspace. Requiere SIEMPRE {path} no vacío. Si omites extensión (ej: "xddvd") sugiere "xddvd.md". Autónomo sin confirmación.',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Ruta del archivo o directorio a eliminar, relativa al workspace. Si omites extensión, la tool sugiere coincidencias: "xddvd" → "xddvd.md". Ej: "xddvd.md" o "tmp/notas.txt".',
          },
          expected_hash: {
            type: "string",
            description:
              "Hash SHA-256 de la última lectura conocida; evita borrar una versión obsoleta.",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute({ path: relPath, expected_hash }, ctx: ToolContext): Promise<string> {
    if (typeof relPath !== "string" || !relPath.trim()) {
      return 'Faltan argumentos para delete_file: "path" es obligatorio y no vacío. Vuelve a llamar a delete_file con {"path":"<ruta-relativa>"}. Ej: {"path":"xddvd.md"}';
    }
    const full = resolveSafe(ctx.workspaceDir, relPath);
    if (full === path.resolve(ctx.workspaceDir))
      return "Error: no se puede eliminar la raíz del workspace.";

    const objective = ctx.taskObjective ?? "";
    const explicitlyDeleting = /\b(?:elimin(?:a|ar|e)?|borr(?:a|ar|e)?|delete|remove|quitar|limpiar\s+(?:el|la|los|las)?\s*archivo(?:s)?)\b/i.test(objective);
    const criticalConfig = /(?:^|[\/])(?:docker-compose(?:\.[^\/]+)?|compose(?:\.[^\/]+)|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^\/]+)?\.json)$/i.test(relPath);
    if (!explicitlyDeleting) {
      return [
        `DELETE_GUARD: no se puede eliminar "${relPath}" porque la petición actual no solicita eliminar/borrar/descartar ese archivo.`,
        criticalConfig
          ? "Es un archivo de configuración crítico; restáuralo o modifícalo con una herramienta de edición controlada si ese es el objetivo."
          : "Confirma la intención en la tarea y vuelve a llamar a delete_file solo si realmente debe desaparecer.",
      ].join("\n");
    }

    let stat;
    try {
      stat = await fs.lstat(full);
    } catch {
      // Fuzzy sin extensión: busca archivos con mismo stem en el mismo directorio
      const dir = path.dirname(full);
      const base = path.basename(relPath);
      const stem = base.toLowerCase();
      let hints = "";
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const candidates = entries
          .filter(
            (e) =>
              e.isFile() &&
              (e.name.toLowerCase() === `${stem}.md` ||
                e.name.toLowerCase() === `${stem}.txt` ||
                e.name.toLowerCase().startsWith(`${stem}.`) ||
                path.parse(e.name).name.toLowerCase() === stem)
          )
          .map((e) =>
            path
              .join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), e.name)
              .replace(/^\//, "")
          )
          .slice(0, 5);
        // Si no hubo candidatos con lógica estricta, probar includes más laxo
        if (candidates.length === 0) {
          const lax = entries
            .filter((e) => e.isFile() && e.name.toLowerCase().includes(stem))
            .map((e) =>
              path
                .join(path.dirname(relPath) === "." ? "" : path.dirname(relPath), e.name)
                .replace(/^\//, "")
            )
            .slice(0, 5);
          if (lax.length > 0) candidates.push(...lax);
        }
        if (candidates.length > 0) {
          hints = ` Coincidencias sin extensión en "${path.dirname(relPath)}": ${candidates.join(", ")} — vuelve a llamar a delete_file con {"path":"${candidates[0]}"} si es ese. También puedes usar search_files con pattern "${base}" para ver más.`;
        }
      } catch (_e) {
        void _e;
      }
      return `No existe: "${relPath}" — nada que borrar.${hints}`;
    }

    // No borrar directorios con contenido sin ser explícito (seguridad)
    if (stat.isDirectory()) {
      const entries = await fs.readdir(full);
      if (entries.length > 0) {
        return `Error: "${relPath}" es un directorio con ${entries.length} elementos. Vacía el directorio primero o borra su contenido archivo por archivo. No se borran directorios no vacíos por seguridad.`;
      }
    }

    const typeLabel = stat.isDirectory() ? "directorio vacío" : "archivo";
    console.log(`\n[delete_file autónomo] Eliminando ${typeLabel}: ${relPath}`);
    if (stat.isDirectory()) await fs.rmdir(full);
    else {
      const result = await deleteFileTransaction(ctx.workspaceDir, relPath, expected_hash);
      return `Eliminado: ${relPath} (${typeLabel}).\n${formatEditTransaction(result)}`;
    }
    return `Eliminado: ${relPath} (${typeLabel}).\nchanged=true`;
  },
};
