/* eslint-disable no-console */
import { DirectExecutor, KeeperHubClient, isReadResult } from "../src/index.js";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

const client = new KeeperHubClient({ apiKey });
const direct = new DirectExecutor(client);

// USDC on Ethereum mainnet — universally available, safe to read.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// vitalik.eth — public, well-known address.
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

console.log("→ DirectExecutor.callContract (read: USDC.balanceOf(vitalik))");
const res = await direct.callContract({
  contractAddress: USDC,
  network: "ethereum",
  functionName: "balanceOf",
  functionArgs: JSON.stringify([VITALIK]),
});

if (isReadResult(res)) {
  console.log(`  ✓ balanceOf returned: ${res.result}`);
} else {
  console.log(`  ! unexpected write result: ${JSON.stringify(res)}`);
}

console.log("\n✅ direct-executor smoke passed");
