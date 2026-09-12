# AGENTS.md — dscode 3.5.1

## Propósito

`dscode` es un agente de código para terminal que trabaja sobre el **workspace actual** y utiliza DeepSeek Web mediante Playwright. Está pensado para instalarse una vez y ejecutarse desde cualquier proyecto con `npm link`.

La versión 3.5.1 mantiene el núcleo de confiabilidad de 3.0/3.1, la experiencia CLI de 3.2 y añade el núcleo de confiabilidad/Recovery de 3.3 más el DeepSeek DOM Adapter/Inspector de 3.4/3.5, mientras deja la documentación alineada con el código real.

## Instalación y uso

```bash
npm install
npm run build
npm link

dscode login
cd /ruta/a/tu-proyecto
dscode
```

Opciones de arranque:

```bash
dscode --plan          # iniciar en modo solo lectura
dscode --dir /ruta/proyecto
```

> `dscode` no debe ejecutarse sobre su propia carpeta de instalación. El CLI bloquea ese caso para evitar que el agente se modifique a sí mismo.

## Desarrollo

```bash
npm run build          # TypeScript → dist/
npm run dev            # build + ejecución
npm test               # build + tests de regresión
npm run lint
npm run lint:fix
npm run typecheck
npm run format
npm run format:check
npm run login
npm run calibrate
```

El binario publicado por `npm link` apunta a `dist/app/cli.js`. Después de cambiar el código fuente basta con `npm run build`; no es necesario repetir `npm link`.

### Diagnóstico de DeepSeek Web

Para estudiar cambios reales de la interfaz sin depender de los selectores de producción:

```bash
dscode deepseek inspect
dscode deepseek inspect --record
dscode deepseek inspect --record --out ./deepseek-dom
dscode deepseek inspect --diff antes.html despues.html
```

El inspector debe permanecer como herramienta de mantenimiento. Si DeepSeek cambia el DOM, primero se capturan estados reales con el inspector y después se actualizan el adaptador y sus fixtures. Las capturas pueden contener contenido visible de conversaciones; deben tratarse como datos potencialmente sensibles.

## Arquitectura real

```text
src/
├── app/
│   ├── cli.ts
│   ├── agent/
│   │   ├── agent.ts
│   │   ├── modes.ts
│   │   ├── prompt.ts
│   │   └── taskState.ts
│   └── context/
│       └── loader.ts
├── domain/
│   ├── execution/
│   │   ├── editTransaction.ts
│   │   └── fileSnapshot.ts
│   ├── verification/
│   │   ├── projectDetector.ts
│   │   └── verifier.ts
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── index.ts
│   │   └── definitions/
│   ├── task/
│   │   └── taskPersistence.ts
│   ├── recovery/
│   │   └── recoveryManager.ts
│   └── llm/
│       └── llmError.ts
├── infrastructure/
│   ├── browser/
│   ├── deepseek/
│   │   ├── domAdapter.ts
│   │   └── diagnostics/
│   ├── logger/
│   ├── providers/
│   └── transcript/
├── shared/
│   ├── constants.ts
│   ├── env.ts
│   ├── errors.ts
│   └── safePath.ts
└── ui/
    ├── banner.ts
    ├── bubble.ts
    ├── confirm.ts
    ├── promptLoop.ts
    ├── recoveryPrompt.ts
    ├── spinner.ts
    └── theme.ts
```

### Responsabilidades clave

- `app/agent/agent.ts`: orquesta el ciclo del agente, presupuesto de exploración, tool-calling, mutaciones, verificación y recovery. Persiste turnos con `requestHash` y decide retry/rotación de chat.
- `app/agent/taskState.ts`: mantiene la fase de la tarea y sus contadores.
- `domain/execution/`: aplica cambios de forma transaccional y calcula snapshots SHA-256.
- `domain/verification/`: comprueba cambios físicos y ejecuta verificaciones apropiadas al proyecto.
- `domain/tools/`: contiene las 11 herramientas y su registro central.
- `domain/task/taskPersistence.ts`: persistencia durable (`state.json`, `metadata.json`, `events.jsonl`, `turns/*.json`) bajo `~/.dscode/tasks`.
- `domain/recovery/recoveryManager.ts`: construye recovery packs y decide tipo de recuperación.
- `domain/llm/llmError.ts`: clasifica fallos DeepSeek (`TARGET_CLOSED`, `CONTEXT_EXHAUSTED`, `AUTH_REQUIRED`, `CLOUDFLARE_CHALLENGE`, etc.) y su reintento/rotación.
- `infrastructure/browser/`: sesión Playwright, login, selectores reales y detección de Chromium.
- `infrastructure/deepseek/domAdapter.ts`: adaptador DOM basado en capturas reales (`DeepSeekDomAdapter`, snapshot, `waitUntilReady`, detección de estado).
- `infrastructure/deepseek/diagnostics/`: inspector permanente de la UI real de DeepSeek. Captura HTML, screenshot opcional, inventario interactivo, señales observables y cambios del DOM; no se usa en el flujo normal del agente.
- `infrastructure/providers/`: comunicación con DeepSeek Web y protocolo de tool-calling (usa `domAdapter` y `selectors`).
- `ui/banner.ts`: cabecera 3.5.1 con marca DeepSeek, versión, workspace, branch, `AGENTS.md` y modo PLAN/BUILD.
- `ui/recoveryPrompt.ts`: menú interactivo de recuperación (`retry`/`new_chat`/`pause`/`cancel`).
- `ui/`: REPL, modo PLAN/BUILD, historial y salida compacta.

## Flujo de una tarea

La máquina de estados usa estas fases:

`understand → discover → inspect → edit → verify → repair → complete`

No todas las tareas pasan por todas las fases. Una consulta que no modifica archivos puede terminar después de analizar la información disponible.

### Regla fundamental de BUILD

Cuando ya existe suficiente contexto para implementar la solicitud, el agente debe **editar**, no seguir leyendo por inercia. El runtime aplica presupuestos para evitar ciclos de exploración.

Antes de modificar un archivo existente:

1. localizarlo;
2. leerlo;
3. conservar el snapshot de esa lectura;
4. ejecutar una mutación con `expected_hash` inyectado por el runtime;
5. comprobar `changed=true`;
6. verificar el resultado.

## Protecciones de edición

Las mutaciones (`write_file`, `edit_file`, `apply_patch` y `delete_file`) utilizan transacciones y snapshots.

Si el archivo cambió entre la lectura y la edición, el hash actual no coincide con `expected_hash` y la operación se rechaza con un conflicto de edición. Esto evita sobrescribir silenciosamente cambios externos.

Una mutación tampoco se considera completada solo porque la herramienta respondió: debe existir evidencia física de cambio (`changed=true`) y después ejecutarse la verificación correspondiente.

## Presupuestos

Valores por defecto definidos en `src/shared/constants.ts`:

| Límite | Por defecto |
|---|---:|
| Iteraciones de tools | 30 |
| Lecturas por archivo | 4 |
| Lecturas totales por tarea | 12 |
| Lectura máxima de archivo | 40.000 caracteres |
| Resultado máximo de tool | 24.000 caracteres |
| `read_many` | 40 archivos |
| `glob` | 200 resultados |
| Timeout de comandos | 60 s |
| Timeout de búsqueda | 30 s |
| Intentos LLM por turno | 3 |
| Aviso de contexto | 90.000 caracteres |
| Límite crítico de contexto | 120.000 caracteres |

Todos los límites configurables usan variables `DSCODE_*` documentadas en el README.

## Contexto del proyecto

El loader busca:

- `AGENTS.md` en la raíz;
- `AGENTS.md` anidados hasta 3 niveles;
- Markdown dentro de `.agent/`, `agents/` y `.deepseek/`.

El contexto se limita antes de enviarse al modelo. Los archivos de convenciones se enumeran y se cargan bajo demanda para no inflar cada turno.

## Herramientas

El registro central contiene 11 tools:

`read_file`, `write_file`, `list_directory`, `run_command`, `search_files`, `delete_file`, `edit_file`, `read_many`, `glob`, `apply_patch`, `diagnostics`.

Al agregar una tool nueva:

1. crear su carpeta en `src/domain/tools/definitions/<name>/`;
2. exportar un `ToolDefinition`;
3. registrarla en `src/domain/tools/index.ts`;
4. añadir pruebas si introduce comportamiento nuevo.

## Seguridad del workspace

Toda operación de filesystem debe respetar `resolveSafe(workspaceDir, relPath)`. El guard del CLI también impide utilizar como workspace la propia instalación de `dscode` o cualquiera de sus subdirectorios.

`run_command` no constituye un sandbox de seguridad: utiliza el shell del sistema. Las listas de patrones bloqueados solo frenan comandos destructivos obvios; no deben presentarse como una frontera de seguridad fuerte.

## Configuración y secretos

La configuración se carga desde `<AGENT_INSTALL_DIR>/.env`.

Nunca commits `.env`, `storage-state.json` ni credenciales. Usa `.env.example` como plantilla.

`MODEL_PROVIDER` es una variable heredada/deprecada: la implementación actual utiliza exclusivamente DeepSeek Web mediante Playwright. No documentar una API de DeepSeek como proveedor activo sin implementar primero ese backend.

## Estilo

- TypeScript estricto y ESM.
- Imports con extensión `.js` en el código TypeScript compilado como NodeNext.
- No introducir `any` sin necesidad.
- Preferir `createLogger()` sobre `console.log` en módulos de aplicación.
- Mantener cambios pequeños y verificables.
- No afirmar que una edición ocurrió hasta ejecutar la tool correspondiente.
