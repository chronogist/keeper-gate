/* eslint-disable no-console */
import {
  DirectExecutor,
  KeeperHubClient,
  KeeperHubError,
  isReadResult,
} from "../src/index.js";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

const client = new KeeperHubClient({ apiKey });
const direct = new DirectExecutor(client);

// USDC on Ethereum mainnet — universally available, safe to read.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// vitalik.eth — public, well-known address.
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ZERO = "0x0000000000000000000000000000000000000000";

// 1. Read path
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
  throw new Error(`unexpected write result: ${JSON.stringify(res)}`);
}

// 2. Conditional execution path (read + condition, no write fires)
console.log(
  "\n→ DirectExecutor.checkAndExecute (USDC.balanceOf(0x0) > 1, condition false)"
);
const cond = await direct.checkAndExecute({
  contractAddress: USDC,
  network: "ethereum",
  functionName: "balanceOf",
  functionArgs: JSON.stringify([ZERO]),
  condition: { operator: "gt", value: "1" },
  action: {
    network: "ethereum",
    contractAddress: USDC,
    functionName: "transfer",
    functionArgs: JSON.stringify([ZERO, "0"]),
  },
});
if (cond.executed !== false) {
  throw new Error(
    `expected executed=false on guaranteed-false condition, got ${JSON.stringify(cond)}`
  );
}
console.log(`  ✓ executed: ${cond.executed} (no write attempted)`);

// 3. Status lookup with a fabricated id -> 404 surfaced as KeeperHubError
console.log(
  "\n→ DirectExecutor.getStatus (fake id, expects 404 → KeeperHubError)"
);
try {
  await direct.getStatus("direct_does_not_exist_zzz");
  throw new Error("expected getStatus to throw on a fake id");
} catch (err) {
  if (err instanceof KeeperHubError) {
    console.log(
      `  ✓ KeeperHubError surfaced (status ${err.status}): ${err.message.slice(0, 80)}`
    );
  } else {
    throw err;
  }
}

console.log("\n✅ direct-executor smoke passed");
