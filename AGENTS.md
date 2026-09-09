# AGENTS.md — dscode

Agente de código en terminal (estilo OpenCode/Claude Code) con motor DeepSeek intercambiable: API real o scraping del chat web vía Playwright. Se instala una vez y se corre desde cualquier proyecto (`cwd` = workspace).

## Comandos

```bash
npm install          # instalar deps
npm link             # expone bin `dscode` global (symlink)
npm start            # = node dist/app/cli.js (corre agente en cwd)
npm run login        # = dscode login — login DeepSeek web (abre Chromium visible)
npm run calibrate    # = dscode calibrate
npm run build        # compila TS → dist/
npm run dev          # build + dscode en un paso
dscode               # corre en proyecto actual (Build por defecto)
dscode --plan        # inicia en modo solo-lectura
dscode --dir <ruta>  # fuerza workspace distinto a cwd
npm run lint         # revisa reglas con ESLint (typescript-eslint)
npm run typecheck    # chequeo de tipos con tsc --noEmit (strict true)
npm run format       # formatea código con Prettier
```

Build con `tsc` (`tsconfig.build.json` → `dist/`), linting ESLint + typescript-eslint + Prettier, tipos estrictos (`strict: true`).

## Arquitectura

Estructura profesional por capas (`src/` → `dist/`). Todo es TypeScript estricto, ESM (`NodeNext`).

```
src/
  app/
    cli.ts          — entrypoint / bin (AGENT_INSTALL_DIR, guard assertWorkspaceIsSafe, dotenv, banner, provider, Agent)
    agent/
      agent.ts      — loop principal (MAX_TOOL_ITERATIONS=15, filtra tools según modo)
      modes.ts      — AgentMode, MAX_TOOL_ITERATIONS, READ_ONLY_TOOLS
      prompt.ts     — buildSystemPrompt
    context/
      loader.ts     — carga AGENTS.md raíz+anidados (≤3 niveles) + .agent/agents/.deepseek/*.md
  domain/
    tools/
      types.ts      — ToolDefinition, ToolContext, ToolSchema
      registry.ts   — ToolRegistry (get/getAll/getSchemas/getSchemasForMode, inmutable)
      index.ts      — instancia central `toolRegistry` + `toolSchemas`
      definitions/  — readFile, writeFile, listDirectory, runCommand, searchFiles (1 carpeta/tool)
  infrastructure/
    logger/
      logger.ts     — pino (pretty en dev, JSON en prod, redact, LOG_LEVEL/LOG_PRETTY)
    browser/
      findChromium.ts / session.ts / selectors.ts / login.ts
    providers/
      index.ts      — factory createModelClient (web|api)
      webClient.ts  — DeepSeekWebClient (Playwright, tool-calling, close())
      toolProtocol.ts — adaptador OpenAI tool-calling para DeepSeek web
  shared/
    safePath.ts     — resolveSafe (=== base || startsWith(base+sep) + realpath symlink-aware)
    constants.ts    — APP_CONSTANTS, READ_ONLY_TOOLS, BLOCKED_PATTERNS, CONFIRM_PATTERNS (single-source)
    env.ts          — getEnvString/getEnvBool/getEnvNumber (strip \r/quotes, sí/si)
    errors.ts       — DscodeError, WorkspaceError, ToolError, ConfigError
  ui/
    banner.ts / bubble.ts / confirm.ts / spinner.ts / promptLoop.ts
  config/
    env.schema.ts   — zod schema para .env
    app.config.ts   — loadConfig() tipado
```

- Guard `assertWorkspaceIsSafe` (`src/app/cli.ts:123`) — realpath, rechaza si workspace es `AGENT_INSTALL_DIR` o subcarpeta.
- `AGENT_INSTALL_DIR` = `realpath(dirname(fileURLToPath(import.meta.url))/../..)` (resuelve symlink de `npm link`). `.env` y `storage-state.json` viven ahí, nunca en el workspace.
- `ToolRegistry` (`src/domain/tools/registry.ts:10`) — única fuente de verdad para tools; `getSchemasForMode("plan")` filtra por `readOnly` flag, `freeze()` tras `registerAll` (inmutable). Agregar un tool = crear `definitions/<name>/` + registrar en `domain/tools/index.ts`.
- Guard `resolveSafe` (`src/shared/safePath.ts:7`) — `=== base || startsWith(base+sep)` + `realpathSync` probe del ancestro (bloquea symlinks fuera del workspace).
- `src/app/agent/agent.ts:51` — `init()` idempotente + auto-init en `run()`, guard plan usa `toolDef.readOnly` (no Set duplicado), reusa `toolDef`.
- `src/infrastructure/browser/session.ts:36` — `closeSession` cierra `context` y `browser`; `SELECTORS` genéricos fallback (`src/infrastructure/browser/selectors.ts:1`).
- `src/infrastructure/browser/findChromium.ts:4` — `log.warn` en vez de `console.warn`.
- `src/infrastructure/providers/webClient.ts:13` — `_sessionPromise` lock sin `as never`, ids `call_${Date.now()}_${random}`.
- `src/infrastructure/providers/index.ts` — `MODEL_PROVIDER=web|api` (`api` → OpenAI SDK a `api.deepseek.com`, `web` → Playwright).
- `src/infrastructure/logger/logger.ts:8` — `createLogger(context)` y `rootLogger`; pino con `pino-pretty` solo si no es prod y es TTY; `LOG_LEVEL/LOG_PRETTY` strip `\r/quotes`, acepta `sí/si`.

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

- Stack: TypeScript estricto (`strict: true`, `NodeNext`), ESM nativo, `tsc` → `dist/`. `allowJs: false`.
- Antes de editar: `read_file` primero; antes de crear: `list_directory` para confirmar ruta.
- `write_file` crea directorios intermedios automáticamente.
- No modificar `storage-state.json` manualmente — regenerar con `dscode login`.
- Chromium local en `chrome-linux64/` (no versionado idealmente).
- Logger: `import { createLogger } from "../../infrastructure/logger/logger.js"` → `createLogger("dominio:context")`. Usa `LOG_LEVEL=debug` para ver trazas. No uses `console.log` en código nuevo.
- Nuevo tool: crea `src/domain/tools/definitions/<name>/<name>.tool.ts` que exporte `ToolDefinition`, y regístralo en `src/domain/tools/index.ts`. El registry genera automáticamente el schema OpenAI.
- Validación de env: `src/config/env.schema.ts` (zod). No leas `process.env` directo fuera de `shared/env.ts` o `config/`.
