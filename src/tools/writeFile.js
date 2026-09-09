import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafe } from "../safePath.js";
import { confirm } from "../ui/confirm.js";

export const schema = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Crea o sobrescribe un archivo de texto dentro del workspace con el " +
      "contenido dado. Crea las carpetas intermedias si no existen. " +
      "IMPORTANTE: la ruta debe ser exacta y relativa a la raíz del " +
      "workspace del proyecto actual — nunca una ruta de otro proyecto ni " +
      "una ruta absoluta del sistema. Si no estás seguro de dónde debe " +
      "quedar el archivo, usa list_directory primero para confirmar la " +
      "estructura real antes de escribir.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Ruta del archivo, relativa a la raíz del workspace (ej. 'src/utils/suma.js', " +
            "nunca '/home/usuario/...' ni una ruta de otro proyecto).",
        },
        content: {
          type: "string",
          description: "Contenido completo a escribir en el archivo.",
        },
      },
      required: ["path", "content"],
    },
  },
};

export async function execute({ path: relPath, content }, ctx) {
  if (typeof relPath !== "string" || !relPath) {
    return 'Error: falta el argumento "path" o no es un texto válido.';
  }
  if (typeof content !== "string") {
    return 'Error: falta el argumento "content" o no es un texto válido.';
  }

  const full = resolveSafe(ctx.workspaceDir, relPath);

  if (full === path.resolve(ctx.workspaceDir)) {
    return "Error: la ruta resuelve a la raíz del workspace, no a un archivo. Especifica un archivo concreto.";
  }

  // El riesgo real que puede "colocar un archivo en otro al que no
  // pertenece" es sobrescribir algo que YA EXISTE sin que nadie lo note.
  // Crear un archivo nuevo es aditivo y seguro; pisar uno existente no.
  const existedBefore = await fs
    .access(full)
    .then(() => true)
    .catch(() => false);

  if (existedBefore) {
    const previous = await fs.readFile(full, "utf-8").catch(() => "");
    const preview = buildDiffPreview(previous, content);
    console.log(`\n[write_file] Vas a SOBRESCRIBIR un archivo existente: ${relPath}`);
    console.log(preview);

    const ok = await confirm(`¿Confirmas sobrescribir "${relPath}"?`, { defaultYes: false });
    if (!ok) {
      return `Cancelado por el usuario: no se sobrescribió "${relPath}". Pídele más detalles al usuario o elige otra ruta si corresponde.`;
    }
  }

  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
  return `Archivo ${existedBefore ? "sobrescrito" : "creado"}: ${relPath} (${content.length} caracteres).`;
}

function buildDiffPreview(previous, next) {
  const prevLines = previous.split("\n");
  const nextLines = next.split("\n");
  const summary = [
    `  Antes: ${prevLines.length} líneas, ${previous.length} caracteres`,
    `  Después: ${nextLines.length} líneas, ${next.length} caracteres`,
  ];

  // Primera línea donde el contenido difiere, para dar contexto rápido
  // sin volcar el archivo completo a la terminal.
  const maxLines = Math.max(prevLines.length, nextLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (prevLines[i] !== nextLines[i]) {
      summary.push(`  Primera diferencia en la línea ${i + 1}:`);
      summary.push(`    - ${prevLines[i] ?? "(sin línea)"}`);
      summary.push(`    + ${nextLines[i] ?? "(sin línea)"}`);
      break;
    }
  }
  return summary.join("\n");
}
