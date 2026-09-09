# AGENTS.md — dscode

Agente de código en terminal (estilo OpenCode/Claude Code) con motor DeepSeek intercambiable: API real o scraping del chat web vía Playwright. Se instala una vez y se corre desde cualquier proyecto (`cwd` = workspace).

## Comandos

```bash
npm install          # instalar deps
npm link             # expone bin `dscode` global (symlink)
npm start            # = node src/cli.js (corre agente en cwd)
npm run login        # = dscode login — login DeepSeek web (abre Chromium visible)
npm run calibrate    # = dscode calibrate
dscode               # corre en proyecto actual (Build por defecto)
dscode --plan        # inicia en modo solo-lectura
dscode --dir <ruta>  # fuerza workspace distinto a cwd
```

No hay tests, linter ni CI configurados.

## Arquitectura

- `src/cli.js:40` — entrypoint. Resuelve `workspaceDir` (`--dir` o `process.cwd()`), aplica guard `assertWorkspaceIsSafe` (realpath, rechaza si workspace es `AGENT_INSTALL_DIR` o subcarpeta), carga contexto, crea provider y lanza `promptLoop`.
- `src/agent.js` — loop principal. `MAX_TOOL_ITERATIONS=15`, `READ_ONLY_TOOLS = read_file, list_directory, search_files`. En Plan filtra `toolSchemas` y rechaza tools de escritura aunque el modelo las alucine.
- `src/contextLoader.js` — carga `AGENTS.md` raíz + anidados (hasta 3 niveles, ignora `node_modules/.git/dist/build/.next/.cache`) + `*.md` en `.agent/`/`agents/`/`.deepseek/`.
- `src/safePath.js:8` — `resolveSafe()` con check `=== base || startsWith(base + sep)` (no `startsWith` solo).
- `src/tools/` — `read_file`, `write_file` (pide confirmación si archivo existe, muestra diff), `list_directory`, `run_command` (bloquea `rm -rf /`, fork-bomb, etc.; pide confirmación para `rm/mv/git reset/sudo/>`), `search_files`.
- `src/providers/index.js:7` — factory `MODEL_PROVIDER=web|api`. `api` usa `openai` SDK contra `api.deepseek.com`. `web` usa `DeepSeekWebClient` (Playwright).
- `src/browser/findChromium.js` — detección multiplataforma de Chromium; `CHROMIUM_EXECUTABLE_PATH` puede ser absoluta o relativa a `AGENT_INSTALL_DIR`.
- `AGENT_INSTALL_DIR` (`src/cli.js:18`) = `realpath` de `src/..` (resuelve symlink de `npm link`). `.env` y `storage-state.json` viven ahí, nunca en el workspace del usuario.

## Config (.env en AGENT_INSTALL_DIR)

```
MODEL_PROVIDER=web|api   # default web
HEADLESS=true            # web: login/calibrate fuerzan visible igual
STORAGE_STATE_PATH=./storage-state.json
RESPONSE_TIMEOUT_MS=300000
CHROMIUM_EXECUTABLE_PATH=./chrome-linux64/chrome  # auto-detecta si vacío
DEEPSEEK_API_KEY / DEEPSEEK_MODEL  # solo si api
```

`dotenv` carga `AGENT_INSTALL_DIR/.env`, no `cwd/.env`.

## Convenciones

- ESM (`"type": "module"`), sin transpiler/build.
- Antes de editar: `read_file` primero; antes de crear: `list_directory` para confirmar ruta.
- `write_file` crea directorios intermedios automáticamente.
- No modificar `storage-state.json` manualmente — regenerar con `dscode login`.
- Chromium local en `chrome-linux64/` (no versionado idealmente).
