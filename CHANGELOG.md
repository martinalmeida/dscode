# Changelog

## 3.5.1 — Docs & release polish

- Documentación alineada a código real de 3.5.x: README y AGENTS.md actualizados a v3.5.1.
- Arquitectura documentada completa (`domain/task`, `domain/recovery`, `domain/llm`, `infrastructure/deepseek`, `ui/recoveryPrompt`).
- Presupuestos `DSCODE_MAX_LLM_ATTEMPTS` / `DSCODE_CONTEXT_WARNING_CHARS` / `DSCODE_CONTEXT_CRITICAL_CHARS` documentados.
- Cabecera 3.5.1 (marca DeepSeek, `AGENTS.md` cargado, workspace, branch, PLAN/BUILD) documentada en README y AGENTS.md.
- Selectores y `DeepSeekDomAdapter` referenciados a fixtures reales (`tests/fixtures/deepseek/observed-structure.html`).

## 3.5.0 — DeepSeek DOM Adapter

- Integración del `DeepSeekDomAdapter` basado en capturas reales de DeepSeek Web.
- Composer prioriza `textarea[placeholder="Mensaje a DeepSeek"]` y `textarea[name="search"]`.
- Mensajes del asistente se detectan mediante `.ds-message:has(.ds-assistant-message-main-content)`.
- Mensajes del usuario se detectan mediante `.ds-message:has(.ds-collapsible-text)`.
- Envío y detención de generación se distinguen mediante las firmas SVG observadas en el DOM real.
- Eliminado el falso positivo global `GENERIC_ERROR_TEXT_SIGNAL`.
- Los errores activos se buscan únicamente en alertas/notificaciones y estados semánticos, no en títulos de conversaciones.
- `waitForChatReady`, envío, lectura de respuestas y rotación de chat utilizan el adapter.
- Se conserva el inspector DOM como herramienta permanente de diagnóstico/regresión.

## 3.4.0 - DeepSeek DOM Inspector

- Añadido inspector permanente de diagnóstico para DeepSeek Web.
- Añadida captura de HTML completo, screenshot, texto visible y metadatos de la página.
- Añadido inventario de elementos interactivos y atributos útiles para mantener selectores.
- Añadido `MutationObserver` para registrar cambios reales del DOM.
- Añadido comando `dscode deepseek inspect` y modo `--record`.
- Preparada la base para crear fixtures de regresión del DOM de DeepSeek.

## 3.3.0 - Reliability Core

- Durable task state, checkpoints and JSONL event log.
- Persisted LLM turns and attempts with request hashes.
- Explicit DeepSeek failure feedback and recovery decisions.
- Same logical request is retried after transport failures.
- Context exhaustion is classified separately and can rotate to a new chat with a recovery pack.
- Added recovery UI and fault-tolerance building blocks.

## 3.2.1 — 2026-09-11

### CLI y experiencia visual

- Rediseñada la cabecera de la CLI con una marca ASCII inspirada en DeepSeek.
- Añadidos versión, cuenta configurable, motor Web/Playwright, workspace y estado de `AGENTS.md` a la cabecera.
- Integrados branch, modo PLAN/BUILD y atajos en una presentación compacta.

### Documentación y mantenimiento

- Alineada `AGENTS.md` con la arquitectura y los valores reales de `src/`.
- Corregida la documentación para no presentar un proveedor API de DeepSeek que la implementación actual no utiliza.
- Documentados los 11 tools reales, la máquina de estados, los presupuestos de exploración y el flujo `expected_hash` → `changed=true` → verificación.
- Añadido `.env.example` con las variables realmente consumidas por el código.
- Añadido `.gitignore` para evitar publicar `.env`, `storage-state.json`, `dist/`, dependencias y Chromium local.
- Actualizada la versión del paquete a `3.2.1`.
- Pulida la documentación de instalación global mediante `npm link`, desarrollo y operación desde cualquier workspace.

### Correcciones de documentación

- El límite real de lecturas por archivo queda documentado como 4 por defecto.
- La carga de `AGENTS.md` anidados queda documentada con profundidad máxima de 3 niveles.
- Se aclara que las carpetas `.agent/`, `agents/` y `.deepseek/` se cargan bajo demanda.
- Se aclara que `run_command` no es un sandbox de seguridad.

## 3.2.0 — CLI product UX

- Reemplazado el banner grande por una cabecera compacta.
- Añadidos `/help`, `/status`, `/clear`, `/plan`, `/build` y `/exit`.
- Añadido historial con ↑/↓.
- Añadido Ctrl+L para limpiar la terminal.
- Reducido el ruido visual de las tools.
- Mantenido el núcleo de filesystem/orquestación de 3.1.x.

## 3.1.0 — Exploración y edición segura

- Añadidos presupuestos de lectura por archivo y por tarea.
- Añadido `EditIntent` con snapshots SHA-256.
- Inyección de `expected_hash` en las mutaciones.
- Añadida detección de conflictos `EDIT_CONFLICT`.
- Mejorado el avance de BUILD hacia la edición después de suficiente inspección.
- Añadida cobertura de regresión para ediciones obsoletas.

## 3.0.0 — Confiabilidad del agente

- Introducida máquina de estados de tarea.
- Añadidas transacciones atómicas de edición.
- Añadida verificación física de cambios.
- Añadido protocolo de un tool por turno.
- Añadida verificación/reparación posterior a mutaciones.
