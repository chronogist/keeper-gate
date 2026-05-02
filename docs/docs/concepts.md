---
sidebar_position: 3
title: Core Concepts
---

# Core Concepts

KeeperGate exposes two distinct modes of on-chain interaction: **Direct Execution** and **Workflows**. Understanding the difference will help you know which tools to reach for.

## Direct Execution

Direct Execution lets your agent perform on-chain operations immediately, without any pre-built workflow in KeeperHub.

There are four direct execution tools:

| Tool | What it does |
|---|---|
| `transfer` | Send native tokens (ETH, BNB, etc.) or ERC-20 tokens to an address |
| `call_contract` | Read a value from or write a transaction to any smart contract |
| `check_and_execute` | Read a value, evaluate a condition, and execute a write only if the condition is true |
| `get_execution_status` | Look up the result of a previous write by transaction hash |

**When to use:** Anything immediate and self-contained — check a balance, send tokens, call a function, set up a stop-loss.

### Example: read a token balance

```ts
// LangChain tool call (the agent does this automatically)
await tools.call_contract({
  network: "ethereum",
  contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  functionName: "balanceOf",
  args: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"], // vitalik.eth
});
// Returns: { kind: "read", result: "120133626066" }
```

The ABI is fetched automatically from the block explorer. You only need to provide the function name and arguments.

## Workflows

Workflows are multi-step automations you build in the KeeperHub UI. They chain together triggers, conditions, and actions into a reusable graph.

There are six workflow tools:

| Tool | What it does |
|---|---|
| `list_workflows` | Return all workflows in your KeeperHub account |
| `run_workflow` | Trigger a workflow by its ID and wait for it to finish |
| `create_workflow` | Create a new blank workflow with a name and description |
| `update_workflow` | Modify an existing workflow's name, description, or node graph |
| `delete_workflow` | Delete a workflow by ID |
| `duplicate_workflow` | Clone a workflow (named `<original> (Copy)`) |

**When to use:** Complex recurring logic you've already configured in KeeperHub — scheduled tasks, multi-step DeFi strategies, alert-triggered flows.

### Example: trigger a workflow

```ts
// The agent lists workflows to find the right one, then runs it
const workflows = await client.listWorkflows();
// [{ id: "wf_abc123", name: "Weekly Rebalance", description: "..." }]

await client.executeWorkflow("wf_abc123", {});
// Polls automatically until the workflow reaches a terminal status
```

## How the agent picks tools

You do not tell the agent which tool to use. The agent receives all tools with descriptions and decides based on the user's request. For example:

- "Send 0.1 ETH to Alice" → agent picks `transfer`
- "Run my rebalance strategy" → agent picks `list_workflows` then `run_workflow`
- "If my ETH balance drops below 1, buy more" → agent picks `check_and_execute`

This is why the tool descriptions and argument descriptions matter — they are the agent's only guide.

## API key and authentication

Every request to KeeperHub includes your API key as a `Bearer` token. The key is read once at startup by the adapter and stored in the `KeeperHubClient` instance. You never pass it per-call.

## Error handling

When KeeperHub returns a non-2xx response, KeeperGate throws a `KeeperHubError` with three fields:

```ts
error.message  // human-readable description
error.status   // HTTP status code (e.g. 401, 404, 500)
error.body     // raw response body from KeeperHub
```

Catch this in your agent's error handler if you need to respond to specific failure modes.
