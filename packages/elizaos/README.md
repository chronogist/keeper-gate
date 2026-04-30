# @keepergate/elizaos

ElizaOS plugin that drops [KeeperHub](https://keeperhub.com)'s on-chain execution layer into any ElizaOS agent.

## Install

```bash
pnpm add @keepergate/elizaos @elizaos/core
```

Pin `@elizaos/core` to `^1.7.2` (do not track `2.0.0-alpha.*`).

## Use — factory form

```ts
import { createKeepergatePlugin } from "@keepergate/elizaos";

const character = {
  name: "Treasury",
  // ...character config
  plugins: [
    createKeepergatePlugin({ apiKey: process.env.KEEPERHUB_API_KEY! }),
  ],
};
```

## Use — character.json form

```jsonc
{
  "name": "Treasury",
  "plugins": ["@keepergate/elizaos"],
  "settings": {
    "secrets": { "KEEPERHUB_API_KEY": "kh_..." }
  }
}
```

The plugin's `init` hook reads `KEEPERHUB_API_KEY` from plugin config, runtime settings, or env (in that order) and registers all six actions on the runtime.

## Actions exposed

### Direct execution

| Action | Triggered by intent words |
|---|---|
| `KEEPERGATE_TRANSFER` | "send", "transfer", "pay" |
| `KEEPERGATE_CALL_CONTRACT` | "call", "read", "write", "balance", "contract", "function" |
| `KEEPERGATE_CHECK_AND_EXECUTE` | "if", "when", "stop loss", "take profit", "below", "above" |
| `KEEPERGATE_GET_EXECUTION_STATUS` | "status", "did", "land", "confirmed", "tx", "transaction" |

### Workflow surface

| Action | Triggered by intent words |
|---|---|
| `KEEPERGATE_LIST_WORKFLOWS` | "list workflow", "workflows", "what workflows", "show workflow", "my workflow" |
| `KEEPERGATE_RUN_WORKFLOW` | "run workflow", "trigger workflow", "execute workflow" |

Each action's `validate()` runs a cheap intent heuristic on the message text. Full LLM-based argument extraction only fires inside `handler()` once the action has been selected — no model burn per message per action.

Inside the handler, args are extracted via the v1 pattern: `runtime.composeState` + `composePromptFromState` + `runtime.useModel(ModelType.TEXT_SMALL, ...)` + `parseKeyValueXml`. Every action surfaces results both ways: a `callback()` message into the conversation and an `ActionResult` with `success`/`text`/`values`/`data` for action chaining.

## Smoke test

```bash
KEEPERHUB_API_KEY=kh_... pnpm --filter @keepergate/elizaos smoke
```

Verifies the plugin instantiates, exposes the expected six actions, every action has a valid shape, and every `validate()` returns true on a positive-intent message.

## Notes on coverage

- ✅ Type-correct against `@elizaos/core@1.7.2`
- ✅ Plugin instantiation, action shape, `validate()` paths smoke-tested
- ❌ Full end-to-end (real Eliza character running our actions against a live LLM provider + KeeperHub) — not exercised here. The action handlers share the same `DirectExecutor` / `KeeperHubClient` paths verified in `@keepergate/langchain` and `@keepergate/core`, which *are* end-to-end tested.
