/* eslint-disable no-console */
//
// Unit test for pollUntilDone's timeout path. Uses an injected fetch that
// always returns status: "running" so the executor never reaches a terminal
// state -- the only way out is the timeout, and we want to verify it fires
// cleanly with a useful error message.
//

import { KeeperHubClient } from "../src/index.js";

let pass = 0;
let fail = 0;
function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    fail++;
  }
}

console.log("→ KeeperHubClient.pollUntilDone (timeout path)");

let pollCount = 0;
const stubFetch = (async (
  _url: string | URL,
  _init?: RequestInit
): Promise<Response> => {
  pollCount++;
  // Always say the execution is still running. pollUntilDone should keep
  // polling until its own timeout fires -- never returning a terminal status.
  return new Response(
    JSON.stringify({
      status: "running",
      nodeStatuses: [],
      progress: { totalSteps: 0, completedSteps: 0, runningSteps: 0, percentage: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}) as unknown as typeof fetch;

const client = new KeeperHubClient({
  apiKey: "kh_fake",
  baseUrl: "https://stub.local/api",
  fetch: stubFetch,
});

const start = Date.now();
let thrown: unknown;
try {
  await client.pollUntilDone("exec_stub", { intervalMs: 50, timeoutMs: 200 });
} catch (err) {
  thrown = err;
}
const elapsed = Date.now() - start;

assert("threw an error", thrown !== undefined);
assert(
  "error mentions the executionId and timeout",
  thrown instanceof Error &&
    /exec_stub/.test(thrown.message) &&
    /200ms|200 ms|timeout/i.test(thrown.message)
);
assert(
  "polled at least 2 times before timing out (intervalMs=50, timeoutMs=200)",
  pollCount >= 2
);
assert(
  "didn't poll forever -- elapsed < timeout + 1s grace",
  elapsed < 1200
);
console.log(
  `  · polled ${pollCount} time(s), elapsed ${elapsed}ms, error: "${
    (thrown as Error)?.message?.slice(0, 80) ?? "<none>"
  }"`
);

// Sanity: a generous timeout against a stub that returns terminal on first
// call should resolve with that status, not throw.
console.log(
  "\n→ KeeperHubClient.pollUntilDone (terminal on first poll)"
);
let happyCalls = 0;
const happyFetch = (async (
  url: string | URL,
  _init?: RequestInit
): Promise<Response> => {
  happyCalls++;
  const path = String(url);
  // status endpoint -> success
  if (/\/status$/.test(path)) {
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  // logs endpoint -> empty array
  return new Response(JSON.stringify({ logs: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

const happyClient = new KeeperHubClient({
  apiKey: "kh_fake",
  baseUrl: "https://stub.local/api",
  fetch: happyFetch,
});

const result = await happyClient.pollUntilDone("exec_happy", {
  intervalMs: 50,
  timeoutMs: 5_000,
});
assert(
  "terminal status returned without timing out",
  result.status === "success" && result.executionId === "exec_happy"
);
assert("logs array is present", Array.isArray(result.logs));
console.log(
  `  · ${happyCalls} fetch call(s), final status: ${result.status}`
);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\n❌ poll-timeout tests failed");
  process.exit(1);
}
console.log("\n✅ poll-timeout tests passed");
