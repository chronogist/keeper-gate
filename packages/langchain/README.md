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

| Tool | Purpose |
|---|---|
| `keepergate_transfer` | Native + ERC-20 transfers, with retry / gas optimization |
| `keepergate_call_contract` | Read or write any contract; auto-detects, auto-fetches ABI |
| `keepergate_check_and_execute` | Atomic read-condition-write for stop-loss / take-profit / threshold triggers |

Each tool runs through KeeperHub's execution layer, so the agent gets retries, gas optimization, MEV protection, and full audit trails for free — no extra wiring.

## Restrict the surface

```ts
// Read-only agent
const toolkit = new KeeperGateToolkit({
  apiKey,
  include: ["callContract"],
});
```

## Smoke test

```bash
KEEPERHUB_API_KEY=kh_... pnpm --filter @keepergate/langchain smoke
```

Hits `USDC.balanceOf(vitalik.eth)` on Ethereum mainnet through the toolkit and confirms the round trip.
