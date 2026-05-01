# NOT_TESTED.md

A running list of what's *not yet covered* by `pnpm test`, what we'd need to cover each item, and the order we plan to chip away at it.

This is intentionally public — engineering honesty about coverage gaps is a feature, not a bug. Every item here has a code path that's exercised at least once end-to-end (e.g. the failure surface) — what's missing is a specific input/scenario.

---

## A. Blocked by external infrastructure

Cannot be tested from the repo today; requires setup outside our control.

### A1. Successful native / ERC-20 transfer
- **What's missing:** a `keepergate_transfer` (LangChain) / `KEEPERGATE_TRANSFER` (Eliza) call that actually lands a tx on-chain.
- **Currently verified:** the 422 *"No wallet configured"* response is surfaced cleanly through both adapters.
- **Need:** a Para MPC wallet provisioned in the KeeperHub org + a small testnet balance (e.g. Sepolia or Base Sepolia ETH).
- **Steps once unblocked:**
  1. Create wallet at `app.keeperhub.com` → Settings → Wallet
  2. Fund with ~0.001 testnet ETH
  3. Add `KEEPERHUB_TEST_WALLET=0x...` env var
  4. Add a `smoke:write` script that does a 0.0001 ETH transfer to a sentinel address, polls `getStatus`, asserts `status: "completed"` + `transactionHash` is set
- **Estimated effort:** 20 min once wallet is funded

### A2. Successful contract write (e.g. ERC-20 approve, Uniswap swap)
- **What's missing:** `keepergate_call_contract` write path returning a real `executionId` that lands.
- **Currently verified:** read path returns mainnet data; the `isReadResult` discriminator works.
- **Need:** same wallet from A1.
- **Steps:** call `approve(spender, 0)` on a testnet ERC-20 — minimal cost, easy to assert.
- **Estimated effort:** 10 min after A1.

### A3. `getStatus` happy path with tx hash + explorer link
- **What's missing:** a successful status lookup returning `transactionHash`, `transactionLink`, `gasUsedWei`.
- **Currently verified:** 404 path surfaces as a typed `KeeperHubError`.
- **Need:** an `executionId` from a real prior write (i.e. depends on A1).
- **Estimated effort:** trivial after A1 (chain it onto the same smoke).

### A4. Workflow with resolved `{{@trigger.X}}` template inputs
- **What's missing:** a workflow that actually substitutes a trigger input into a downstream node.
- **Currently verified:** the workflow runs, but the platform leaves the literal `{{@trigger.X}}` string in place. Documented in `builder-feedback.md` as the critical KeeperHub bug we found.
- **Need:** KeeperHub's executor to fix the template resolver. Not something we can test around without re-implementing substitution client-side (which defeats the point).
- **Estimated effort:** zero on our side — blocked upstream.

### A5. Real Eliza character running our plugin against a live LLM
- **What's missing:** a full Eliza agent with `@keepergate/elizaos` registered, picking actions in response to chat input.
- **Currently verified:** plugin construction, all 6 actions present, every `validate()` heuristic, every `handler()` end-to-end with a stubbed runtime.
- **Need:**
  - Eliza CLI: `bun create eliza my-test-agent`
  - Postgres or pglite for state
  - A model provider plugin (e.g. `@elizaos/plugin-openai` or `@elizaos/plugin-anthropic`) configured with our OpenRouter key
  - A character.json that lists `@keepergate/elizaos` and points settings at our `KEEPERHUB_API_KEY`
- **Estimated effort:** ~1 hour to wire up; ~10 min to run the demo.
- **Recommended:** record a demo video here, mirror the LangChain demo's structure.

---

## B. Quick wins (~5–30 min each, no infra needed)

These can be added in the existing `pnpm test` flow today.

### B4. `pollUntilDone` timeout path
- **What:** verify the timeout error fires with the expected message when an execution doesn't terminate in time.
- **Need:** mock fetch returning persistent `running` status.
- **Where:** new `packages/core/test/poll-timeout.test.ts`.
- **Estimated effort:** 10 min.

### B6. Eliza handler `responses` parameter (action chaining)
- **What:** invoke a handler with a non-empty `responses` array and assert `composeState` is called with the providers from those responses.
- **Why it matters:** Eliza v1's action-chaining contract.
- **Where:** `packages/elizaos/test/smoke.ts`.
- **Estimated effort:** 15 min.

---

## C. Tested by code path, but not every input

These code paths are exercised — what's missing is variation.

### C1. HTTP error variety
- Tested: 404 (missing execution), 422 (no wallet).
- Not tested: 500, 503, network timeouts, malformed JSON, non-JSON bodies.
- Risk: low — `KeeperHubClient.request` falls back to `res.statusText` for non-JSON, and the wrapper logic is uniform.

### C2. LangChain agent constructors
- Tested: `createReactAgent` from `@langchain/langgraph/prebuilt`.
- Not tested: `AgentExecutor`, `createOpenAIToolsAgent`, `createStructuredChatAgent`.
- Risk: low — they all consume `StructuredTool[]` which is what `getTools()` returns.

### C3. LLM provider variety
- Tested: gpt-oss-20b via OpenRouter.
- Not tested: GPT-4o-mini, Claude, Gemini, local models.
- Risk: low — any model with OpenAI-compatible function calling works through the same `ChatOpenAI` baseURL trick.

### C4. Direct Execution edge fields
- Tested: `network`, `recipientAddress`, `amount`, `tokenAddress`, `contractAddress`, `functionName`, `functionArgs`.
- Not tested: `tokenConfig` (custom decimals), `gasLimitMultiplier`, `value` for payable functions, custom `abi` overrides.
- Risk: low — these are pass-through fields, no client-side logic.

---

## D. Order we plan to tackle these

1. ~~**B1** (toolkit include filter)~~ — done.
2. ~~**B9** (isReadResult discriminator)~~ — done.
3. ~~**B5** (rawRequest error path)~~ — done.
4. ~~**B2** (cross-chain smoke)~~ — done. Surfaced 3 findings (auto-ABI scope, chain-id workaround, stateMutability requirement).
5. ~~**B7** (template-refs pathological)~~ — done.
6. ~~**B8** (parseKeyValueXml malformed)~~ — done.
7. ~~**B3** (multi-step demo)~~ — done. Free gpt-oss-20b chained list_workflows + run_workflow correctly.
8. **B4** (pollUntilDone timeout) — needs fetch mocking, slightly more work.
9. **B6** (Eliza responses chaining) — needs more elaborate stub.
10. **A1 → A2 → A3** — once a testnet wallet is set up.
11. **A5** — full Eliza character demo, the natural follow-up after A1–A3.

---

## How we'll keep this honest

When something here gets tested, the corresponding entry moves to the README's "verified live" table and is removed from this file in the same commit. No exceptions — `NOT_TESTED.md` and the live-coverage table must always agree.
