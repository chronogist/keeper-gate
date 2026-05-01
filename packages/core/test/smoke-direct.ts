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

// 2b. Cross-chain reads via auto-ABI.
// KeeperHub's auto-ABI is supported on a subset of chains (currently:
// ethereum, sepolia, base, base-sepolia, tempo, solana family). For these
// the call needs no ABI override at all.
console.log("\n→ DirectExecutor.callContract: cross-chain reads (auto-ABI)");
const autoAbiChains: Array<{ network: string; usdc: string; label: string }> = [
  // Base — native USDC
  {
    network: "base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    label: "Base",
  },
];
for (const c of autoAbiChains) {
  const out = await direct.callContract({
    network: c.network,
    contractAddress: c.usdc,
    functionName: "balanceOf",
    functionArgs: JSON.stringify([VITALIK]),
  });
  if (!isReadResult(out))
    throw new Error(`${c.label}: expected read result`);
  if (typeof out.result !== "string")
    throw new Error(`${c.label}: result must be a string`);
  console.log(`  ✓ ${c.label.padEnd(10)} (auto-ABI)   -> ${out.result}`);
}

// 2c. Cross-chain reads via manual ABI override.
// On chains KeeperHub doesn't auto-fetch ABIs for (e.g. Arbitrum), the SDK
// still works as long as the caller supplies the ABI string. Proves the
// manual-ABI escape hatch and the 'any chain' claim more honestly.
console.log("\n→ DirectExecutor.callContract: chains via manual ABI");
// NB: KeeperHub's ABI-based read/write detection requires the modern
// `stateMutability` field; the legacy `constant: true` alone is treated
// as a write call and prompts for a wallet (logged in builder-feedback.md).
const erc20BalanceOfAbi = JSON.stringify([
  {
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
]);
// Chains KeeperHub recognizes only by numeric chain id (see error message
// from /api/execute/contract-call: 'Unsupported network: arbitrum.
// Supported: mainnet, ..., or numeric chain IDs').
const manualAbiChains: Array<{ network: string; usdc: string; label: string }> = [
  // Arbitrum One — chain id 42161, native USDC
  {
    network: "42161",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    label: "Arbitrum",
  },
];
for (const c of manualAbiChains) {
  const out = await direct.callContract({
    network: c.network,
    contractAddress: c.usdc,
    functionName: "balanceOf",
    functionArgs: JSON.stringify([VITALIK]),
    abi: erc20BalanceOfAbi,
  });
  if (!isReadResult(out))
    throw new Error(`${c.label}: expected read result, got ${JSON.stringify(out)}`);
  // KeeperHub returns either a bare uint256 string or, for richer functions,
  // an object whose first value is the decoded balance. Normalize both.
  const printable =
    typeof out.result === "string"
      ? out.result
      : JSON.stringify(out.result);
  console.log(`  ✓ ${c.label.padEnd(10)} (manual ABI) -> ${printable}`);
}

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
