import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../../infrastructure/logger/logger.js";
import { APP_CONSTANTS } from "../../shared/constants.js";
import { getEnvNumber } from "../../shared/env.js";

const log = createLogger("app:context");

export async function loadProjectContext(
  workspaceDir: string
): Promise<{ systemPromptSection: string; loadedFiles: string[]; truncated?: { before: number; cap: number } }> {
  const loadedFiles: string[] = [];
  const sections: string[] = [];

  const rootAgentsMd = path.join(workspaceDir, "AGENTS.md");
  const rootContent = await readIfExists(rootAgentsMd);
  if (rootContent !== null) {
    loadedFiles.push("AGENTS.md");
    sections.push(formatSection("AGENTS.md (raíz del proyecto)", rootContent));
  }

  const nested = await findNestedAgentsMd(workspaceDir, workspaceDir, 0);
  for (const filePath of nested) {
    const content = await readIfExists(filePath);
    if (content !== null) {
      const relPath = path.relative(workspaceDir, filePath);
      loadedFiles.push(relPath);
      sections.push(formatSection(`AGENTS.md anidado (${relPath})`, content));
    }
  }

  for (const dirName of APP_CONSTANTS.AGENT_CONTEXT_DIR_NAMES) {
    const dirPath = path.join(workspaceDir, dirName as string);
    const mdFiles = await findMarkdownFilesRecursive(dirPath);
    for (const filePath of mdFiles) {
      const content = await readIfExists(filePath);
      if (content !== null) {
        const relPath = path.relative(workspaceDir, filePath);
        loadedFiles.push(relPath);
        sections.push(formatSection(`Convención del agente (${relPath})`, content));
      }
    }
  }

  if (sections.length === 0) {
    sections.push(
      "(No se encontró AGENTS.md ni carpetas de convenciones (.agent/, agents/, .deepseek/) en este proyecto. El agente no tiene contexto/reglas específicas del proyecto — procede con más cautela.)"
    );
  }

  let joined = sections.join("\n\n");
  const cap = getEnvNumber("DSCODE_MAX_CONTEXT_CHARS", 12000);
  let truncated: { before: number; cap: number } | undefined;
  if (joined.length > cap) {
    const before = joined.length;
    truncated = { before, cap };
    joined = buildTruncatedContent(sections, cap, before, loadedFiles);
    log.info({ before, cap, loadedFiles, truncated: true }, "Contexto truncado por cap");
    log.debug({ before, cap, loadedFiles }, "Contexto truncado — detalle");
  }
  log.debug({ loadedFiles, len: joined.length, truncated }, "Contexto cargado");
  return { systemPromptSection: joined, loadedFiles, truncated };
}

function formatSection(title: string, content: string): string {
  return `--- ${title} ---\n${content.trim()}\n--- fin de ${title} ---`;
}

function buildTruncatedContent(
  sections: string[],
  cap: number,
  before: number,
  loadedFiles: string[]
): string {
  // Truncado inteligente por prioridad: intenta mantener secciones completas.
  // Prioridad: AGENTS.md raíz primero (sections[0] si viene de raíz), luego resto en orden.
  // Si la primera sección ya excede el cap, se corta ahí mismo.
  const footer = `\n\n[...contexto truncado: ${before} chars -> ${cap} cap (DSCODE_MAX_CONTEXT_CHARS). Archivos cargados: ${loadedFiles.join(", ")}. Usa read_file/glob para el resto bajo demanda]`;
  const budget = cap - footer.length;
  if (budget <= 500) {
    return sections.join("\n\n").slice(0, cap - footer.length) + footer;
  }
  const kept: string[] = [];
  let remaining = budget;
  let truncatedFiles: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i] as string;
    // +2 por el \n\n entre secciones (excepto primera)
    const sep = kept.length > 0 ? 2 : 0;
    if (sec.length + sep <= remaining) {
      kept.push(sec);
      remaining -= sec.length + sep;
    } else {
      if (remaining > 500) {
        const sliceLen = remaining - sep - 300;
        const truncatedSection =
          sec.slice(0, Math.max(0, sliceLen)) +
          `\n[...sección truncada por cap, ${sec.length} chars de esta sección omitidos...]`;
        kept.push(truncatedSection);
      }
      truncatedFiles = sections.slice(i + (remaining > 500 ? 1 : 0)).map((_, idx) => loadedFiles[i + idx] ?? `sección ${i + idx}`);
      break;
    }
  }
  const body = kept.join("\n\n");
  const extra = truncatedFiles.length
    ? ` Archivos no incluidos completos: ${truncatedFiles.join(", ")}.`
    : "";
  // Si body ya contiene footer parcial, reemplazar con footer final que incluye extra
  const finalFooter = `\n\n[...contexto truncado: ${before} chars -> ${cap} cap (DSCODE_MAX_CONTEXT_CHARS). Archivos cargados: ${loadedFiles.join(", ")}.${extra} Usa read_file/glob para el resto bajo demanda]`;
  if (body.length + finalFooter.length > cap) {
    return body.slice(0, cap - finalFooter.length) + finalFooter;
  }
  return body + finalFooter;
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function findNestedAgentsMd(
  currentDir: string,
  _workspaceDir: string,
  _depth: number
): Promise<string[]> {
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
    if (
      await fs
        .access(candidateFile)
        .then(() => true)
        .catch(() => false)
    )
      results.push(candidateFile);
    results.push(...(await findNestedAgentsMd(subDir, _workspaceDir, _depth + 1)));
  }
  return results;
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
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (APP_CONSTANTS.IGNORED_DIRS.has(entry.name)) continue;
      results.push(...(await findMarkdownFilesRecursive(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) results.push(fullPath);
  }
  return results;
}
