/* eslint-disable no-console */
import { createKeepergatePlugin } from "../src/index.js";
import type { Action, IAgentRuntime, Memory } from "@elizaos/core";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

console.log("→ createKeepergatePlugin({ apiKey })");
const plugin = createKeepergatePlugin({ apiKey });

console.log(`  ✓ name:        ${plugin.name}`);
console.log(`  ✓ description: ${plugin.description}`);
console.log(`  ✓ actions:     ${plugin.actions?.length ?? 0}`);

if (!plugin.actions || plugin.actions.length === 0) {
  throw new Error("plugin exposes no actions");
}

const expected = [
  "KEEPERGATE_TRANSFER",
  "KEEPERGATE_CALL_CONTRACT",
  "KEEPERGATE_CHECK_AND_EXECUTE",
  "KEEPERGATE_GET_EXECUTION_STATUS",
  "KEEPERGATE_LIST_WORKFLOWS",
  "KEEPERGATE_RUN_WORKFLOW",
];
const actual = plugin.actions.map((a) => a.name);
for (const name of expected) {
  if (!actual.includes(name)) {
    throw new Error(`missing action: ${name}`);
  }
}
console.log(`  ✓ all six expected actions present`);

console.log("\n→ Action shape sanity");
for (const action of plugin.actions as Action[]) {
  if (typeof action.name !== "string")
    throw new Error(`${action.name}: name must be string`);
  if (typeof action.description !== "string")
    throw new Error(`${action.name}: description must be string`);
  if (typeof action.handler !== "function")
    throw new Error(`${action.name}: handler must be function`);
  if (typeof action.validate !== "function")
    throw new Error(`${action.name}: validate must be function`);
  console.log(
    `  ✓ ${action.name.padEnd(36)} similes:${(action.similes?.length ?? 0)
      .toString()
      .padStart(2)} examples:${(action.examples?.length ?? 0)
      .toString()
      .padStart(2)}`
  );
}

// Validate() should run without throwing -- doesn't need a real runtime,
// just a stub that supplies what validate() touches.
console.log("\n→ Action.validate() smoke (no runtime calls expected)");
const stubRuntime = {} as IAgentRuntime;
for (const action of plugin.actions as Action[]) {
  const positiveMessages: Record<string, Memory> = {
    KEEPERGATE_TRANSFER: msg("send 0.1 ETH to 0xabc on base"),
    KEEPERGATE_CALL_CONTRACT: msg("read balanceOf for 0xd8d on ethereum"),
    KEEPERGATE_CHECK_AND_EXECUTE: msg("if eth drops below 3000, sell"),
    KEEPERGATE_GET_EXECUTION_STATUS: msg("did tx direct_abc land?"),
    KEEPERGATE_LIST_WORKFLOWS: msg("show my workflows"),
    KEEPERGATE_RUN_WORKFLOW: msg("run workflow wf_abc"),
  };
  const m = positiveMessages[action.name] ?? msg("hello");
  const ok = await action.validate(stubRuntime, m);
  if (!ok) {
    throw new Error(
      `${action.name}.validate returned false on a positive-intent message`
    );
  }
  console.log(`  ✓ ${action.name} validate(positive) -> true`);
}

console.log("\n✅ elizaos adapter smoke passed");

function msg(text: string): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    entityId: "00000000-0000-0000-0000-000000000000",
    agentId: "00000000-0000-0000-0000-000000000000",
    roomId: "00000000-0000-0000-0000-000000000000",
    content: { text, source: "smoke" },
    createdAt: Date.now(),
  } as unknown as Memory;
}
