/* eslint-disable no-console */
import { KeeperHubClient, KeeperHubError, WorkflowTool } from "../src/index.js";

async function main() {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error("Set KEEPERHUB_API_KEY in .env");
  }

  const client = new KeeperHubClient({
    apiKey,
    baseUrl: process.env.KEEPERHUB_BASE_URL,
  });

  console.log("→ listWorkflows()");
  const workflows = await client.listWorkflows();
  console.log(`  ✓ ${workflows.length} workflow(s):`);
  for (const w of workflows.slice(0, 10)) {
    console.log(`    - ${w.id}  ${w.name}`);
  }

  if (workflows.length === 0) {
    console.log(
      "\nNo workflows yet. Build one in the UI (Manual trigger → Web3 Check Balance referencing {{@trigger.address}}) and re-run."
    );
    return;
  }

  const targetId = process.env.KEEPERHUB_WORKFLOW_ID || workflows[0]!.id;
  console.log(`\n→ getWorkflow(${targetId})`);
  const tool = await WorkflowTool.fromWorkflowId(client, targetId);
  console.log(`  ✓ tool name:        ${tool.info.name}`);
  console.log(`  ✓ description:      ${tool.info.description}`);
  console.log(
    `  ✓ inferred inputs:  ${
      tool.info.inputFields.length ? tool.info.inputFields.join(", ") : "(none)"
    }`
  );

  const rawInput = process.env.KEEPERHUB_SMOKE_INPUT || "{}";
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(rawInput);
  } catch {
    throw new Error(
      `KEEPERHUB_SMOKE_INPUT must be valid JSON, got: ${rawInput}`
    );
  }

  console.log(`\n→ executeWorkflow(${targetId}, ${JSON.stringify(input)})`);
  const result = await tool.call(input);
  console.log(`  ✓ executionId: ${result.executionId}`);
  console.log(`  ✓ status:      ${result.status}`);
  console.log(`  ✓ ${result.logs.length} log entrie(s):`);
  for (const log of result.logs) {
    console.log(
      `    - [${log.status}] ${log.nodeName ?? log.nodeId} (${log.duration ?? "?"}ms)`
    );
  }
  // --- rawRequest error path ----------------------------------------------
  //
  // The KeeperHubClient.rawRequest escape hatch is what DirectExecutor (and
  // any future helpers) use to hit endpoints not yet wrapped. If the API
  // returns an error, the wrapper must throw a typed KeeperHubError with
  // the right .status -- callers downstream rely on instanceof checks.

  console.log("\n→ KeeperHubClient.rawRequest (non-existent endpoint -> typed error)");
  try {
    await client.rawRequest(
      "/this-endpoint-definitely-does-not-exist-zzz"
    );
    throw new Error("expected rawRequest to throw on a 404 endpoint");
  } catch (err) {
    if (err instanceof KeeperHubError) {
      if (![404, 405].includes(err.status)) {
        throw new Error(
          `expected 404/405, got status=${err.status}: ${err.message}`
        );
      }
      console.log(
        `  ✓ KeeperHubError surfaced (status ${err.status}): ${err.message.slice(0, 80)}`
      );
    } else {
      throw err;
    }
  }

  console.log("\n✅ smoke test passed");
}

main().catch((err) => {
  console.error("\n❌ smoke test failed:", err);
  process.exit(1);
});
