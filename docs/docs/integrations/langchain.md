---
sidebar_position: 2
title: LangChain
---

# LangChain Integration

`@keepergate/langchain` provides a `KeeperGateToolkit` that returns native LangChain `StructuredTool` objects. Drop them into any LangChain agent the same way you would any other tool.

**Example:** [`examples/langchain`](https://github.com/chronogist/keeper-gate/tree/main/examples/langchain)

## Install

```bash
pnpm add @keepergate/langchain @langchain/core @langchain/langgraph
```

## Basic setup

```ts
import { KeeperGateToolkit } from "@keepergate/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const toolkit = new KeeperGateToolkit({
  apiKey: process.env.KEEPERHUB_API_KEY!,
});

const tools = await toolkit.getTools();

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools,
});
```

That's it. The agent now has access to all 10 KeeperHub tools.

## Using the agent

```ts
const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "What is the USDC balance of vitalik.eth on Ethereum?",
    },
  ],
});
```

The agent picks the right tool (`keepergate_call_contract`), fills in the arguments, calls KeeperHub, and returns the answer — without you specifying which tool to use.

## Multi-step example

The agent chains tools automatically when the task requires it:

```ts
await agent.invoke({
  messages: [
    {
      role: "user",
      content:
        "Check my USDC balance on Base. If it is over $100, run my rebalance workflow.",
    },
  ],
});
```

What the agent does behind the scenes:
1. `keepergate_call_contract` — reads the USDC balance on Base
2. `keepergate_list_workflows` — finds the "rebalance" workflow ID
3. `keepergate_run_workflow` — triggers it and waits for completion

## Restricting which tools are available

If you only want the agent to use a subset of tools, pass an `include` list:

```ts
const toolkit = new KeeperGateToolkit({
  apiKey: process.env.KEEPERHUB_API_KEY!,
  include: ["keepergate_call_contract", "keepergate_list_workflows", "keepergate_run_workflow"],
});

const tools = await toolkit.getTools(); // only 3 tools
```

This is useful when you want to limit the agent's surface — for example, a read-only agent that can inspect contracts and workflows but cannot send transactions.

## Available tools

| Tool name | What it does |
|---|---|
| `keepergate_transfer` | Send native tokens or ERC-20 tokens |
| `keepergate_call_contract` | Read from or write to any smart contract |
| `keepergate_check_and_execute` | Read a value, check a condition, execute only if true |
| `keepergate_get_execution_status` | Get the result of a previous transaction by hash |
| `keepergate_list_workflows` | List all workflows in the KeeperHub account |
| `keepergate_run_workflow` | Trigger a workflow and wait for it to finish |
| `keepergate_create_workflow` | Create a new workflow with a name and description |
| `keepergate_update_workflow` | Modify an existing workflow's name, description, or graph |
| `keepergate_delete_workflow` | Delete a workflow by ID |
| `keepergate_duplicate_workflow` | Clone a workflow |

## Troubleshooting

**`getTools()` throws an authentication error.** Your API key is invalid or not set. Confirm `process.env.KEEPERHUB_API_KEY` is a valid `kh_...` key.

**The agent picks the wrong tool.** Each tool includes per-argument descriptions that guide the LLM. If you're seeing mismatch, try being more specific in the user message (e.g., "use my rebalance workflow" rather than "rebalance my portfolio").

**The agent times out waiting for a workflow.** Long-running workflows may exceed the default poll timeout. The underlying `pollUntilDone()` has a configurable `timeoutMs`. For now, break long workflows into shorter steps or use `keepergate_get_execution_status` to check asynchronously.
