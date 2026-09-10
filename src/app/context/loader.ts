import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../../infrastructure/logger/logger.js";
import { APP_CONSTANTS } from "../../shared/constants.js";

const log = createLogger("app:context");

export async function loadProjectContext(
  workspaceDir: string
): Promise<{ systemPromptSection: string; loadedFiles: string[] }> {
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

  log.debug({ loadedFiles }, "Contexto cargado");
  return { systemPromptSection: sections.join("\n\n"), loadedFiles };
}

function formatSection(title: string, content: string): string {
  return `--- ${title} ---\n${content.trim()}\n--- fin de ${title} ---`;
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
  depth: number
): Promise<string[]> {
  if (depth > APP_CONSTANTS.MAX_DEPTH_FOR_NESTED_AGENTS_MD) return [];
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
    results.push(...(await findNestedAgentsMd(subDir, _workspaceDir, depth + 1)));
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
