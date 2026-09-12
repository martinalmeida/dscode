# dscode

**Agente de código para terminal con DeepSeek Web + Playwright.**

`dscode` trabaja sobre el proyecto que indiques como workspace y combina exploración, edición y verificación en un flujo controlado. Está diseñado para instalarse una sola vez y utilizarse desde cualquier proyecto.

> **Versión:** 3.9.1

## ✨ Qué ofrece

- **BUILD** para implementar cambios y **PLAN** para analizar sin modificar.
- Tool-calling con una herramienta por turno.
- Presupuesto de exploración para evitar bucles de lectura.
- Ediciones protegidas por snapshot SHA-256 y `expected_hash`.
- Transacciones de filesystem con evidencia física de cambio.
- Verificación y reparación después de mutaciones.
- Contexto de proyecto mediante `AGENTS.md`, `.agent/`, `agents/` y `.deepseek/`.
- REPL compacto con historial, slash commands y cambio rápido de modo.
- Sesión de DeepSeek persistida mediante Playwright.
- Detección automática de Chromium/Chrome.
- Persistencia durable de tareas: checkpoints, `events.jsonl` y turnos LLM con `requestHash`.
- Recuperación tolerante a fallos de DeepSeek (retry, rotación de chat, menú interactivo).
- `DeepSeekDomAdapter` basado en capturas reales del DOM (composer, mensajes y señales de estado).
- Inspector `dscode deepseek inspect` para diagnosticar cambios de la UI sin tocar el adaptador de producción.
- Guard de `run_command` sin falsos positivos para comandos de lectura y bloqueo de mutaciones directas (`rm`, `sed -i`, redirecciones, `git restore` no solicitado).
- Protección de archivos de configuración críticos (`delete_file` y reescritura de `docker-compose.yml`/`compose.yml` bloqueadas hasta validar).
- Verificación física extendida: `docker compose config` / `podman compose config` como fuente de verdad para Compose + `typecheck`/`lint`/`build` según el proyecto.
- Recovery automático para `RESPONSE_TIMEOUT` (nuevo chat + retry) y menú de recuperación que pausa `input`/`spinner`.
- Persistencia de contexto `PLAN → BUILD` (`ok`/`aplicar` retoma el plan aprobado) y manejo de `EDIT_CONFLICT`/`snapshot stale` sin reutilizar hashes obsoletos.

## 🚀 Instalación

### 1. Instalar dependencias y compilar

Desde la carpeta de `dscode`:

```bash
npm install
npm run build
npm link
```

`npm link` crea el comando global `dscode`. Si tu instalación de npm requiere privilegios, utiliza el mecanismo de permisos correspondiente a tu sistema; no es necesario volver a enlazar después de cada cambio de código.

### 2. Configurar la sesión de DeepSeek

Crea tu configuración a partir de la plantilla:

```bash
cp .env.example .env
dscode login
```

`dscode login` abre Chromium en modo visible para que puedas iniciar sesión. La sesión se guarda en `storage-state.json` dentro de la instalación de `dscode`, no dentro del proyecto que estés editando.

### 3. Ejecutar desde cualquier proyecto

```bash
cd /ruta/a/mi-proyecto
dscode
```

También puedes indicar otro workspace:

```bash
dscode --dir /ruta/a/mi-proyecto
```

Para iniciar en solo lectura:

```bash
dscode --plan
```

## 🧭 BUILD y PLAN

### BUILD

Es el modo normal. El agente puede explorar, modificar archivos, ejecutar comandos y verificar el resultado según las herramientas y reglas del proyecto.

La directiva central es simple: **cuando ya hay suficiente información para implementar, se edita**. Los presupuestos de lectura evitan que el modelo continúe explorando indefinidamente.

### PLAN

Se utiliza para comprender el proyecto y preparar una solución sin realizar mutaciones. Es útil para revisar una arquitectura, localizar el origen de un problema o preparar una estrategia antes de cambiar código.

Puedes cambiar de modo con `Tab` o mediante `/plan` y `/build`.

## 🖥️ Interfaz de la CLI

La cabecera de 3.9.1 usa una interfaz inspirada en las CLIs modernas de agentes de código: marca visual de DeepSeek, versión, sesión, motor Web/Playwright, workspace y estado de `AGENTS.md`. Debajo muestra el flujo del agente y los comandos disponibles, manteniendo el prompt `PLAN/BUILD` compacto.

Ejemplo conceptual:

```text
      [marca DeepSeek]       dscode v3.9.1
                               Powered by DeepSeek
                               ● DeepSeek Web
                               ◉ DeepSeek Chat (Web · Playwright)
                               ▣ /ruta/al/proyecto
                               ▤ AGENTS.md cargado

  ─────────────────────────────────────────────────────────────
  Tu agente de desarrollo en la terminal.
  Explora · Edita · Ejecuta · Verifica · Construye
  ─────────────────────────────────────────────────────────────
  /help   /plan   /build   /status   /clear   /exit
  Tab: alterna   Ctrl+L: limpiar   ↑/↓: historial
  ● BUILD  @mi-proyecto ›                                      ⌘ master
```

La cuenta mostrada en la cabecera puede personalizarse con `DSCODE_ACCOUNT`; no contiene secretos ni reemplaza la sesión real de DeepSeek.

## 🎛️ Comandos de la CLI

```text
/help       mostrar ayuda
/status     mostrar proyecto y modo actual
/clear      limpiar la terminal
/plan       cambiar a PLAN
/build      cambiar a BUILD
/exit       salir
```

Atajos:

- `Tab` — alternar PLAN/BUILD.
- `↑ / ↓` — navegar por el historial de prompts.
- `Ctrl+L` — limpiar la pantalla.
- `Ctrl+C` — salir.

## 🏗️ Arquitectura

```text
src/
├── app/
│   ├── cli.ts                 # Entrypoint, ciclo de vida y subcomando deepseek inspect
│   ├── agent/
│   │   ├── agent.ts           # Orquestador principal + persistencia y recovery
│   │   ├── modes.ts           # PLAN/BUILD y límites de iteración
│   │   ├── prompt.ts          # Prompt del sistema
│   │   └── taskState.ts       # Estado y fases de la tarea
│   └── context/
│       └── loader.ts          # Carga del contexto del proyecto
├── domain/
│   ├── execution/             # Snapshots y transacciones de edición
│   ├── verification/          # Detección de proyecto y verificación
│   ├── tools/                 # Registro e implementación de tools
│   ├── task/                  # Persistencia durable (state, events, turns)
│   ├── recovery/              # Recovery packs y clasificación de fallos
│   └── llm/                   # Clasificación de errores LLM / DeepSeek
├── infrastructure/
│   ├── browser/               # Playwright, login, selectores y Chromium
│   ├── deepseek/              # DomAdapter + inspector/diagnóstico permanente
│   ├── logger/                # Pino
│   ├── providers/             # DeepSeek Web + protocolo de tools
│   └── transcript/            # Historial persistente de sesiones
├── shared/                    # Paths seguros, env, errores y constantes
└── ui/                        # REPL, banner, bubbles, spinner, recoveryPrompt y tema
```

La implementación actual tiene **11 herramientas**:

`read_file`, `write_file`, `list_directory`, `run_command`, `search_files`, `delete_file`, `edit_file`, `read_many`, `glob`, `apply_patch`, `diagnostics`.

## 🔄 Cómo evita los bucles de lectura

El agente mantiene estado por tarea y aplica dos presupuestos:

- **4 lecturas por archivo** por defecto.
- **12 lecturas totales** por defecto.

Además, una lectura puede producir un snapshot SHA-256 que el runtime conserva para las siguientes mutaciones. Si el archivo cambió fuera del agente, la edición falla con `EDIT_CONFLICT` en lugar de sobrescribir el cambio externo.

Después de una mutación, el runtime exige `changed=true` y pasa a verificación. Si una comprobación falla por algo introducido durante la tarea, el agente puede entrar en `repair` y corregirlo.

## 🧠 Contexto del proyecto

`dscode` busca contexto en:

1. `AGENTS.md` de la raíz.
2. `AGENTS.md` anidados hasta 3 niveles.
3. Markdown dentro de `.agent/`, `agents/` y `.deepseek/`.

Las reglas principales se inyectan en el prompt. Las convenciones adicionales se enumeran y se pueden leer bajo demanda. El contexto tiene un límite configurable para evitar que la documentación desplace las instrucciones y las herramientas del modelo.

### Recomendación para tu proyecto

Mantén un `AGENTS.md` raíz pequeño y operativo: arquitectura importante, comandos de verificación, reglas de edición, convenciones y restricciones. Deja detalles muy extensos en documentación especializada dentro de `.agent/` o una carpeta equivalente.

## 🛡️ Seguridad y límites

El workspace está aislado mediante `resolveSafe()`, que impide escapes de ruta y contempla symlinks. El CLI también rechaza utilizar la propia instalación de `dscode` como workspace.

Esto **no convierte a `dscode` en un sandbox**. `run_command` ejecuta comandos del sistema; las reglas de bloqueo solo cubren patrones destructivos obvios y no deben considerarse una defensa contra un usuario o proceso malicioso.

No publiques nunca:

```text
.env
storage-state.json
```

La distribución incluye `.env.example` para separar configuración de secretos.

## ⚙️ Configuración

La configuración se lee desde `<AGENT_INSTALL_DIR>/.env`.

### DeepSeek Web

```dotenv
CHAT_URL=https://chat.deepseek.com/
HEADLESS=true
STORAGE_STATE_PATH=./storage-state.json
RESPONSE_TIMEOUT_MS=300000
CHROMIUM_EXECUTABLE_PATH=
```

`CHROMIUM_EXECUTABLE_PATH` vacío activa la autodetección. Una ruta relativa se resuelve respecto a la instalación de `dscode`.

### Contexto, tools y exploración

```dotenv
DSCODE_MAX_CONTEXT_CHARS=5000
DSCODE_MAX_SEND_CHARS=16000
DSCODE_MAX_TOOL_ITERATIONS=40
DSCODE_MAX_FILE_READ_CHARS=40000
DSCODE_MAX_TOOL_RESULT_CHARS=24000
DSCODE_MAX_READS_PER_FILE=4
DSCODE_MAX_TOTAL_READS=12
DSCODE_COMMAND_TIMEOUT_MS=60000
DSCODE_SEARCH_TIMEOUT_MS=30000
DSCODE_GLOB_LIMIT=200
DSCODE_READ_MANY_LIMIT=40
```

No necesitas modificar estos valores para empezar. Los límites existen para controlar consumo de contexto y prevenir exploración excesiva.

### Logging

```dotenv
LOG_LEVEL=warn
LOG_PRETTY=true
```

Los logs se escriben en `stderr` para no interferir con el REPL. Los campos sensibles conocidos se redactan.

### Recovery y límites de contexto

```dotenv
DSCODE_MAX_LLM_ATTEMPTS=3
DSCODE_CONTEXT_WARNING_CHARS=90000
DSCODE_CONTEXT_CRITICAL_CHARS=120000
# Directorio base de tareas persistidas (por defecto ~/.dscode/tasks)
# DSCODE_TASK_DIR=
# Cuenta mostrada en la cabecera (no es secreta)
DSCODE_ACCOUNT=DeepSeek Web
```

Las tareas se persisten bajo `~/.dscode/tasks/<workspace-hash>/<taskId>/` con `state.json`, `metadata.json`, `events.jsonl` y `turns/*.json`. Cada turno conserva `requestHash` y reintentos; si DeepSeek agota el contexto o falla el transporte, el agente puede reintentar la misma solicitud o rotar a un nuevo chat con un recovery pack sin perder el objetivo.

### `MODEL_PROVIDER`

Es una variable heredada/deprecada. La implementación 3.9.1 utiliza **solo DeepSeek Web mediante Playwright**. Si queda `MODEL_PROVIDER=api` de una configuración antigua, dscode la ignora y muestra un aviso.

## 🖥️ Chromium

Puedes dejar `CHROMIUM_EXECUTABLE_PATH` vacío para que dscode detecte un navegador compatible. También puedes fijar un ejecutable concreto si tu entorno lo requiere.

El login y la calibración se ejecutan con navegador visible para que puedas interactuar con la página:

```bash
dscode login
dscode calibrate
```

## 🧪 Validación local

Antes de publicar cambios:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
```

El test de regresión cubre el protocolo de tool-calling, transacciones de escritura, conflictos por hash y el comportamiento básico del agente después de una mutación.

## 📁 Convenciones de desarrollo

- TypeScript estricto + ESM/NodeNext.
- Mantener la lógica de filesystem dentro de las tools/transacciones correspondientes.
- Usar `resolveSafe()` para rutas del workspace.
- Preferir `createLogger()` frente a `console.log` en módulos de aplicación.
- Mantener una sola fuente de verdad para el registro de tools.
- Antes de modificar un archivo existente, leerlo primero.
- Después de una mutación, verificar el resultado.

## 🔧 Mantenimiento

```bash
npm run build
npm run dev
npm run lint
npm run lint:fix
npm run typecheck
npm run format
npm run format:check
npm test
```

El proyecto no requiere `npm link` de nuevo después de recompilar.

## 📋 Changelog

Consulta [`CHANGELOG.md`](./CHANGELOG.md) para el historial de versiones.

## ⚠️ Limitaciones conocidas

- El proveedor actual depende de la interfaz web de DeepSeek y de sus selectores DOM; cambios del sitio pueden requerir mantenimiento.
- La sesión depende del estado persistido de Playwright.
- La calidad de las verificaciones posteriores depende de las herramientas disponibles en el workspace y de lo que detecte `projectDetector`.
- `run_command` tiene acceso al shell del usuario; no es un entorno aislado.

## Licencia

No se declara una licencia en este repositorio. Añade una licencia explícita antes de distribuir `dscode` como software de terceros.

## Novedades 3.6 — 3.9.1

- **3.9.1:** `git restore`/`git checkout -- <archivo>` solo cuando la tarea lo solicita; `taskObjective` en `ToolContext` para políticas conscientes de intención; `delete_file` bloquea borrados no solicitados de configs críticas (`src/domain/tools/types.ts:7`, `src/domain/tools/definitions/deleteFile/deleteFile.tool.ts:1`).
- **3.9.0:** `run_command` sin falsos positivos para `ls|grep|cat`; `RESPONSE_TIMEOUT` hace `recoverNewChat` automático una vez antes de pedir decisión; recovery prompt pausa `input`/`spinner`; guard de infraestructura para `docker-compose.yml`/`compose.yml` (`src/domain/tools/definitions/runCommand/runCommand.tool.ts:1`, `src/app/agent/agent.ts:163`).
- **3.8.0:** bloqueo de mutaciones por shell (`rm`, `sed -i`, redirecciones, scripts de escritura) y guard que exige `docker compose config` antes de reescribir Compose tras un fallo (`src/shared/constants.ts:2`, `src/domain/verification/verifier.ts:45`).
- **3.7.x:** verificador de Compose dedicado y `run_command` con `exitCode` no-cero fuerza `repair`; ya no se delega al usuario el comando fallido (`src/domain/verification/verifier.ts:70`).
- **3.6.0:** `pendingPlan` mantiene el contexto de `PLAN` al confirmar con `ok`/`aplicar`; snapshots invalidados tras `run_command` que toca archivos leídos; `EDIT_CONFLICT` con recovery sin reutilizar hashes (`src/app/agent/taskState.ts:1`, `src/app/agent/agent.ts:354`).

## Reliability and DeepSeek recovery (v3.3+)

Long-running tasks are persisted under `~/.dscode/tasks` (or `DSCODE_TASK_DIR`). Cada tarea registra checkpoints (`state.json`), `events.jsonl`, turnos LLM con `requestHash` e intentos. Un fallo de transporte/sesión se expone al usuario y la misma solicitud lógica se reintenta. Si el chat de DeepSeek agota el contexto, dscode lo clasifica como rotación: hace checkpoint de la tarea, crea un recovery pack, abre un nuevo chat y retoma el turno actual allí.

Cuando la recuperación automática se agota o la decisión no debe tomarse en silencio, la CLI muestra un menú (`retry` / `new_chat` / `compact_new_chat` / `pause` / `cancel`). `CONTEXT_EXHAUSTED`, fallos de autenticación, retos de Cloudflare, caídas de browser/page y timeouts de respuesta se mantienen como clases de fallo distintas en el event log. `src/domain/task/taskPersistence.ts:42` y `src/domain/recovery/recoveryManager.ts:8` y `src/domain/llm/llmError.ts:16`.

## DeepSeek DOM Adapter (v3.5.0+)

La integración web usa `src/infrastructure/deepseek/domAdapter.ts:38` (`DeepSeekDomAdapter`) derivado de capturas reales (`tests/fixtures/deepseek/observed-structure.html`). Composer prioriza `textarea[placeholder="Mensaje a DeepSeek"]` / `textarea[name="search"]`, asistente `.ds-message:has(.ds-assistant-message-main-content)`, usuario `.ds-message:has(.ds-collapsible-text)`, y envío/detención se distinguen por firmas SVG observadas. Errores solo se buscan en `[role="alert"]`/`[role="status"]`/notificaciones; no en títulos de chats.

## DeepSeek DOM Inspector

`dscode` incluye un inspector permanente para diagnosticar cambios de la interfaz de DeepSeek Web cuando se usa Playwright. No forma parte del flujo normal del agente: se utiliza para capturar evidencia real del DOM y mantener el adaptador cuando DeepSeek cambia su UI.

```bash
# Captura única del estado actual
 dscode deepseek inspect

# Abre el navegador visible y permite capturar estados manualmente
 dscode deepseek inspect --record

# Guardar capturas en otra carpeta
 dscode deepseek inspect --record --out ./deepseek-dom

# Omitir screenshots
 dscode deepseek inspect --record --no-screenshot
```

Cada captura guarda:

- HTML completo de la página.
- Screenshot opcional.
- URL y título.
- Inventario de elementos interactivos (`role`, `aria-*`, `data-testid`, `placeholder`, `id`, clases y texto).
- Conteos de composer, botones, textareas, contenteditable, enlaces y señales de estado.
- Muestras del `MutationObserver` para saber qué cambió en la UI.

Las capturas se guardan por defecto en `.dscode/deepseek-debug/` del directorio desde el que se ejecuta el comando. No contienen credenciales de `storageState`; el inspector solo serializa el DOM y metadatos observables de la página.

### Comparar capturas

El inspector también permite comparar dos capturas HTML para detectar cambios de la interfaz:

```bash
 dscode deepseek inspect --diff .dscode/deepseek-debug/old.html .dscode/deepseek-debug/new.html
```

El diff es deliberadamente conservador: informa líneas añadidas/eliminadas y sirve como señal inicial de regresión; no sustituye un análisis semántico del DOM.

### Flujo recomendado para diagnosticar un cambio de DeepSeek

1. Ejecuta `dscode deepseek inspect --record`.
2. Utiliza la ventana visible de DeepSeek normalmente.
3. Envía mensajes, espera respuestas y, si aparece un estado extraño, deja que el inspector capture el cambio o pulsa `c`.
4. Entrega la carpeta `.dscode/deepseek-debug/` para analizar los estados reales.
5. Para comparar dos estados HTML, usa `--diff`.

El modo de diagnóstico usa una sesión permisiva que no depende de los selectores de producción. Esto es intencional: si la UI cambia y rompe el adaptador normal, el inspector debe seguir siendo utilizable para descubrir la nueva estructura.

**Privacidad:** las capturas contienen el DOM real de DeepSeek y pueden incluir mensajes, nombres, títulos de conversaciones u otros datos visibles. No compartas la carpeta si contiene información sensible.

## DeepSeek DOM diagnostics

Sin cambios respecto a la sección anterior: el inspector en `src/infrastructure/deepseek/diagnostics/` es la herramienta permanente de mantenimiento. Si cambia el DOM, primero se capturan estados reales con `dscode deepseek inspect --record` y luego se actualiza `src/infrastructure/browser/selectors.ts:1` y `src/infrastructure/deepseek/domAdapter.ts:38` con sus fixtures. Ver también `src/infrastructure/deepseek/diagnostics/domInspector.ts:1` y `src/infrastructure/deepseek/diagnostics/domDiff.ts:1`.
