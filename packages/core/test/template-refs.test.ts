/* eslint-disable no-console */
//
// Pure-logic tests for extractTriggerInputFields. No network. These cover the
// edge cases the regex must handle correctly, since this function is what
// produces the input schema every adapter exposes to its agent framework.
//

import { extractTriggerInputFields } from "../src/template-refs.js";
import type { WorkflowNode } from "../src/types.js";

const TRIGGER_ID = "trigger_123";

function node(id: string, config: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type: id === TRIGGER_ID ? "trigger" : "action",
    data: { config },
  };
}

let pass = 0;
let fail = 0;
function assert(label: string, actual: string[], expected: string[]): void {
  const ok =
    actual.length === expected.length &&
    actual.every((v, i) => v === expected[i]);
  if (ok) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(
      `  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(actual)}`
    );
    fail++;
  }
}

console.log("→ extractTriggerInputFields");

// 1. Empty workflow
assert(
  "no nodes -> empty",
  extractTriggerInputFields([], TRIGGER_ID),
  []
);

// 2. Single explicit reference using the real trigger id
assert(
  "{{@<triggerId>.address}} -> ['address']",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", { address: `{{@${TRIGGER_ID}.address}}` }),
    ],
    TRIGGER_ID
  ),
  ["address"]
);

// 3. The {{@trigger.X}} UI alias must also be recognized
assert(
  "{{@trigger.address}} alias -> ['address']",
  extractTriggerInputFields(
    [node(TRIGGER_ID, {}), node("a1", { address: "{{@trigger.address}}" })],
    TRIGGER_ID
  ),
  ["address"]
);

// 4. The data-prefix unwrap: {{@trigger.data.address}} -> 'address'
assert(
  "{{@trigger.data.address}} -> ['address']",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", { address: "{{@trigger.data.address}}" }),
    ],
    TRIGGER_ID
  ),
  ["address"]
);

// 5. Multiple distinct fields from multiple actions, sorted, deduped
assert(
  "multiple distinct fields, sorted, deduped",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", {
        recipient: "{{@trigger.recipient}}",
        amount: "{{@trigger.amount}}",
      }),
      node("a2", { recipient: "{{@trigger.recipient}}" }), // dup
      node("a3", { token: "{{@trigger.data.token}}" }),
    ],
    TRIGGER_ID
  ),
  ["amount", "recipient", "token"]
);

// 6. Refs to non-trigger nodes must be ignored
assert(
  "refs to other action nodes are ignored",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", {
        x: "{{@a2.something}}", // refers to a2, not the trigger
        y: "{{@trigger.fromTrigger}}",
      }),
      node("a2", {}),
    ],
    TRIGGER_ID
  ),
  ["fromTrigger"]
);

// 7. Nested objects/arrays in config must be walked
assert(
  "deeply nested values are walked",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", {
        outer: { inner: { addr: "{{@trigger.address}}" } },
        list: ["{{@trigger.amount}}"],
      }),
    ],
    TRIGGER_ID
  ),
  ["address", "amount"]
);

// 8. The trigger node's own config is skipped (don't recurse into yourself)
assert(
  "trigger node's own config is not scanned",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, { sneaky: "{{@trigger.shouldNotAppear}}" }),
      node("a1", { real: "{{@trigger.actual}}" }),
    ],
    TRIGGER_ID
  ),
  ["actual"]
);

// 9. Whitespace around the template body is tolerated
assert(
  "whitespace tolerated: {{ @trigger.address }}",
  extractTriggerInputFields(
    [node(TRIGGER_ID, {}), node("a1", { x: "{{ @trigger.address }}" })],
    TRIGGER_ID
  ),
  ["address"]
);

// 10. The labeled form {{@triggerId:Manual.field}} is recognized
assert(
  "labeled form {{@<id>:Label.field}} is recognized",
  extractTriggerInputFields(
    [
      node(TRIGGER_ID, {}),
      node("a1", { x: `{{@${TRIGGER_ID}:Manual.address}}` }),
    ],
    TRIGGER_ID
  ),
  ["address"]
);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\n❌ template-refs tests failed");
  process.exit(1);
}
console.log("\n✅ template-refs tests passed");
