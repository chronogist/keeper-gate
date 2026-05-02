---
sidebar_position: 2
title: Getting Started
---

# Getting Started

## Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- A KeeperHub account and API key (`kh_...`)

Get your API key from the [KeeperHub dashboard](https://keeperhub.com).

## Install

Install the adapter package for your framework. You do not need to install `@keepergate/core` separately — it is a dependency of each adapter.

**ElizaOS:**
```bash
pnpm add @keepergate/elizaos
```

**LangChain:**
```bash
pnpm add @keepergate/langchain
```

**OpenClaw:**
```bash
openclaw plugins install @keepergate/openclaw
```

## Set your API key

Store the API key in an environment variable so it is not hardcoded:

```bash
export KEEPERHUB_API_KEY=kh_your_key_here
```

Or add it to a `.env` file:

```
KEEPERHUB_API_KEY=kh_your_key_here
```

## Verify the connection

The fastest way to confirm everything is wired up is to list your KeeperHub workflows. Run this with `ts-node` or in a quick script:

```ts
import { KeeperHubClient } from "@keepergate/core";

const client = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });
const workflows = await client.listWorkflows();

console.log(workflows);
```

If you see an array (empty or not), the connection works.

## Next steps

Go to the page for your framework:

- [ElizaOS](/integrations/elizaos)
- [LangChain](/integrations/langchain)
- [OpenClaw](/integrations/openclaw)
