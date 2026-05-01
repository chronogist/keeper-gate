/* eslint-disable no-console */
import { KeeperHubClient } from "../src/index.js";

const client = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });

const wfs = await client.listWorkflows();
const wfId = wfs[0]!.id;

const { executionId } = await client.executeWorkflow(wfId, {
  address: "0xe74096f8ef2b08aa7257ac98459c624e1bf9a548",
});
console.log("executionId:", executionId);

await new Promise((r) => setTimeout(r, 3000));

console.log("\n--- status ---");
console.log(JSON.stringify(await client.getExecutionStatus(executionId), null, 2));

console.log("\n--- logs (raw) ---");
const logsRes = await fetch(
  `https://app.keeperhub.com/api/workflows/executions/${executionId}/logs`,
  { headers: { Authorization: `Bearer ${process.env.KEEPERHUB_API_KEY}` } }
);
console.log("status:", logsRes.status);
console.log(await logsRes.text());
