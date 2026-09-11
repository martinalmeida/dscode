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

console.log("dscode v3.1 tests: OK");
