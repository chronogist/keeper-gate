---
sidebar_position: 1
title: ElizaOS
---

# ElizaOS Integration

`@keepergate/elizaos` adds KeeperHub tools to an ElizaOS agent as a native **Plugin** with six **Actions**.

**Example:** [`examples/elizaos-agent`](https://github.com/chronogist/keeper-gate/tree/main/examples/elizaos-agent)

## Install

```bash
pnpm add @keepergate/elizaos
```

## Add to your character

There are two ways to load the plugin.

### Option A — factory function (recommended)

Pass the API key directly in code:

```ts
import { createKeepergatePlugin } from "@keepergate/elizaos";

const character = {
  name: "MyAgent",
  plugins: [
    createKeepergatePlugin({ apiKey: process.env.KEEPERHUB_API_KEY! }),
  ],
};
```

### Option B — static plugin from character.json

Add the plugin by name and put the API key in settings. ElizaOS reads the key automatically when the plugin initializes:

```json
{
  "name": "MyAgent",
  "plugins": ["@keepergate/elizaos"],
  "settings": {
    "secrets": {
      "KEEPERHUB_API_KEY": "kh_your_key_here"
    }
  }
}
```

Both options register the same six actions on the runtime. Use Option A when you want to manage the key in code; use Option B when you configure agents through JSON files.

## Actions

Each action maps to a KeeperHub operation. ElizaOS actions are identified by uppercase names.

| Action name | What it does |
|---|---|
| `KEEPERGATE_TRANSFER` | Send native tokens or ERC-20 tokens |
| `KEEPERGATE_CALL_CONTRACT` | Read from or write to any smart contract |
| `KEEPERGATE_CHECK_AND_EXECUTE` | Read a value, check a condition, execute only if true |
| `KEEPERGATE_GET_EXECUTION_STATUS` | Get the result of a previous transaction by hash |
| `KEEPERGATE_LIST_WORKFLOWS` | List all workflows in the KeeperHub account |
| `KEEPERGATE_RUN_WORKFLOW` | Trigger a workflow by ID and wait for it to finish |

## How actions are triggered

Each action has a `validate()` function that scans the user's message for intent keywords before the action runs. For example:

- Messages containing "transfer", "send", or "pay" → `KEEPERGATE_TRANSFER`
- Messages containing "call", "contract", or "read" → `KEEPERGATE_CALL_CONTRACT`
- Messages containing "workflow" or "run" → `KEEPERGATE_RUN_WORKFLOW`

The action's `handler()` then uses the ElizaOS model to extract structured parameters from the message (network, address, amount, etc.) and calls KeeperHub.

## Example conversation

```
User:  Send 0.05 ETH to 0xAbc...123 on Ethereum.
Agent: I'll send that now. [calls KEEPERGATE_TRANSFER]
       Transfer submitted. Transaction hash: 0x9f3...
```

```
User:  List my KeeperHub workflows.
Agent: [calls KEEPERGATE_LIST_WORKFLOWS]
       You have 2 workflows:
       - Weekly Rebalance (wf_abc123)
       - Treasury Watch (wf_def456)
```

## Chaining actions

ElizaOS merges the results of prior actions into the agent's state for the next turn. This means an agent can:

1. Call `KEEPERGATE_LIST_WORKFLOWS` to find the right workflow ID
2. Use that ID in a follow-up `KEEPERGATE_RUN_WORKFLOW` call

No extra wiring is needed — ElizaOS handles state passing between actions automatically.

## Troubleshooting

**The plugin does nothing when I add it.** Check that the API key is set. With the static plugin form, the key must be under `settings.secrets.KEEPERHUB_API_KEY`. With the factory form, confirm `process.env.KEEPERHUB_API_KEY` is defined before the character is created.

**An action is not firing.** The `validate()` check is keyword-based. Make sure the user's message contains a recognizable intent word (e.g., "transfer", "contract", "workflow"). If your use case requires more specific triggering, use the factory form and extend the plugin.
