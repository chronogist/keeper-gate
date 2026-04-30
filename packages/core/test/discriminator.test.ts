/* eslint-disable no-console */
//
// Pure-logic test for the isReadResult discriminator. The whole point of the
// type guard is letting callers tell apart a synchronous read return shape
// from an async write return shape -- agents lean on this to decide whether
// to surface a value or an executionId. Trivial logic, but the contract is
// load-bearing for both adapters.
//

import { isReadResult } from "../src/index.js";
import type {
  DirectReadResult,
  DirectWriteResult,
} from "../src/index.js";

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

console.log("→ isReadResult");

const read: DirectReadResult = { result: "1500000000000000000" };
const write: DirectWriteResult = {
  executionId: "direct_abc",
  status: "completed",
};

assert("read shape -> true", isReadResult(read) === true);
assert("write shape -> false", isReadResult(write) === false);

// Bonus edge cases: ensure the discriminator is keyed strictly on the
// presence of `result`, not on absence of other fields.
assert(
  "shape with both result and executionId -> true (result wins)",
  isReadResult({
    result: "123",
    // an unusual shape we don't expect from the API but might encounter
    executionId: "x",
  } as unknown as DirectReadResult)
);
assert(
  "empty object -> false",
  isReadResult({} as unknown as DirectWriteResult) === false
);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\n❌ discriminator tests failed");
  process.exit(1);
}
console.log("\n✅ discriminator tests passed");
