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
  return fs.access(p).then(() => true).catch(() => false);
}

async function run(
  cwd: string,
  command: string,
  args: string[],
  timeout = 30_000
): Promise<{ ok: boolean; output: string; exitCode: number | null }> {
  try {
    const result = await execa(command, args, { cwd, timeout, reject: false });
    return {
      ok: result.exitCode === 0,
      output: `${result.stdout}\n${result.stderr}`.trim(),
      exitCode: result.exitCode ?? null,
    };
  } catch (error) {
    return { ok: false, output: (error as Error).message, exitCode: null };
  }
}

function isComposeFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ].includes(base);
}

async function verifyCompose(workspaceDir: string): Promise<{ ok: boolean; check: string }> {
  const candidates = [
    { bin: "docker", args: ["compose", "config"] },
    { bin: "podman", args: ["compose", "config"] },
  ];
  let unavailable = 0;
  for (const candidate of candidates) {
    const result = await run(workspaceDir, candidate.bin, candidate.args, 30_000);
    if (result.exitCode === null) {
      unavailable += 1;
      continue;
    }
    if (result.ok) return { ok: true, check: `${candidate.bin} compose config: OK` };
    const detail = result.output.slice(0, 3000) || `exit code ${result.exitCode}`;
    return { ok: false, check: `${candidate.bin} compose config: FAIL\n${detail}` };
  }
  return {
    ok: false,
    check:
      unavailable === candidates.length
        ? "compose verification: FAIL — no se encontró docker ni podman para validar el compose"
        : "compose verification: FAIL — no se pudo ejecutar el validador de compose",
  };
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

  const changedPaths = changedSnapshots.map((s) => s.path).filter(Boolean);
  const composeExists = (
    await Promise.all(
      ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].map((f) =>
        exists(path.join(workspaceDir, f))
      )
    )
  ).some(Boolean);

  // Nunca declares completada una modificación de Docker Compose usando solo
  // typecheck de TypeScript. El compose es una fuente independiente de verdad.
  if (changedPaths.some(isComposeFile) || (composeExists && changedPaths.some((p) => /dockerfile|compose/i.test(p)))) {
    const compose = await verifyCompose(workspaceDir);
    checks.push(compose.check);
  }

  const kind = await detectProjectKind(workspaceDir);

  if (kind === "typescript") {
    const tsc = await run(
      workspaceDir,
      "npx",
      ["tsc", "--noEmit", "--pretty", "false"],
      45_000
    );
    checks.push(
      tsc.ok ? "tsc: OK" : `tsc: FAIL\n${(tsc.output || `exit code ${tsc.exitCode}`).slice(0, 3500)}`
    );
  } else if (kind === "javascript") {
    const pkgPath = path.join(workspaceDir, "package.json");
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      const scriptName = pkg.scripts?.["typecheck"]
        ? "typecheck"
        : pkg.scripts?.["lint"]
          ? "lint"
          : pkg.scripts?.["build"]
            ? "build"
            : null;
      if (scriptName) {
        const npm = await run(workspaceDir, "npm", ["run", scriptName], 90_000);
        checks.push(
          npm.ok
            ? `${scriptName}: OK`
            : `${scriptName}: FAIL\n${(npm.output || `exit code ${npm.exitCode}`).slice(0, 3500)}`
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
      py.ok
        ? "python compileall: OK"
        : `python compileall: FAIL\n${(py.output || `exit code ${py.exitCode}`).slice(0, 3500)}`
    );
  } else if (kind === "php") {
    if (await exists(path.join(workspaceDir, "artisan"))) {
      const php = await run(workspaceDir, "php", ["artisan", "about"], 45_000);
      checks.push(
        php.ok
          ? "php artisan about: OK"
          : `php artisan about: FAIL\n${(php.output || `exit code ${php.exitCode}`).slice(0, 3500)}`
      );
    } else checks.push("php: SKIPPED (no artisan)");
  } else {
    checks.push("verification: SKIPPED (proyecto genérico)");
  }

  return {
    projectKind: kind,
    passed: checks.every((c) => !c.includes("FAIL")),
    checks,
  };
}
