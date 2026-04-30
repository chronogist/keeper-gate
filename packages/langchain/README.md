# @keepergate/langchain

LangChain adapter for [KeeperHub](https://keeperhub.com). Drop reliable on-chain execution into any LangChain agent in 3 lines.

## Install

```bash
pnpm add @keepergate/langchain @langchain/core
```

## Use

```ts
import { KeeperGateToolkit } from "@keepergate/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const toolkit = new KeeperGateToolkit({ apiKey: process.env.KEEPERHUB_API_KEY! });
const tools = await toolkit.getTools();

const agent = createReactAgent({ llm: new ChatOpenAI({ model: "gpt-4o" }), tools });

await agent.invoke({
  messages: [{ role: "user", content: "Check vitalik.eth's USDC balance on Ethereum." }],
});
```

## Tools exposed

### Direct execution (raw on-chain primitives)

| Tool | What it does |
|---|---|
| `keepergate_transfer` | Native + ERC-20 transfers, with retry / gas optimization |
| `keepergate_call_contract` | Read or write any contract; auto-detects, auto-fetches ABI |
| `keepergate_check_and_execute` | Atomic read-condition-write for stop-loss / take-profit / threshold triggers |
| `keepergate_get_execution_status` | Look up tx hash, explorer link, gas used for a previous write |

### Workflow surface (use what the user pre-built)

| Tool | What it does |
|---|---|
| `keepergate_list_workflows` | Returns `{id, name, description}[]` for every workflow in the user's KeeperHub account |
| `keepergate_run_workflow` | Trigger a workflow by id, wait for terminal status, return per-node logs |

Every operation runs through KeeperHub's execution layer, so the agent gets retries, gas optimization, MEV protection, and full audit trails for free — no extra wiring.

## Restrict the surface

```ts
// Read-only agent (no write capability)
const toolkit = new KeeperGateToolkit({
  apiKey,
  include: ["callContract", "listWorkflows"],
});
```

## Patterns

**Discover then run.** When the user says *"run my rebalance workflow"*, the agent calls `keepergate_list_workflows`, finds the one named "Rebalance", calls `keepergate_run_workflow` with its id.

**Conditional automation.** *"If ETH drops below $3000, sell 0.5 ETH for USDC."* — agent picks `keepergate_check_and_execute` with a price-feed read + a swap action.

**Direct contract.** *"What's vitalik.eth's USDC balance?"* — agent picks `keepergate_call_contract`, fills in `balanceOf` and the args, gets the value synchronously.

## Smoke test

```bash
KEEPERHUB_API_KEY=kh_... pnpm --filter @keepergate/langchain smoke
```

Hits `USDC.balanceOf(vitalik.eth)` on Ethereum mainnet through the toolkit and confirms the round trip.

## Live demo with an LLM

See `examples/langchain-demo/` for a runnable agent driven by OpenRouter (any model). Set `KEEPERHUB_API_KEY` and `OPENROUTER_API_KEY`, then:

```bash
pnpm --filter langchain-demo start
# or with a custom prompt:
pnpm --filter langchain-demo start "Check WETH balance of 0xabc... on Base"
```
