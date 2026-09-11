import fs from "node:fs/promises";
import path from "node:path";

export type ProjectKind = "typescript" | "javascript" | "python" | "php" | "generic";

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

export async function detectProjectKind(workspaceDir: string): Promise<ProjectKind> {
  if (await exists(path.join(workspaceDir, "tsconfig.json"))) return "typescript";
  if (await exists(path.join(workspaceDir, "package.json"))) return "javascript";
  if (
    (await exists(path.join(workspaceDir, "pyproject.toml"))) ||
    (await exists(path.join(workspaceDir, "requirements.txt")))
  )
    return "python";
  if (await exists(path.join(workspaceDir, "composer.json"))) return "php";
  return "generic";
}
