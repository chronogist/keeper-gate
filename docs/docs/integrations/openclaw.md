---
sidebar_position: 3
title: OpenClaw
---

# OpenClaw Integration

`@keepergate/openclaw` is an OpenClaw plugin that registers KeeperHub tools using OpenClaw's native `definePluginEntry` and TypeBox schema format.

**Example:** [`examples/openclaw`](https://github.com/chronogist/keeper-gate/tree/main/examples/openclaw)

## Install

```bash
openclaw plugins install @keepergate/openclaw
openclaw plugins enable keepergate
```

## Set your API key

```bash
openclaw secrets set keepergate.apiKey kh_your_key_here
```

The plugin reads the key from `~/.openclaw/openclaw.json` under `plugins.entries.keepergate.apiKey`. If that is not set, it falls back to the `KEEPERHUB_API_KEY` environment variable.

That's all the setup needed. The plugin registers its tools automatically when OpenClaw starts.

## Available tools

| Tool name | What it does |
|---|---|
| `keepergate_transfer` | Send native tokens or ERC-20 tokens |
| `keepergate_call_contract` | Read from or write to any smart contract |
| `keepergate_check_and_execute` | Read a value, check a condition, execute only if true |
| `keepergate_get_execution_status` | Get the result of a previous transaction by hash |
| `keepergate_list_workflows` | List all workflows in the KeeperHub account |
| `keepergate_run_workflow` | Trigger a workflow and wait for it to finish |

## Embedding tools in your own plugin

If you are building a custom OpenClaw plugin and want to include KeeperHub tools alongside your own, use `buildKeepergateTools()` directly:

```ts
import { buildKeepergateTools } from "@keepergate/openclaw";

const keepergateTools = buildKeepergateTools({ apiKey: process.env.KEEPERHUB_API_KEY! });

// Register them in your own plugin entry
for (const tool of keepergateTools) {
  api.registerTool(tool);
}
```

This gives you the same 6 tools as the standalone plugin, embedded inside your plugin's registration flow.

## Example interaction

Once the plugin is active, OpenClaw can use these tools in any agent session:

```
User:  Transfer 10 USDC to 0xAbc...123 on Base.
Agent: [calls keepergate_transfer]
       Done. Transaction confirmed: 0x7d4...
```

```
User:  List my workflows.
Agent: [calls keepergate_list_workflows]
       Found 2 workflows:
       - Weekly Rebalance (wf_abc123)
       - Treasury Watch (wf_def456)
```

## Troubleshooting

**Tools are not showing up in OpenClaw.** Run `openclaw plugins list` and confirm the plugin status shows `enabled`. If it shows `installed` but not `enabled`, run `openclaw plugins enable keepergate`.

**Authentication fails.** Run `openclaw secrets get keepergate.apiKey` to confirm the key is stored. If empty, re-run `openclaw secrets set keepergate.apiKey kh_your_key_here`.

**A tool call returns a `KeeperHubError`.** Check the `status` field — a `401` means the API key is wrong, a `404` means the workflow ID or contract address does not exist, and a `500` means KeeperHub returned an unexpected error.
