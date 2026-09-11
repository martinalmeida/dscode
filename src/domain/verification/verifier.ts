import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { detectProjectKind } from "./projectDetector.js";
import type { FileSnapshot } from "../execution/fileSnapshot.js";

export interface VerificationResult {
  projectKind: string;
  passed: boolean;
  checks: string[];
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function run(
  cwd: string,
  command: string,
  args: string[],
  timeout = 30_000
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execa(command, args, { cwd, timeout, reject: false });
    return { ok: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: (error as Error).message };
  }
}

export async function verifyWorkspace(
  workspaceDir: string,
  changedSnapshots: FileSnapshot[]
): Promise<VerificationResult> {
  const checks: string[] = [];
  const allChanged =
    changedSnapshots.length === 0 ||
    changedSnapshots.every((s) => (s.exists ? !!s.hash : s.hash === null));
  checks.push(allChanged ? "filesystem: OK" : "filesystem: FAIL");
  const kind = await detectProjectKind(workspaceDir);

  if (kind === "typescript") {
    const tsc = await run(workspaceDir, "npx", ["tsc", "--noEmit", "--pretty", "false"], 45_000);
    checks.push(tsc.ok ? "tsc: OK" : `tsc: FAIL\n${tsc.output.slice(0, 3500)}`);
  } else if (kind === "javascript") {
    const pkgPath = path.join(workspaceDir, "package.json");
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const script = pkg.scripts?.["typecheck"] || pkg.scripts?.["lint"] || pkg.scripts?.["build"];
      if (script) {
        const npm = await run(
          workspaceDir,
          "npm",
          [
            "run",
            script === pkg.scripts?.["typecheck"]
              ? "typecheck"
              : script === pkg.scripts?.["lint"]
                ? "lint"
                : "build",
          ],
          90_000
        );
        checks.push(
          npm.ok
            ? `${script === pkg.scripts?.["typecheck"] ? "typecheck" : script === pkg.scripts?.["lint"] ? "lint" : "build"}: OK`
            : `verification: FAIL\n${npm.output.slice(0, 3500)}`
        );
      } else {
        checks.push("verification: SKIPPED (no typecheck/lint/build script)");
      }
    } catch {
      checks.push("verification: SKIPPED (package.json inválido/no legible)");
    }
  } else if (kind === "python") {
    const py = await run(workspaceDir, "python", ["-m", "compileall", "-q", "."], 45_000);
    checks.push(
      py.ok ? "python compileall: OK" : `python compileall: FAIL\n${py.output.slice(0, 3500)}`
    );
  } else if (kind === "php") {
    if (await exists(path.join(workspaceDir, "artisan"))) {
      const php = await run(workspaceDir, "php", ["artisan", "about"], 45_000);
      checks.push(
        php.ok ? "php artisan about: OK" : `php artisan about: FAIL\n${php.output.slice(0, 3500)}`
      );
    } else checks.push("php: SKIPPED (no artisan)");
  } else {
    checks.push("verification: SKIPPED (proyecto genérico)");
  }

  return { projectKind: kind, passed: checks.every((c) => !c.includes("FAIL")), checks };
}
