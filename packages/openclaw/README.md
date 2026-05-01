# @keepergate/openclaw

[OpenClaw](https://openclaw.ai) plugin that drops [KeeperHub](https://keeperhub.com)'s on-chain execution layer into any OpenClaw agent.

## Install

```bash
openclaw plugins install @keepergate/openclaw
openclaw plugins enable keepergate
openclaw secrets set keepergate.apiKey kh_your_key_here
```

Or set the API key in your `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "entries": {
      "keepergate": {
        "apiKey": "kh_..."
      }
    }
  }
}
```

## Tools exposed

| Tool | What it does |
|---|---|
| `keepergate_transfer` | Native + ERC-20 transfers |
| `keepergate_call_contract` | Read or write any contract; auto-detects, auto-fetches ABI |
| `keepergate_check_and_execute` | Atomic read-condition-write for stop-loss / take-profit |
| `keepergate_get_execution_status` | Look up tx hash + explorer link for a previous write |
| `keepergate_list_workflows` | Discover workflows the user pre-built in KeeperHub |
| `keepergate_run_workflow` | Trigger a workflow by id, poll to terminal status |

Every operation runs through KeeperHub's execution layer — the agent inherits retries, gas optimization, MEV protection, and full audit trails.

## Embed in your own plugin

If you want the tools without the OpenClaw plugin wrapper (e.g. inside another plugin or another `pi-agent-core` consumer):

```ts
import { buildKeepergateTools } from "@keepergate/openclaw";
import { KeeperHubClient } from "@keepergate/core";

const client = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });
const tools = buildKeepergateTools(client); // AnyAgentTool[] — 6 tools
```

## Smoke test

```bash
KEEPERHUB_API_KEY=kh_... pnpm --filter @keepergate/openclaw smoke
```

Verifies:
- Plugin entry has the right shape (id, name, description, register)
- `register(api)` registers a tool factory
- The factory yields all 6 expected `AnyAgentTool` entries with correct labels and TypeBox schemas
- `keepergate_list_workflows` round-trips the user's KeeperHub account live
- `keepergate_call_contract` round-trips an Ethereum mainnet read (USDC.balanceOf) live
- `buildKeepergateTools()` convenience export returns the same 6 tools

## Notes on coverage

- ✅ Type-correct against `openclaw@^2026.4.29`
- ✅ Plugin entry shape, factory output, two `execute()` paths (live)
- ❌ Not: full installation through `openclaw plugins install` and a real OpenClaw agent driving the tools. The execute paths reuse `@keepergate/core`'s `DirectExecutor` and `KeeperHubClient`, which *are* end-to-end tested by the `@keepergate/langchain` adapter (real LLM, real tool selection, real KeeperHub).
