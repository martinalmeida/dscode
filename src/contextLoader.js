import fs from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
const AGENT_CONTEXT_DIR_NAMES = [".agent", "agents", ".deepseek"];
const MAX_DEPTH_FOR_NESTED_AGENTS_MD = 3;

/**
 * Reúne TODO el contexto que el proyecto define para el agente:
 *   1. AGENTS.md en la raíz del workspace (el principal).
 *   2. AGENTS.md anidados en subcarpetas (convenciones específicas de esa
 *      parte del proyecto — mismo patrón que usan Claude Code/Cursor con
 *      archivos de reglas por carpeta).
 *   3. Cualquier archivo .md dentro de una carpeta de convenciones del
 *      agente: .agent/, agents/, o .deepseek/ (reglas, skills, contexto).
 *
 * Devuelve { systemPromptSection, loadedFiles } — loadedFiles es solo para
 * mostrarle al usuario en el banner de arranque qué se cargó de verdad,
 * así nunca hay duda de si el agente "vio" o no un archivo de reglas.
 */
export async function loadProjectContext(workspaceDir) {
  const loadedFiles = [];
  const sections = [];

  // 1. AGENTS.md raíz
  const rootAgentsMd = path.join(workspaceDir, "AGENTS.md");
  const rootContent = await readIfExists(rootAgentsMd);
  if (rootContent !== null) {
    loadedFiles.push("AGENTS.md");
    sections.push(formatSection("AGENTS.md (raíz del proyecto)", rootContent));
  }

  // 2. AGENTS.md anidados
  const nested = await findNestedAgentsMd(workspaceDir, workspaceDir, 0);
  for (const filePath of nested) {
    const content = await readIfExists(filePath);
    if (content !== null) {
      const relPath = path.relative(workspaceDir, filePath);
      loadedFiles.push(relPath);
      sections.push(formatSection(`AGENTS.md anidado (${relPath})`, content));
    }
  }

  // 3. Carpetas de convenciones del agente (.agent/, agents/, .deepseek/)
  for (const dirName of AGENT_CONTEXT_DIR_NAMES) {
    const dirPath = path.join(workspaceDir, dirName);
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
      "(No se encontró AGENTS.md ni carpetas de convenciones (.agent/, agents/, .deepseek/) " +
        "en este proyecto. El agente no tiene contexto/reglas específicas del proyecto — " +
        "procede con más cautela de lo normal, sobre todo antes de escribir o ejecutar algo.)"
    );
  }

  return {
    systemPromptSection: sections.join("\n\n"),
    loadedFiles,
  };
}

function formatSection(title, content) {
  return `--- ${title} ---\n${content.trim()}\n--- fin de ${title} ---`;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function findNestedAgentsMd(currentDir, workspaceDir, depth) {
  if (depth > MAX_DEPTH_FOR_NESTED_AGENTS_MD) return [];

  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;

    const subDir = path.join(currentDir, entry.name);
    const candidateFile = path.join(subDir, "AGENTS.md");
    if (
      await fs
        .access(candidateFile)
        .then(() => true)
        .catch(() => false)
    ) {
      results.push(candidateFile);
    }

    results.push(...(await findNestedAgentsMd(subDir, workspaceDir, depth + 1)));
  }
  return results;
}

async function findMarkdownFilesRecursive(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return []; // la carpeta no existe, no pasa nada — es opcional
  }

  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      results.push(...(await findMarkdownFilesRecursive(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}
