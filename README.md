# dscode

Agente de código en terminal, al estilo OpenCode / Claude Code, con
DeepSeek chat web vía Playwright como único motor (scraping de chat.deepseek.com).
Se instala **una sola vez** en tu máquina y después se usa **desde
cualquier proyecto**, igual que esas herramientas.

## Qué cambió respecto a la v1

| | v1 | v2 (esto) |
|---|---|---|
| Dónde opera | Su propia carpeta (`WORKSPACE_DIR` en `.env`) | El proyecto desde donde lo invocas (`cwd`), con protección explícita para no poder tocarse a sí mismo |
| Contexto | Solo `AGENTS.md` en la raíz | `AGENTS.md` (raíz + anidados) + carpetas `.agent/`, `agents/`, `.deepseek/` |
| Escritura de archivos | Directa, sin confirmación | Autónomo: sobrescribe sin pedir confirmación (preview en consola) |
| Comandos riesgosos | Solo bloqueaba unos pocos patrones extremos | Autónomo: `rm`/`mv`/`git reset`/`sudo`/`>` ejecutan directo (solo `rm -rf /`, `mkfs`, `shutdown` bloquean) |
| Chromium | Ruta absoluta fija de un usuario/máquina | Detección automática multiplataforma (Linux/macOS/Windows), sin rutas fijas |
| Interfaz | REPL simple | Modos **Plan** (solo lectura) / **Build** (completo), alternables con **Tab**, como en OpenCode |

## Instalación (una sola vez)

```bash
npm install
npm link
```

`npm link` deja el comando `dscode` disponible globalmente en tu sistema,
apuntando (vía symlink) a esta carpeta — así puedes correrlo desde
cualquier proyecto sin volver a instalar nada.

```bash
cp .env.example .env
```

El `.env.example` ya viene con valores razonables por defecto
(`HEADLESS=true`, detección automática de Chromium).
Solo tócalo si quieres forzar un Chromium específico.

**Login (una sola vez, o cuando la sesión expire):**

```bash
dscode login
```

Se abre Chromium visible (siempre, sin importar `HEADLESS`) → inicia
sesión en DeepSeek → **apaga "Pensamiento Profundo" y "Búsqueda
inteligente"** si están activados → vuelve a la terminal → ENTER para
guardar la sesión.

## Uso — desde CUALQUIER proyecto

```bash
cd ~/mis-proyectos/mi-app
dscode
```

Eso es todo. `dscode` detecta que estás parado en `mi-app`, la usa como
workspace, y busca ahí su `AGENTS.md` y carpetas de convenciones.

Si corres `dscode` desde su propia carpeta de instalación (o cualquier
subcarpeta de ella), se niega a arrancar — es una protección para que
nunca pueda modificarse o dañarse a sí mismo:

```
⛔ No se puede usar dscode sobre su propia carpeta de instalación...
```

## Modos: Plan vs Build

Al arrancar, `dscode` empieza en modo **Build** (acceso completo:
lee, escribe, ejecuta comandos). Presiona **Tab** en cualquier momento
para alternar a modo **Plan** (solo lectura: puede investigar el proyecto,
leer archivos y buscar código, pero no puede escribir ni ejecutar nada).

```
[BUILD] mi-app > explica cómo está armado el sistema de auth
```
Tab ↓
```
[PLAN] mi-app > explica cómo está armado el sistema de auth
```

Útil para pedirle que investigue o proponga un plan sin riesgo de que
actúe de una, y luego pasar a Build cuando ya confirmaste que sí quieres
que haga los cambios.

También puedes arrancar directo en modo Plan:

```bash
dscode --plan
```

## Contexto del proyecto: AGENTS.md y carpetas de convenciones

`dscode` busca y lee automáticamente, en el proyecto donde lo corres:

1. **`AGENTS.md`** en la raíz — el contexto principal.
2. **`AGENTS.md` anidados** en subcarpetas (hasta 3 niveles) — convenciones
   específicas de esa parte del proyecto.
3. **Cualquier `.md`** dentro de una carpeta `.agent/`, `agents/`, o
   `.deepseek/` — reglas, skills, contexto adicional, organizado como
   quieras dentro de esas carpetas.

Tienes plantillas de ejemplo en `templates/` de esta instalación —
cópialas a la raíz de tu proyecto (no aquí):

```bash
cp /ruta/a/dscode/templates/AGENTS.md.example ~/mi-proyecto/AGENTS.md
cp -r /ruta/a/dscode/templates/.agent ~/mi-proyecto/.agent
```

Al arrancar, `dscode` te muestra en pantalla exactamente qué archivos de
contexto encontró y cargó — nunca hay duda de si "vio" o no tus reglas:

```
Contexto cargado (3 archivo(s)):
  - AGENTS.md
  - src/api/AGENTS.md
  - .agent/skills/convencion-commits.md
```

Si no encuentra nada, te avisa con una advertencia — el agente puede
seguir funcionando, pero sin contexto específico del proyecto tiene más
probabilidad de equivocarse en convenciones que no puede adivinar.

## Seguridad y uso correcto de las tools

- **Aislamiento de proyecto**: las tools de archivos están limitadas al
  workspace actual (protección contra escapes tipo `../../otra-carpeta`,
  incluyendo el típico bug de `"/x-evil".startsWith("/x")`), y además el
  programa entero se niega a correr sobre su propia carpeta.
- **Autónomo sin confirmaciones**: `write_file`/`delete_file`/`run_command`
  ejecutan directo sin pedir `y/n` (preview de diff en consola para
  sobrescrituras). Solo `BLOCKED_PATTERNS` (`rm -rf /`, `mkfs`, `shutdown`,
  fork-bomb) bloquea.
- **Transcript**: cada turno se persiste en `~/.cache/dscode/transcripts/<proyecto>-<hash>/YYYY-MM-DD.jsonl`.
- **Modo Plan** como red de seguridad adicional: en Plan, las tools de
  escritura ni siquiera se le ofrecen al modelo — y si de todos modos
  intenta usarlas (tool-calling emulado vía web, menos confiable que uno nativo), se rechazan explícitamente.

## Estructura

```
dscode/                       <- instalación del programa (NUNCA se toca a sí mismo)
  package.json                 <- bin: "dscode" (usar con npm link)
  .env                          <- config del PROGRAMA (chromium, timeouts, etc.)
  storage-state.json             <- sesión del navegador (se genera con "dscode login")
  templates/                      <- AGENTS.md.example y .agent/ de ejemplo, PARA COPIAR a tus proyectos
  src/
    app/cli.ts                    <- entrypoint, guard assertWorkspaceIsSafe, dotenv, SIGINT/SIGTERM
    app/agent/agent.ts            <- loop, retry/backoff, loop-detection, Promise.all paralelo, transcript
    app/agent/prompt.ts           <- buildSystemPrompt (scope recursivo + IGNORED_DIRS)
    app/context/loader.ts         <- AGENTS.md raíz+anidados ilimitado + .agent/.deepseek
    ui/promptLoop.ts              <- Tab alterna Plan/Build, raw input
    infrastructure/providers/     <- webClient (multi TOOL_CALL) + toolProtocol + index (solo web)
    infrastructure/browser/       <- session, selectors, login, findChromium
    infrastructure/transcript/    <- transcript.ts (jsonl por día, ~.cache/dscode)
    infrastructure/logger/        <- pino
    domain/tools/                 <- 11 tools: read_file, read_many_files, list_directory, search_files, glob, write_file, edit_file, apply_patch, delete_file, run_command (workdir), diagnostics
    shared/safePath.ts + constants.ts (IGNORED_DIRS 10 entradas)
```

## Problemas comunes

- **"⛔ No se puede usar dscode sobre su propia carpeta..."**: es
  intencional. `cd` a tu proyecto real antes de correr `dscode`, o usa
  `dscode --dir /ruta/a/tu/proyecto`.
- **No detecta mi AGENTS.md**: confirma que estás corriendo `dscode`
  desde (o apuntando con `--dir` a) la carpeta que realmente contiene el
  `AGENTS.md` — revisa el banner de arranque, te dice exactamente qué
  workspace está usando.
- **"Pensamiento Profundo"/"Búsqueda inteligente"**: desactívalos en la
  UI de DeepSeek durante `dscode login` — alargan las respuestas y meten
  texto que rompe el parseo del bloque de tool-call.
- **Aparece un reto de Cloudflare**: corre `dscode login` de nuevo (abre
  visible siempre) y resuélvelo a mano ahí.
- **No encuentra Chromium**: revisa el log `[config] Chromium: ...` al
  arrancar — te dice si detectó uno del sistema o si va a usar el de
  Playwright. Si no tienes ninguno instalado, instala Chrome/Chromium
  normalmente en tu sistema, o descarga el de Playwright manualmente y
  apunta `CHROMIUM_EXECUTABLE_PATH` (puede ser relativa a esta carpeta).
- **Sesión expirada**: `dscode login` de nuevo.

## Limitaciones conocidas

- El input de terminal (`ui/promptLoop.js`) es un editor de línea mínimo:
  soporta escribir, borrar con backspace, Enter y Tab. No soporta mover el
  cursor con flechas dentro de la línea ni pegar texto multi-línea — para
  eso haría falta una librería de UI de terminal completa, que se dejó
  fuera a propósito para no sumar dependencias pesadas.
- El scraping es frágil ante cambios de UI de DeepSeek y sujeto a sus
  retos anti-bot (Cloudflare, login). Mantener `storage-state.json` fresco
  con `dscode login` periódico mitiga la mayoría de casos.
