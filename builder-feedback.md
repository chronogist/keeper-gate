# Builder Feedback — KeeperHub

Notes collected while building the KeeperGate adapter (universal SDK
that bridges KeeperHub workflows to LangChain / ElizaOS / etc.).

Each item is specific, actionable, and references a concrete repro
path or doc location.

---

## 0. CRITICAL — Template references to the trigger node aren't resolved at runtime

**Type:** Reproducible bug
**Severity:** **Critical** — this breaks the most natural way to feed
data from a Manual trigger into any web3 action

**Repro:**
1. Workflow: Manual trigger → Web3 → Check Balance
2. In Check Balance, set `address` field to `{{@trigger.address}}`
3. Save, enable the action, then `POST /api/workflow/{id}/execute`
   with body `{"input": {"address": "0xe74096f8ef2b08aa7257ac98459c624e1bf9a548"}}`
4. Status: `error`. Error message:
   `"Invalid Ethereum address: {{@trigger.address}}"`

**What we observed in the logs:**
- The trigger node ran successfully — its `output.data` correctly
  contained `{ address: "0xe74...", timestamp: ..., triggered: true }`
- The Check Balance node's `input.address` was the **literal string**
  `"{{@trigger.address}}"` — the template engine never substituted it
- KeeperHub even auto-generated a broken `addressLink`:
  `"https://chainscan.0g.ai/address/{{@trigger.address}}"`

**We tested both syntactic forms — neither resolves:**

| Form tried (in `address` field) | Runtime behavior |
|---|---|
| `{{@trigger.address}}` | Passed as literal string → `"Invalid Ethereum address: {{@trigger.address}}"` |
| `{{@trigger.data.address}}` | Passed as literal string → `"Invalid Ethereum address: {{@trigger.data.address}}"` |

In both cases:
- The trigger node ran successfully and its `output.data.address`
  *was* set correctly to the input value
- The Check Balance plugin received the literal template string,
  unresolved
- KeeperHub auto-built a broken `addressLink` containing the
  unresolved template, confirming nothing in the pipeline ran a
  template substitution pass

**Conclusion:** the template resolver is not invoked between trigger
output and the next node's input — at least for `web3/check-balance`,
and likely for all Web3 plugins (since they all share the same
input-shaping path).

**Suggested fix (any one):**
- Wire `{{@trigger.field}}` to auto-unwrap the trigger's `data` object
- Document that callers must use `{{@trigger.data.field}}` and have
  the UI emit that form
- Surface a validation error when a template ref doesn't resolve,
  instead of passing the literal string into a typed field

This single bug currently blocks any "agent-fills-in-the-arguments"
use case on KeeperHub, which is the entire premise of agent-driven
workflows.

**Workaround in keeper-gate:**
- **Approach:** Since template resolution fails at KeeperHub runtime, keeper-gate treats workflows as schema-driven, not template-driven
- **Implementation:** `packages/core/src/workflow-tool.ts` extracts input schema by parsing template references from downstream node configs
- **Result:** Agent frameworks receive a fully typed, executable workflow tool with explicit input parameters — no template syntax needed at invocation time
- **Code:** The `extractTriggerInputFields()` function reverse-engineers the input schema from the workflow definition itself, making the template limitation transparent to end users

---

## 1. UI strips `{{@trigger.field}}` template refs from validated address fields

**Type:** UX bug / feature gap
**Severity:** Medium — blocks the most natural way to pass data into a workflow

**Repro:**
1. Create a workflow with a Manual trigger and a Web3 → Check Balance action
2. In the action's `address` field, type `{{@trigger.address}}`
3. Toggle the action **enabled** and save the workflow
4. Re-open the workflow → the field has been replaced with a hardcoded
   address (or cleared), wiping the template reference

**Why it matters:** the template-reference syntax is the documented way
to pass data between nodes (see MCP docs, Condition Nodes section). It
works for non-validated string fields but is silently dropped for
fields validated as Ethereum addresses, amounts, etc.

**Suggested fix:**
- Detect template syntax (`{{@...}}`) and skip type validation when present
- Or expose a per-field "expression mode" toggle (like Zapier / n8n)
- Or surface a clear error toast: "Template references are not
  supported in this field" instead of silently dropping the value

**Workaround in keeper-gate:**
- **Approach:** Avoid template references in validated fields; use schema extraction instead
- **Implementation:** The `extractTriggerInputFields()` function doesn't rely on templates surviving the UI save/load cycle
- **Result:** Input schema is derived once during workflow creation and cached, making the feature work reliably
- **Benefit:** Framework-agnostic: tools work with Zapier, n8n, or any other integration that uses KeeperHub workflows

---

## 2. `{{@trigger.X}}` alias vs. real node id is undocumented

**Type:** Documentation gap

The MCP docs example shows the explicit form:
```
{{@nodeId:Label.field}}
```

But the UI emits:
```
{{@trigger.address}}
```

…where `trigger` is a literal alias for the trigger node, even though
the actual node has a random id like `sDrDawcdorsgJzjbZjLiZ`.

**Why it matters:** any tool that programmatically introspects
workflows (SDKs, validators, lint tools) needs to know about this alias.
We had to discover it by dumping a real workflow JSON and tracing where
inference broke.

**Suggested fix:** add a "Template references" section to the
`Workflows` or `Nodes` docs that enumerates:
- The full `{{@nodeId:Label.field}}` form
- The `{{@trigger.field}}` alias (and any other reserved aliases)
- Whether `{{@<previousNodeLabel>.field}}` is also accepted

**Workaround in keeper-gate:**
- **Approach:** Hardcode knowledge of the `{{@trigger.*}}` alias in template parsing
- **Implementation:** `packages/core/src/template-refs.ts` explicitly handles both syntactic forms
- **Code:** Parser recognizes `@trigger.fieldName` as referring to the first trigger node's output, regardless of its actual node ID
- **Result:** SDK can reliably parse template references without needing KeeperHub's documentation

---

## 3. `GET /api/workflows/executions/{id}/logs` response shape contradicts the docs

**Type:** Reproducible bug / API inconsistency
**Severity:** Medium — docs are wrong, costs every SDK author the
same hour of debugging

The API docs (`docs.keeperhub.com/api/executions`) document:
```json
{ "data": [ { "nodeId": "...", ... } ] }
```

The actual response shape is:
```json
{
  "execution": { "id": "...", "status": "...", "input": {...}, ... },
  "logs":      [ { "id": "...", "nodeId": "...", "input": {...}, ... } ]
}
```

`data` is not present at all. We had to inspect a raw response and
guess at the shape. Our `KeeperHubClient.getExecutionLogs` now
defensively handles three shapes (`{logs}`, `{data}`, bare array)
just to be safe.

The actual response also contains far richer information than the
docs imply (the entire workflow definition, per-node `iterationIndex`
for forEach loops, `addressLink`s for block explorers) — none of
which is documented.

**Suggested fix:** update the docs to match the real response, or
publish an OpenAPI spec we can consume directly.

**Workaround in keeper-gate:**
- **Approach:** Defensive response parsing to handle all observed shapes
- **Implementation:** `packages/core/src/client.ts:190-202` implements a fallback chain
- **Code:** 
  ```typescript
  if (Array.isArray(res)) return { data: res ... };
  if (Array.isArray(obj.logs)) return { data: obj.logs ... };
  if (Array.isArray(obj.data)) return { data: obj.data ... };
  ```
- **Result:** Client gracefully handles API inconsistencies and returns predictable output shape to callers

---

## 4. `POST /workflow/{id}/execute` returns `status: "success"` even when downstream actions are disabled and produce zero logs

**Type:** UX / observability gap
**Severity:** Medium — looks like a green run but actually nothing happened

**Repro:**
1. Workflow with Manual → Check Balance, where Check Balance has
   `enabled: false` (or workflow itself has `enabled: false`)
2. Call `POST /api/workflow/{id}/execute` with valid inputs
3. Poll status → `success`
4. Fetch logs → `[]` (empty)

A caller has no signal that the workflow effectively no-op'd. From the
client side it looks indistinguishable from a successful run.

**Suggested fix:**
- Include a `skippedNodes: [...]` field in the status / logs response
- Or surface a distinct status like `success_skipped` when no enabled
  nodes ran
- Or always emit one log entry per disabled node noting it was skipped

**Workaround in keeper-gate:**
- **Approach:** Always verify logs contain meaningful output before reporting success
- **Implementation:** `packages/core/src/client.ts:204-231` validates execution results before returning
- **Pattern:** Check both status and logs array — a successful execution should have at least one log entry
- **Result:** Callers can distinguish between "workflow was skipped" (empty logs) and "workflow succeeded" (logs present)

---

## 5. `priceUsdcPerCall` field exists on workflows but x402 / MPP integration is not documented

**Type:** Documentation gap

`GET /api/workflows/{id}` exposes:
```json
{ "priceUsdcPerCall": null, ... }
```

…suggesting per-call pricing for paid workflows is data-modeled. The
keeperhub.com landing copy mentions "agents can pay autonomously via
x402 or MPP" but the API docs (`docs.keeperhub.com/api`) contain no
mention of x402, MPP, payment headers, or how a paying caller proves
settlement.

**Suggested fix:** add an `API → Payments` page that documents:
- How to set a workflow's price
- What HTTP headers / payment proof a paying caller must include
- How a paying caller's execution differs from a free one (rate
  limits, error codes, etc.)

This is currently the single biggest blocker for building agent
demos that *actually* exercise the autonomous-payment story.

**Workaround in keeper-gate:**
- **Approach:** Skip payment integration until API is documented
- **Implementation:** `packages/core/src/types.ts` has field stubs but no enforcement
- **Current state:** Workflows can be created with `priceUsdcPerCall` but payment headers are not validated
- **Note:** This is a feature gap on KeeperHub's side (no documented API), not a keeper-gate issue

---

## 6. Workflow `enabled` flag semantics are unclear vs. `go-live`

**Type:** Documentation / UX gap

A workflow has `enabled: false` by default. There's also a
`PUT /api/workflows/{id}/go-live` endpoint described as "publish a
workflow to make it publicly visible." It's not clear:

- Does `enabled: false` prevent scheduled/event triggers from firing?
- Does it prevent `POST .../execute` from running? (Empirically, no.)
- Is "go-live" purely about marketplace visibility, or does it also
  flip `enabled`?
- Is there an `/enable` endpoint, or do you `PATCH` the workflow with
  `{enabled: true}`?

**Suggested fix:** a short "Lifecycle" section in `docs/workflows`
covering draft → enabled → go-live transitions and what each one
controls.

**Workaround in keeper-gate:**
- **Approach:** Document the observed behavior empirically
- **Implementation:** `packages/core/src/client.ts` treats all workflows as executable via API regardless of enabled state
- **Documented pattern:** Always use `updateWorkflow({ enabled: true })` to enable before scheduling
- **Result:** Callers follow the safer, more explicit pattern even if semantics are unclear

---

## 7. CLI doc page is a flat list of commands with no narrative

**Type:** Documentation gap (minor)

`docs.keeperhub.com/cli` lists ~40 commands (`kh workflow run`,
`kh execute transfer`, ...) with no top-of-page "common flows" section.

Coming from the API side, it's not obvious whether `kh workflow run`
is the CLI equivalent of `POST /workflow/{id}/execute` (probably yes)
or how to authenticate the CLI against an org API key for headless use.

**Suggested fix:** add a 3-recipe section: "run a workflow from the
CLI", "execute a one-shot transfer", "use an API key in CI".

**Workaround in keeper-gate:**
- **Approach:** Provide comprehensive API documentation instead
- **Implementation:** keeper-gate focuses on the programmatic API, not CLI
- **Documentation:** `packages/core/README.md` shows common patterns (execute, poll, get logs)
- **Result:** Developers using keeper-gate bypass the CLI entirely and use the well-documented SDK

---

## 8. Direct Execution auto-ABI is silently restricted to a small chain set

**Type:** Documentation gap / feature gap
**Severity:** Medium — surprises every cross-chain caller

`POST /api/execute/contract-call` advertises auto-fetching the ABI from
the block explorer when omitted. In practice the auto-fetcher only
recognizes a fixed set of network names, surfaced via the error
message *"Unsupported network: arbitrum. Supported: mainnet,
eth-mainnet, ethereum-mainnet, ethereum, sepolia, eth-sepolia,
sepolia-testnet, base, base-mainnet, base-sepolia, base-testnet,
tempo-testnet, tempo, tempo-mainnet, solana, solana-mainnet,
solana-devnet, solana-testnet or numeric chain IDs"*.

So a caller hitting `network: "arbitrum"` (or `"polygon"`,
`"optimism"`, `"bsc"`, etc.) gets a 400 even though Arbitrum
mainnet has block explorers and is broadly supported by every
other Web3 SDK.

**Workarounds (both required for Arbitrum etc.):**
1. Pass `network` as a numeric chain id string (e.g. `"42161"`),
   not the human name.
2. Pass `abi` manually as a JSON string -- KeeperHub will not
   auto-fetch on these chains.

**Suggested fix:**
- Document the supported set in
  `docs.keeperhub.com/api/direct-execution`. The error message is
  the only place this list appears.
- Either accept Arbitrum/Polygon/Optimism by name (mapping to
  their chain ids internally) or expand the auto-ABI fetcher to
  Etherscan-compatible explorers for those networks.

**Workaround in keeper-gate:**
- **Approach:** Use numeric chain IDs and supply ABI manually for unsupported chains
- **Implementation:** `packages/core/src/direct-executor.ts` passes network as-is to KeeperHub API
- **Documented pattern:** For Arbitrum/Polygon/Optimism, use chain ID string `"42161"` instead of `"arbitrum"`
- **Provider library:** Use ethers.js / viem to auto-fetch ABIs client-side, then pass to keeper-gate
- **Result:** Works across all EVM chains with a simple workaround

---

## 9. Manual ABI parsing only respects modern `stateMutability`, not legacy `constant`

**Type:** Reproducible bug / API inconsistency
**Severity:** Medium — silently routes a read call as a write

When the caller supplies `abi` manually for a function marked with
the legacy Solidity `constant: true` flag (and no `stateMutability`
field), KeeperHub treats the call as a write and returns 422 *"No
wallet configured"*. Adding `stateMutability: "view"` to the same
ABI fixes it immediately.

**Repro:**
```jsonc
// Triggers 422 "No wallet configured" on a read function
[{
  "constant": true,
  "inputs": [{"name":"_owner","type":"address"}],
  "name": "balanceOf",
  "outputs": [{"name":"balance","type":"uint256"}],
  "type": "function"
}]
```

```jsonc
// Same function, just with stateMutability -- now correctly classified
[{
  "inputs": [{"name":"_owner","type":"address"}],
  "name": "balanceOf",
  "outputs": [{"name":"balance","type":"uint256"}],
  "stateMutability": "view",
  "type": "function"
}]
```

Both forms are valid Solidity ABI per the spec. Solidity ABIs in
the wild include either or both fields depending on compiler version.

**Suggested fix:** treat `constant: true` and `stateMutability:
"view" | "pure"` as equivalent inputs to the read/write classifier.

**Workaround in keeper-gate:**
- **Approach:** Normalize legacy ABIs before passing to KeeperHub
- **Implementation:** Pre-process ABIs to add `stateMutability: "view"` when `constant: true` is present
- **Code pattern:** 
  ```typescript
  if (func.constant && !func.stateMutability) {
    func.stateMutability = "view";
  }
  ```
- **Result:** ABIs from older contracts work seamlessly without caller intervention

---

## 10. `DirectReadResult.result` shape varies between bare-string and object

**Type:** Documentation gap (minor)
**Severity:** Low — doesn't break anything, but trips up SDKs that type the response

For the same `balanceOf` call:
- With auto-fetched ABI on Ethereum/Base: `{ "result": "120133626066" }`
- With manual ABI on Arbitrum (chain id `42161`): `{ "result": { "balance": "139489744" } }`

The auto-ABI path returns the value as a bare string; the manual
ABI path returns an object keyed by the ABI's named output fields.
KeeperHub's API docs don't mention this distinction; we typed
`result: string` initially in the SDK and had to widen to
`string | Record<string, unknown> | unknown[]` after seeing both
shapes in the wild.

**Suggested fix:** document in `docs.keeperhub.com/api/direct-execution` that the response shape mirrors the function's output structure (single unnamed return -> primitive; multiple or named returns -> object) so SDK authors can type it correctly.

**Workaround in keeper-gate:**
- **Approach:** Type result as a flexible union to handle all observed shapes
- **Implementation:** `packages/core/src/types.ts:156` types as `string | Record<string, unknown> | unknown[]`
- **Caller pattern:** Check the type at runtime or use a type guard
- **Result:** Code is resilient to all response shapes without requiring callers to preprocess

---

## Methodology

Findings collected while building <https://github.com/chronogist/keeper-gate>
(`@keepergate/core`) — a universal adapter that lets agent frameworks
treat KeeperHub workflows as callable tools. Source-of-truth for the
findings is the actual API responses we got while integrating.
