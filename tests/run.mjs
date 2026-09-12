import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { parseModelResponseMulti } = await import("../dist/infrastructure/providers/toolProtocol.js");
const { writeFileTransaction, EditConflictError } = await import("../dist/domain/execution/editTransaction.js");
const { Agent } = await import("../dist/app/agent/agent.js");

const protocolCases = [
  '<<<TOOL_CALL>>>{"name":"read_file","arguments":{"path":"src/App.tsx"}}<<<END_TOOL_CALL>>>',
  'texto previo <<<TOOL_CALL>>>{"name":"apply_patch","arguments":{"path":"src/App.tsx","diff":"@@ -1 +1 @@\\n-a\\n+b"}}<<<END_TOOL_CALL>>>',
  '<<<TOOL_CALL>>>{"name":"edit_file","arguments":{"path":"src/App.tsx","old_string":"a","new_string":"b"}}',
];
for (const input of protocolCases) {
  const calls = parseModelResponseMulti(input);
  assert.equal(calls.length, 1, "el protocolo debe aceptar un solo tool call");
  assert.ok(calls[0].name);
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "dscode-v3-"));
try {
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "App.tsx"), "export const App = () => <div>Hello</div>;\n", "utf8");

  const transaction = await writeFileTransaction(workspace, "src/App.tsx", "export const App = () => <div>Hello World</div>;\n");
  assert.equal(transaction.changed, true);
  assert.notEqual(transaction.before.hash, transaction.after.hash);
  assert.match(await fs.readFile(path.join(workspace, "src", "App.tsx"), "utf8"), /Hello World/);

  await assert.rejects(
    () => writeFileTransaction(workspace, "src/App.tsx", "stale", "0000000000000000000000000000000000000000000000000000000000000000"),
    (error) => error instanceof EditConflictError,
    "una edición con hash obsoleto debe bloquearse",
  );

  let turn = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          turn += 1;
          if (turn === 1) {
            return {
              choices: [{ message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "call_1", function: {
                  name: "edit_file",
                  arguments: JSON.stringify({
                    path: "src/App.tsx",
                    old_string: "Hello World",
                    new_string: "Hello from dscode v3",
                  }),
                } }],
              } }],
            };
          }
          return { choices: [{ message: { role: "assistant", content: "Cambio aplicado y verificado." } }] };
        },
      },
    },
    close: async () => undefined,
  };

  const agent = new Agent({ client, workspaceDir: workspace, systemPromptContext: "Proyecto de prueba", mode: "build" });
  const response = await agent.run("cambia el saludo de App.tsx");
  const final = await fs.readFile(path.join(workspace, "src", "App.tsx"), "utf8");
  assert.match(final, /Hello from dscode v3/);
  assert.match(response, /verificado/i);
  assert.ok(turn >= 2, "el agente debe pedir una segunda respuesta después de ejecutar la mutación");
  await agent.close();

  // Runtime-managed EditIntent: a file changed externally after read_file must not be overwritten.
  await fs.writeFile(path.join(workspace, "src", "Conflict.tsx"), "export const Conflict = 'A';\n", "utf8");
  let conflictTurn = 0;
  const conflictClient = {
    chat: {
      completions: {
        create: async () => {
          conflictTurn += 1;
          if (conflictTurn === 1) {
            return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "read_1", function: { name: "read_file", arguments: JSON.stringify({ path: "src/Conflict.tsx" }) } }] } }] };
          }
          await fs.writeFile(path.join(workspace, "src", "Conflict.tsx"), "export const Conflict = 'EXTERNAL';\n", "utf8");
          return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "edit_1", function: { name: "edit_file", arguments: JSON.stringify({ path: "src/Conflict.tsx", old_string: "export const Conflict = 'A';", new_string: "export const Conflict = 'B';" }) } }] } }] };
        },
      },
    },
    close: async () => undefined,
  };
  const conflictAgent = new Agent({ client: conflictClient, workspaceDir: workspace, systemPromptContext: "Proyecto de prueba", mode: "build" });
  const conflictResponse = await conflictAgent.run("cambia Conflict.tsx");
  const conflictContent = await fs.readFile(path.join(workspace, "src", "Conflict.tsx"), "utf8");
  assert.match(conflictContent, /EXTERNAL/);
  assert.match(conflictResponse, /EXPLORATION|EDIT_CONFLICT|repar/i);
  await conflictAgent.close();
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}

console.log("dscode reliability tests: OK");

// Reliability primitives: request hashes are stable and recovery classification is explicit.
const { classifyLLMError } = await import("../dist/domain/llm/llmError.js");
const { buildRecoveryPack } = await import("../dist/domain/recovery/recoveryManager.js");
const contextError = classifyLLMError(Object.assign(new Error("DeepSeek alcanzó el límite de contexto de este chat."), { code: "CONTEXT_EXHAUSTED" }));
assert.equal(contextError.code, "CONTEXT_EXHAUSTED");
assert.equal(contextError.requiresNewChat, true);
assert.equal(contextError.canReuseSameRequest, true);
const timeoutError = classifyLLMError(Object.assign(new Error("Timeout de 90000ms esperando respuesta"), { code: "RESPONSE_TIMEOUT" }));
assert.equal(timeoutError.code, "RESPONSE_TIMEOUT");
assert.equal(timeoutError.canReuseSameRequest, true);
assert.equal(timeoutError.requiresNewChat, false);
const pack = buildRecoveryPack({
  id: "task_test", objective: "test", phase: "edit", requiresEdit: true,
  targetFiles: ["src/App.tsx"], inspectedFiles: ["src/App.tsx"], readCounts: {},
  fileSnapshots: {}, modifiedFiles: ["src/App.tsx"], lastAction: "edit:edit_file",
  counters: { reads: 1, edits: 1, failures: 0, iterations: 2 }
}, workspace);
assert.match(pack, /DSCODE TASK RECOVERY PACK/);
assert.match(pack, /src\/App\.tsx/);


// DeepSeek DOM Inspector: verify the diagnostic collector works without a live browser.
const { DeepSeekDomInspector } = await import("../dist/infrastructure/deepseek/diagnostics/domInspector.js");
const fakePage = {
  evaluate: async (fn, arg) => {
    if (typeof fn === "function") {
      const source = String(fn);
      if (source.includes("target[key] = { state, observer }")) return undefined;
      if (source.includes("return holder?.state")) return { count: 0, lastAt: null, samples: [] };
      if (source.includes("disabled") && source.includes("getAttribute")) return false;
      return [];
    }
    return undefined;
  },
  waitForLoadState: async () => undefined,
  content: async () => "<html><body><textarea placeholder=\"Mensaje a DeepSeek\"></textarea></body></html>",
  locator: (selector) => {
    const make = (count, text = "", visible = true) => ({
      count: async () => count,
      first() { return make(count > 0 ? 1 : 0, text, visible); },
      nth() { return make(count > 0 ? 1 : 0, text, visible); },
      isVisible: async () => visible,
      innerText: async () => text,
      boundingBox: async () => visible ? { width: 100, height: 30 } : null,
      waitFor: async () => undefined,
      evaluate: async () => false,
      evaluateAll: async () => 0,
    });
    if (selector === "body") return make(1, "DeepSeek test");
    if (String(selector).includes('textarea[placeholder="Mensaje a DeepSeek"]') || String(selector).includes('textarea[name="search"]')) return make(1, "");
    if (String(selector).includes("ds-assistant-message-main-content")) return make(1, "OK");
    if (String(selector).includes("ds-collapsible-text")) return make(1, "Hola");
    if (String(selector).includes("svg path[d^=\"M8.3125\"]")) return make(1);
    if (String(selector).includes("svg path[d^=\"M2 4.88\"]")) return make(0);
    if (String(selector).includes("cf-overlay") || String(selector).includes("challenges.cloudflare.com") || String(selector).includes("turnstile")) return make(0);
    if (String(selector).includes("[role=\"alert\"]") || String(selector).includes("notification") || String(selector).includes("toast")) return make(0);
    if (String(selector).includes("button") || String(selector).includes("[role=button]")) return make(2);
    if (String(selector) === "textarea") return make(1);
    if (String(selector) === "a") return make(0);
    if (String(selector).startsWith("text=")) return make(1, "Nuevo chat");
    return make(0);
  },
  title: async () => "DeepSeek",
  url: () => "https://chat.deepseek.com/a/chat/s/11111111-2222-3333-4444-555555555555",
  screenshot: async ({ path }) => { await fs.writeFile(path, "fake-png"); },
};
const { SELECTORS } = await import("../dist/infrastructure/browser/selectors.js");
const observedFixture = await fs.readFile(new URL("./fixtures/deepseek/observed-structure.html", import.meta.url), "utf8");
assert.match(observedFixture, /ds-assistant-message-main-content/);
assert.match(observedFixture, /ds-collapsible-text/);
assert.match(observedFixture, /placeholder="Mensaje a DeepSeek"/);

assert.match(SELECTORS.composer, /placeholder=\"Mensaje a DeepSeek\"/);
assert.match(SELECTORS.assistantMessage, /ds-assistant-message-main-content/);
assert.match(SELECTORS.userMessage, /ds-collapsible-text/);
assert.match(SELECTORS.stopGeneratingButton, /M2 4\.88/);
assert.match(SELECTORS.sendButton, /M8\.3125/);

const inspector = new DeepSeekDomInspector({ page: fakePage, config: { chatUrl: "https://chat.deepseek.com/" } }, { outputDir: await fs.mkdtemp(path.join(os.tmpdir(), "dscode-dom-")), screenshots: true });
await inspector.prepare();
const capture = await inspector.capture("test");
assert.match(capture.captureId, /test$/);
assert.equal(capture.state.composerCount, 1);
console.log("DeepSeek DOM inspector tests: OK");
