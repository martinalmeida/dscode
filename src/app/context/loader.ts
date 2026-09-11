import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../../infrastructure/logger/logger.js";
import { APP_CONSTANTS } from "../../shared/constants.js";
import { getEnvNumber } from "../../shared/env.js";

const log = createLogger("app:context");

export async function loadProjectContext(workspaceDir: string): Promise<{
  systemPromptSection: string;
  loadedFiles: string[];
  truncated?: { before: number; cap: number };
}> {
  const loadedFiles: string[] = [];
  const sections: string[] = [];

  const rootAgentsMd = path.join(workspaceDir, "AGENTS.md");
  const rootContent = await readIfExists(rootAgentsMd);
  if (rootContent !== null) {
    loadedFiles.push("AGENTS.md");
    sections.push(formatSection("AGENTS.md (raíz del proyecto)", rootContent));
  }

  const nested = await findNestedAgentsMd(workspaceDir, 0);
  for (const filePath of nested) {
    const content = await readIfExists(filePath);
    if (content !== null) {
      const relPath = path.relative(workspaceDir, filePath);
      loadedFiles.push(relPath);
      sections.push(formatSection(`AGENTS.md anidado (${relPath})`, content));
    }
  }

  // Las carpetas de convenciones pueden contener documentación extensa.
  // No la inyectamos completa en cada turno: indicamos los archivos disponibles
  // para que el agente los lea bajo demanda cuando la tarea los necesite.
  const conventionFiles: string[] = [];
  for (const dirName of APP_CONSTANTS.AGENT_CONTEXT_DIR_NAMES) {
    const dirPath = path.join(workspaceDir, dirName);
    const mdFiles = await findMarkdownFilesRecursive(dirPath);
    for (const filePath of mdFiles) {
      conventionFiles.push(path.relative(workspaceDir, filePath));
    }
  }
  if (conventionFiles.length > 0) {
    loadedFiles.push(...conventionFiles);
    sections.push(
      formatSection(
        "Convenciones disponibles (cargar bajo demanda)",
        conventionFiles.map((file) => `- ${file}`).join("\n")
      )
    );
  }

  if (sections.length === 0) {
    sections.push(
      "No se encontró AGENTS.md ni carpetas de convenciones. Descubre la estructura real del workspace antes de asumir reglas."
    );
  }

  const joined = sections.join("\n\n");
  const configuredCap = Math.max(1000, getEnvNumber("DSCODE_MAX_CONTEXT_CHARS", 5000));
  const cap = Math.min(5000, configuredCap);
  if (joined.length <= cap) {
    log.debug({ loadedFiles, len: joined.length, cap }, "Contexto cargado");
    return { systemPromptSection: joined, loadedFiles };
  }

  const before = joined.length;
  const truncated = { before, cap };
  const content = buildTruncatedContent(sections, cap, loadedFiles);
  // El truncado automático es un comportamiento normal, no un warning operativo.
  log.debug({ before, cap, loadedFiles }, "Contexto reducido al límite configurado");
  return { systemPromptSection: content, loadedFiles, truncated };
}

function formatSection(title: string, content: string): string {
  return `--- ${title} ---\n${content.trim()}\n--- fin de ${title} ---`;
}

function buildTruncatedContent(sections: string[], cap: number, loadedFiles: string[]): string {
  const footer = `\n\n[Contexto reducido: ${loadedFiles.join(", ")}. El resto está disponible en el workspace y debe leerse con las herramientas cuando sea necesario.]`;
  const budget = Math.max(0, cap - footer.length);

  // Siempre conserva el comienzo del AGENTS.md raíz, que contiene las reglas
  // de mayor prioridad. Las secciones posteriores solo entran si hay espacio.
  const chunks: string[] = [];
  let remaining = budget;
  for (const section of sections) {
    if (remaining <= 0) break;
    const separator = chunks.length > 0 ? 2 : 0;
    const available = remaining - separator;
    if (available <= 0) break;
    if (section.length <= available) {
      chunks.push(section);
      remaining -= separator + section.length;
    } else {
      chunks.push(
        section.slice(0, Math.max(0, available)) +
          "\n[Sección recortada; lee el archivo original si necesitas más detalle.]"
      );
      break;
    }
  }
  const body = chunks.join("\n\n");
  return (body + footer).slice(0, cap);
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

const MAX_NESTED_AGENTS_MD_DEPTH = 3;

async function findNestedAgentsMd(currentDir: string, depth: number): Promise<string[]> {
  if (depth >= MAX_NESTED_AGENTS_MD_DEPTH) return [];
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || APP_CONSTANTS.IGNORED_DIRS.has(entry.name)) continue;
    const subDir = path.join(currentDir, entry.name);
    const candidateFile = path.join(subDir, "AGENTS.md");
    if (await exists(candidateFile)) results.push(candidateFile);
    results.push(...(await findNestedAgentsMd(subDir, depth + 1)));
  }
  return results;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMarkdownFilesRecursive(dirPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".deepseek") continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (APP_CONSTANTS.IGNORED_DIRS.has(entry.name)) continue;
      results.push(...(await findMarkdownFilesRecursive(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}
