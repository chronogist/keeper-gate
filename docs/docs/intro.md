---
slug: /
sidebar_position: 1
title: Introduction
---

# KeeperGate

KeeperGate is an adapter library that connects [KeeperHub](https://keeperhub.com) to the most popular AI agent frameworks: **ElizaOS**, **LangChain**, and **OpenClaw**.

KeeperHub handles the hard parts of on-chain execution — retries, gas optimization, MEV protection, and full audit trails. KeeperGate makes those capabilities available as native tools inside whichever agent framework you already use.

## What you get

Once installed, your agent can:

- Send native and ERC-20 token transfers
- Read and write any smart contract (ABI is fetched automatically)
- Run conditional on-chain logic (check a value, then act only if a condition is met)
- Trigger and manage KeeperHub workflows you've built in the KeeperHub UI

All of this runs through KeeperHub's execution layer. Your agent does not manage wallets, gas, or retries directly.

## How it works

```
Your Agent
    │
    ▼
KeeperGate adapter          ← one thin package per framework
    │
    ▼
@keepergate/core            ← shared REST client, polling, error handling
    │
    ▼
KeeperHub API               ← on-chain execution, retries, audit trail
    │
    ▼
Blockchain
```

The framework adapters are thin wrappers. All the real logic — auth, polling, error handling, schema inference — lives in `@keepergate/core` and is shared across every integration.

## Available integrations

| Framework | Package | What it provides |
|---|---|---|
| ElizaOS | `@keepergate/elizaos` | A `Plugin` with 6 `Action` handlers |
| LangChain | `@keepergate/langchain` | A `Toolkit` that returns `StructuredTool[]` |
| OpenClaw | `@keepergate/openclaw` | A `definePluginEntry` with 6 registered tools |

Each integration exposes the same 10 capabilities. The names differ slightly per framework convention (see [API Reference](/api-reference)).

## Next steps

- [Getting Started](/getting-started) — install and make your first call
- [Core Concepts](/concepts) — understand Direct Execution vs Workflows
- Pick your framework: [ElizaOS](/integrations/elizaos) · [LangChain](/integrations/langchain) · [OpenClaw](/integrations/openclaw)
