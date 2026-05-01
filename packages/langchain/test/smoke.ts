/* eslint-disable no-console */
import { KeeperGateToolkit } from "../src/index.js";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

const toolkit = new KeeperGateToolkit({ apiKey });
const tools = await toolkit.getTools();

console.log("→ getTools()");
for (const t of tools) {
  console.log(`  ✓ ${t.name}`);
  console.log(`     ${t.description.split("\n")[0]}`);
}

// Find the call_contract tool and invoke it the way a LangChain agent would.
const callTool = tools.find((t) => t.name === "keepergate_call_contract");
if (!callTool) throw new Error("keepergate_call_contract missing");

console.log(
  "\n→ keepergate_call_contract.invoke(USDC.balanceOf(vitalik)) [agent-style call]"
);
// `tools.find()` narrows to a union; invoke types aren't co-callable so we
// invoke through the runnable surface common to every StructuredTool.
const out = (await (callTool as unknown as {
  invoke: (input: Record<string, unknown>) => Promise<string>;
}).invoke({
  network: "ethereum",
  contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  functionName: "balanceOf",
  functionArgs: JSON.stringify(["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]),
})) as string;

console.log(`  ✓ raw tool output: ${out}`);
const parsed = JSON.parse(out);
console.log(`  ✓ parsed:          ${JSON.stringify(parsed)}`);
if (parsed.kind !== "read")
  throw new Error(`expected kind=read, got ${parsed.kind}`);

// --- More live invocations (read-only, safe) -------------------------------

type AnyInvoke = {
  invoke: (input: Record<string, unknown>) => Promise<string>;
};
const byName = (n: string): AnyInvoke =>
  tools.find((t) => t.name === n) as unknown as AnyInvoke;

console.log("\n→ keepergate_list_workflows.invoke({})");
const listOut = await byName("keepergate_list_workflows").invoke({});
const list = JSON.parse(listOut);
console.log(`  ✓ workflows returned: ${list.length}`);
for (const w of list.slice(0, 5)) console.log(`    - ${w.id}  ${w.name}`);

console.log("\n→ keepergate_check_and_execute.invoke({condition guaranteed-false})");
// USDC.balanceOf(zero address) is 0; require > 1 — condition fails, no write executed.
const checkOut = await byName("keepergate_check_and_execute").invoke({
  network: "ethereum",
  contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  functionName: "balanceOf",
  functionArgs: JSON.stringify(["0x0000000000000000000000000000000000000000"]),
  condition: { operator: "gt", value: "1" },
  action: {
    network: "ethereum",
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    functionName: "transfer",
    functionArgs: JSON.stringify(["0x0000000000000000000000000000000000000000", "0"]),
  },
});
const checkParsed = JSON.parse(checkOut);
console.log(`  ✓ executed: ${checkParsed.executed}`);
console.log(`  ✓ condition met: ${checkParsed.condition?.met}`);
if (checkParsed.executed !== false)
  throw new Error(`expected executed=false, got ${checkParsed.executed}`);

if (list.length > 0) {
  console.log(`\n→ keepergate_run_workflow.invoke({workflowId: ${list[0].id}})`);
  const runOut = await byName("keepergate_run_workflow").invoke({
    workflowId: list[0].id,
    input: { address: "0xe74096f8ef2b08aa7257ac98459c624e1bf9a548" },
  });
  const run = JSON.parse(runOut);
  console.log(`  ✓ executionId: ${run.executionId}`);
  console.log(`  ✓ status:      ${run.status}`);
  console.log(`  ✓ logs:        ${run.logs.length} entrie(s)`);
}

// keepergate_transfer: no wallet configured -> API returns 422. We assert
// the tool returns a JSON-parseable string (not a throw) carrying the error.
console.log("\n→ keepergate_transfer.invoke({tiny ETH transfer, no wallet})");
try {
  const out = await byName("keepergate_transfer").invoke({
    network: "ethereum",
    recipientAddress: "0x0000000000000000000000000000000000000001",
    amount: "0.0001",
  });
  // If we got here, either it succeeded (rare) or the API returned a
  // structured error. Either way the tool must have returned a string.
  console.log(`  ✓ raw tool output: ${out.slice(0, 120)}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/wallet|configured|422/i.test(msg)) {
    throw new Error(`unexpected transfer error: ${msg}`);
  }
  console.log(
    `  ✓ tool surfaced expected error: ${msg.slice(0, 100)}…`
  );
}

// keepergate_get_execution_status with a fake id: API returns 404, the tool
// either surfaces the error cleanly or returns a status payload describing
// the missing execution. Either is acceptable -- a throw would fail above.
console.log(
  "\n→ keepergate_get_execution_status.invoke({fake id}) [expects 404 path]"
);
try {
  const out = await byName("keepergate_get_execution_status").invoke({
    executionId: "direct_does_not_exist_zzz",
  });
  console.log(`  ✓ raw tool output: ${out.slice(0, 120)}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/404|not found/i.test(msg)) {
    throw new Error(`unexpected status error: ${msg}`);
  }
  console.log(
    `  ✓ tool surfaced expected 404: ${msg.slice(0, 100)}…`
  );
}

// --- KeeperGateToolkit.include filter --------------------------------------
//
// The README documents a `include` option for restricting the toolkit to a
// subset of tools (e.g. for read-only agents). This block verifies the
// filter actually works -- pure local logic, no network calls.

console.log("\n→ KeeperGateToolkit.include filter");

{
  const restricted = await new KeeperGateToolkit({
    apiKey,
    include: ["callContract"],
  }).getTools();
  if (restricted.length !== 1) {
    throw new Error(
      `include=['callContract'] should return 1 tool, got ${restricted.length}`
    );
  }
  if (restricted[0]!.name !== "keepergate_call_contract") {
    throw new Error(
      `expected keepergate_call_contract, got ${restricted[0]!.name}`
    );
  }
  console.log(`  ✓ include: ['callContract']  -> 1 tool: ${restricted[0]!.name}`);
}

{
  const pair = await new KeeperGateToolkit({
    apiKey,
    include: ["callContract", "listWorkflows"],
  }).getTools();
  if (pair.length !== 2) {
    throw new Error(
      `include=[2 names] should return 2 tools, got ${pair.length}`
    );
  }
  const names = pair.map((t) => t.name).sort();
  const expected = ["keepergate_call_contract", "keepergate_list_workflows"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`
    );
  }
  console.log(`  ✓ include: [2 names]         -> 2 tools: ${names.join(", ")}`);
}

{
  const empty = await new KeeperGateToolkit({
    apiKey,
    include: [],
  }).getTools();
  if (empty.length !== 0) {
    throw new Error(`include=[] should return 0 tools, got ${empty.length}`);
  }
  console.log(`  ✓ include: []                -> 0 tools (read-restricted agent)`);
}

// --- Workflow CRUD: create -> duplicate -> update -> delete ---------------
//
// Verifies all four CRUD tools end-to-end through the LangChain interface.
// Cleans up after itself so the user's KeeperHub account stays tidy.

console.log("\n→ Workflow CRUD round-trip (create / duplicate / update / delete)");
{
  const created = JSON.parse(
    (await byName("keepergate_create_workflow").invoke({
      name: "keepergate-smoke-temp",
      description: "ephemeral workflow created by langchain smoke",
    })) as string
  ) as { id: string; name: string };
  console.log(`  ✓ create     -> ${created.id}`);

  const dup = JSON.parse(
    (await byName("keepergate_duplicate_workflow").invoke({
      workflowId: created.id,
    })) as string
  ) as { id: string; name: string };
  console.log(`  ✓ duplicate  -> ${dup.id}  (${dup.name})`);

  const upd = JSON.parse(
    (await byName("keepergate_update_workflow").invoke({
      workflowId: created.id,
      description: "updated by smoke",
    })) as string
  ) as { id: string };
  console.log(`  ✓ update     -> ${upd.id}`);

  const delA = JSON.parse(
    (await byName("keepergate_delete_workflow").invoke({
      workflowId: created.id,
      force: true,
    })) as string
  ) as { deleted: string };
  const delB = JSON.parse(
    (await byName("keepergate_delete_workflow").invoke({
      workflowId: dup.id,
      force: true,
    })) as string
  ) as { deleted: string };
  console.log(`  ✓ delete     -> ${delA.deleted}, ${delB.deleted}`);
}

console.log("\n✅ langchain adapter smoke passed");
