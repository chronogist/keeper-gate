/* eslint-disable no-console */
import {
  buildKeepergateTools,
  keepergatePluginEntry,
} from "../src/index.js";
import { KeeperHubClient } from "@keepergate/core";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

console.log("→ keepergatePluginEntry shape");
console.log(`  ✓ id:          ${keepergatePluginEntry.id}`);
console.log(`  ✓ name:        ${keepergatePluginEntry.name}`);
console.log(
  `  ✓ description: ${keepergatePluginEntry.description.slice(0, 80)}…`
);
if (keepergatePluginEntry.id !== "keepergate")
  throw new Error("expected id 'keepergate'");
if (typeof keepergatePluginEntry.register !== "function")
  throw new Error("register must be a function");

// --- register() registers a tool factory -----------------------------------
//
// Stub the OpenClawPluginApi shape that .register receives. We only need
// registerTool here; everything else can throw if it gets called.

console.log("\n→ keepergatePluginEntry.register(api) -> registerTool factory");

const captured: Array<{
  factory: OpenClawPluginToolFactory;
  opts: unknown;
}> = [];
const stubApi: Pick<OpenClawPluginApi, "registerTool"> = {
  registerTool: (toolOrFactory, opts) => {
    if (typeof toolOrFactory === "function") {
      captured.push({ factory: toolOrFactory, opts });
    } else {
      throw new Error(
        "this plugin should register via a factory, not a static AnyAgentTool"
      );
    }
  },
};
keepergatePluginEntry.register(stubApi as OpenClawPluginApi);
if (captured.length !== 1)
  throw new Error(`expected 1 registerTool call, got ${captured.length}`);
console.log(`  ✓ registered 1 tool factory`);

// --- factory(ctx) -> 6 AnyAgentTool[] --------------------------------------
//
// Build a minimal OpenClawPluginToolContext with our API key in the
// canonical OpenClaw plugin-config location.

console.log("\n→ Tool factory yields all 10 AnyAgentTool entries");

const ctx = {
  runtimeConfig: {
    plugins: { entries: { keepergate: { apiKey } } },
  },
} as unknown as OpenClawPluginToolContext;

const produced = captured[0]!.factory(ctx);
const tools: AnyAgentTool[] = Array.isArray(produced)
  ? produced
  : produced
    ? [produced]
    : [];
if (tools.length !== 10)
  throw new Error(`expected 10 tools, got ${tools.length}`);

const expected = [
  "keepergate_transfer",
  "keepergate_call_contract",
  "keepergate_check_and_execute",
  "keepergate_get_execution_status",
  "keepergate_list_workflows",
  "keepergate_run_workflow",
  "keepergate_create_workflow",
  "keepergate_update_workflow",
  "keepergate_delete_workflow",
  "keepergate_duplicate_workflow",
];
for (const name of expected) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool: ${name}`);
  if (typeof t.execute !== "function")
    throw new Error(`${name}: execute must be a function`);
  if (!t.parameters || typeof t.parameters !== "object")
    throw new Error(`${name}: parameters must be a TypeBox schema object`);
  console.log(`  ✓ ${name.padEnd(36)} label="${t.label ?? ""}"`);
}

// --- live tool invocation: list_workflows ---------------------------------
//
// Calls KeeperHub. No LLM needed; doesn't take inputs.

console.log("\n→ keepergate_list_workflows.execute() against live KeeperHub");
const listTool = tools.find((t) => t.name === "keepergate_list_workflows")!;
const listResult = await listTool.execute(
  "tc_list",
  {},
  new AbortController().signal
);
if (!listResult.content?.length)
  throw new Error("list_workflows result must include content");
const listText = (listResult.content[0] as { text?: string }).text ?? "";
const parsed = JSON.parse(listText) as Array<{ id: string; name: string }>;
console.log(`  ✓ workflows returned: ${parsed.length}`);
for (const w of parsed.slice(0, 3))
  console.log(`    - ${w.id}  ${w.name}`);

// --- live tool invocation: call_contract (read) ---------------------------
//
// Reads vitalik's USDC balance on Ethereum mainnet. No wallet needed.

console.log("\n→ keepergate_call_contract.execute() (read: USDC.balanceOf)");
const callTool = tools.find((t) => t.name === "keepergate_call_contract")!;
const callResult = await callTool.execute(
  "tc_call",
  {
    network: "ethereum",
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    functionName: "balanceOf",
    functionArgs: JSON.stringify([
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    ]),
  },
  new AbortController().signal
);
const callText = (callResult.content[0] as { text?: string }).text ?? "";
const callParsed = JSON.parse(callText) as Record<string, unknown>;
console.log(`  ✓ kind: ${callParsed.kind}, result: ${JSON.stringify(callParsed.result)}`);
if (callParsed.kind !== "read")
  throw new Error(`expected kind=read, got ${callParsed.kind}`);

// --- Workflow CRUD round-trip via tool execute() -------------------------

console.log("\n→ Workflow CRUD round-trip (create / duplicate / update / delete)");
{
  const sig = new AbortController().signal;
  const find = (n: string) => tools.find((t) => t.name === n)!;
  const text = (r: { content: unknown[] }): string =>
    (r.content?.[0] as { text?: string } | undefined)?.text ?? "{}";
  const json = (s: string) => JSON.parse(s);

  const c = json(
    text(
      await find("keepergate_create_workflow").execute(
        "tc_create",
        { name: "openclaw-smoke-temp", description: "ephemeral" },
        sig
      )
    )
  );
  console.log(`  ✓ create     -> ${c.id}`);

  const d = json(
    text(
      await find("keepergate_duplicate_workflow").execute(
        "tc_dup",
        { workflowId: c.id },
        sig
      )
    )
  );
  console.log(`  ✓ duplicate  -> ${d.id}  (${d.name})`);

  const u = json(
    text(
      await find("keepergate_update_workflow").execute(
        "tc_upd",
        { workflowId: c.id, description: "updated by openclaw smoke" },
        sig
      )
    )
  );
  console.log(`  ✓ update     -> ${u.id}`);

  for (const id of [c.id, d.id]) {
    text(
      await find("keepergate_delete_workflow").execute(
        "tc_del",
        { workflowId: id, force: true },
        sig
      )
    );
  }
  console.log(`  ✓ delete     -> ${c.id}, ${d.id}`);
}

// --- buildKeepergateTools convenience export -----------------------------

console.log("\n→ buildKeepergateTools(client) convenience export");
const direct = buildKeepergateTools(new KeeperHubClient({ apiKey }));
if (direct.length !== 10)
  throw new Error(`buildKeepergateTools must return 10 tools, got ${direct.length}`);
console.log(`  ✓ returns ${direct.length} tools`);

console.log("\n✅ openclaw adapter smoke passed");
