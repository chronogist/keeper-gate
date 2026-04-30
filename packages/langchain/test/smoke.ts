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

console.log("\n✅ langchain adapter smoke passed");
