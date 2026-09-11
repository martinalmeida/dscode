
## dscode 3.1.0

### v3.1 — control de exploración y ediciones seguras

La v3.1 mantiene la arquitectura de v3.0 y endurece el orquestador:

- Presupuesto de exploración por archivo y por tarea (`DSCODE_MAX_READS_PER_FILE`, `DSCODE_MAX_TOTAL_READS`).
- `EditIntent` gestionado por el runtime a partir del último snapshot real del archivo.
- Las mutaciones reciben automáticamente `expected_hash`; si el archivo cambió externamente se devuelve `EDIT_CONFLICT` y no se sobrescribe.
- Ventana predeterminada de resultados de tools ampliada a 24k caracteres para evitar paginación innecesaria en archivos medianos.
- Después de una mutación confirmada se mantiene la verificación física y la reparación automática de v3.0.


La versión 3 reorganiza el agente alrededor de un estado explícito de tarea y del filesystem como fuente de verdad. En BUILD, una petición de cambio no se considera terminada porque DeepSeek diga que la hizo: la mutación debe ocurrir físicamente, reportar `changed=true` y pasar una verificación posterior.

Cambios principales:
- máquina de estados de tarea (`understand → discover → inspect → edit → verify → repair → complete`);
- un único tool call por respuesta del modelo;
- transacciones atómicas para `write_file`, `edit_file`, `apply_patch` y `delete_file`;
- hashes SHA-256 antes/después para detectar cambios reales;
- verificación automática adaptada al tipo de proyecto;
- recuperación ante loops, respuestas textuales prematuras y ediciones que no cambian el archivo;
- suite E2E local con un DeepSeek mock para comprobar el ciclo completo de edición.

Para validar la instalación completa:

```bash
npm install
npm test
```

El test comprueba que una petición de BUILD puede pasar de tool call a modificación real del archivo y a una respuesta final del agente.

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

## Changelog

### 2026-09-11 — dscode 2.0.1: ejecución y contexto

- Se redujo drásticamente el prompt permanente del agente para dejar espacio al contexto real del proyecto, la petición del usuario y las herramientas.
- BUILD ahora tiene una regla explícita de ejecución y un progress gate para evitar ciclos largos de solo lectura.
- El payload web preserva la petición actual y las instrucciones de herramientas cuando necesita recortar contexto.
- El truncado y la compactación normales dejaron de registrarse como warnings; los warnings quedan reservados para errores/reintentos relevantes.
- Las convenciones de `.agent/`, `agents/` y `.deepseek/` se enumeran y se cargan bajo demanda en lugar de inyectarse completas en cada prompt.
- Se corrigieron errores de narrowing en `cli.ts` que aparecían con TypeScript strict.
- La distribución no incluye `.env` ni `storage-state.json`; usa `.env.example` para configurar una instalación nueva.


### 2026-09-11 — Segunda pasada: auditoría completa

Tras el fix del truncado, se revisó el resto del código buscando bugs reales
(no cosméticos). Se encontraron y corrigieron:

- **`glob`** rechazaba patrones de dotfile legítimos como `**/.env` o
  `**/.gitignore` — exactamente los que su propia descripción recomienda como
  ejemplo. La validación anti-typo ahora distingue "falta el `*` antes de una
  extensión de código" (`pages/.tsx`, sigue bloqueado) de "esto es un dotfile
  real" (`.env`, `.gitignore`, ahora permitido).
- **`edit_file`/`write_file`** ignoraban el `.prettierrc` real del proyecto y
  reformateaban siempre con opciones fijas (2 espacios, etc.), violando la
  propia regla del agente de "respeta el estilo existente". Ahora usan
  `prettier.resolveConfig()` del proyecto si existe.
- **`apply_patch`** fallaba siempre ("el diff no aplica limpio") en archivos
  con finales de línea CRLF (típico en repos tocados desde Windows), porque
  comparaba línea a línea sin normalizar el `\r` colgante. Ahora normaliza
  para diffear y restaura CRLF al escribir si el original lo usaba.
- **`BLOCKED_PATTERNS`** no atrapaba `rm -rf /*` ni variantes con flags en
  otro orden (`rm -fr /`). Se amplió la regex. Nota: esto sigue siendo una
  lista negra de texto, no un sandbox — `run_command` corre con `shell:true`
  y cualquier blocklist así es evadible a propósito; solo frena lo más obvio.
- **Contexto anidado**: el README documenta "AGENTS.md anidados hasta 3
  niveles" pero el código nunca aplicaba ese límite (`_depth` se incrementaba
  pero no se comparaba contra nada) — recorría el árbol completo del
  proyecto sin freno. Ahora sí respeta el límite de 3 niveles.
- **`diagnostics`** asumía que TODO proyecto es TypeScript con ESLint
  corriendo sobre `src/`. En un proyecto que no sea TS (ej. un landing en
  HTML/JS plano), esto producía ruido de `tsc` sin sentido o un falso "sin
  errores" de eslint porque `src/` ni existía. Ahora detecta `tsconfig.json`
  y la config de eslint antes de correr cada uno, y busca la carpeta de
  código real (`src`, `app`, `lib`, o raíz) en vez de asumir `src/` fijo.
- **`search_files`** dependía 100% del binario `grep` del sistema — no
  existe en Windows sin WSL/Git Bash, y con `reject:false` `execa` no
  lanzaba excepción en ese caso (solo `result.failed=true` en silencio), así
  que reportaba "sin coincidencias" de forma engañosa en vez de fallar
  visiblemente. Se agregó un fallback de búsqueda en Node puro que se activa
  automáticamente cuando `grep` no está disponible.

**Limitaciones conocidas que NO se pueden "arreglar" del todo** (por diseño o
por naturaleza del problema, no por descuido):
- El scraping de chat.deepseek.com seguirá siendo frágil ante cambios de su UI
  — es la naturaleza de automatizar una interfaz web no pensada para esto.
- `BLOCKED_PATTERNS` es una traba básica contra errores obvios, nunca un
  sandbox real. Con `run_command` autónomo y `shell:true`, la única
  protección de verdad contra comandos verdaderamente adversarios sería
  correr en un contenedor aislado — fuera del alcance de este proyecto tal
  como está diseñado hoy.
- `toolProtocol.ts` (el parser de bloques `TOOL_CALL` desde texto plano) ya
  tiene bastantes parches defensivos de iteraciones anteriores; se revisó
  pero no se reescribió — tocarlo a fondo sin un set de tests de regresión
  real es más riesgo que beneficio en este momento.

### 2026-09-10 — Fix: el agente "no editaba nada" / no sabía qué tarea tenía

**Síntoma:** en proyectos con `AGENTS.md` grande, el agente respondía cosas
como "¿En qué trabajamos?" en vez de ejecutar la tarea pedida, o parecía no
saber en qué modo (Plan/Build) estaba.

**Causa raíz:** `capTextToSend` (`src/infrastructure/providers/webClient.ts`)
recortaba el payload cortando desde el **inicio** del texto cuando superaba
`DSCODE_MAX_SEND_CHARS`. Como el payload se arma como
`[SYSTEM] (prompt base + AGENTS.md) → [USER] (tu pedido) → HERRAMIENTAS`,
y el prompt base + `AGENTS.md` truncado a `DSCODE_MAX_CONTEXT_CHARS=12000`
ya pesaban más que el cap, el recorte caía **dentro** del contexto de
`AGENTS.md` y se comía por completo tu mensaje y el bloque de tools. El
modelo nunca veía ni la tarea ni cómo llamar a las tools.

**Fix:** `capTextToSend` ahora recorta primero (y solo) el bloque de
contexto de proyecto (entre `--- Contexto del proyecto ---` y
`--- Fin contexto ---`), preservando siempre el prompt base, tu mensaje y
las instrucciones de tools. Si aun así no alcanza, conserva la cola del
payload en vez de la cabeza. También se bajó `DSCODE_MAX_CONTEXT_CHARS` de
12000 a 6000 en `.env` para que el recorte sea la excepción, no la regla,
en cada turno (ver comentarios en `.env`).

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
