# KeeperGate × ElizaOS Example

An ElizaOS agent that loads the `@keepergate/elizaos` plugin via a `character.json` file. Once running, the agent can manage KeeperHub workflows and trigger on-chain operations through natural conversation.

## Prerequisites

- Node.js 18+
- A KeeperHub API key (`kh_...`) — get one at [app.keeperhub.com](https://app.keeperhub.com) → Settings → API Keys
- An OpenAI-compatible LLM endpoint and key

---

## Setup

```bash
cd examples/elizaos-agent
npm install
```

Open `character.json` and fill in your keys under `settings.secrets`:

```jsonc
{
  "settings": {
    "secrets": {
      "KEEPERHUB_API_KEY": "kh_your_key_here",
      "OPENAI_API_KEY": "your_llm_key"
    }
  }
}
```

The LLM endpoint is configured in `settings` (not `secrets`):

```jsonc
{
  "settings": {
    "OPENAI_BASE_URL": "https://ollama.com/v1",
    "OPENAI_SMALL_MODEL": "gpt-oss:20b",
    "OPENAI_LARGE_MODEL": "gpt-oss:120b"
  }
}
```

---

## Run

```bash
npm start
```

This runs:

```bash
elizaos start --character ./character.json
```

ElizaOS loads the character file, initializes all listed plugins (including `@keepergate/elizaos`), and starts the agent. The KeeperGate plugin reads `KEEPERHUB_API_KEY` from `settings.secrets` and registers its actions on the runtime.

---

## How the plugin is loaded

The example uses the **static plugin form** — the plugin is listed by package name and ElizaOS resolves it automatically:

```jsonc
{
  "plugins": [
    "@elizaos/plugin-sql",
    "@elizaos/plugin-openai",
    "@elizaos/plugin-bootstrap",
    "@keepergate/elizaos"
  ]
}
```

---

## Available actions

| Action | Triggered by messages containing... |
|---|---|
| `KEEPERGATE_TRANSFER` | "send", "transfer", "pay" |
| `KEEPERGATE_CALL_CONTRACT` | "call", "read", "write", "balance", "contract", "function" |
| `KEEPERGATE_CHECK_AND_EXECUTE` | "if", "when", "stop loss", "take profit", "below", "above" |
| `KEEPERGATE_GET_EXECUTION_STATUS` | "status", "did", "land", "confirmed", "tx", "transaction" |
| `KEEPERGATE_LIST_WORKFLOWS` | "list", "workflow", "show" |
| `KEEPERGATE_RUN_WORKFLOW` | "run", "trigger", "execute", "workflow" |

---

## Example conversations

```
User:  What workflows do I have on KeeperHub?
Eliza: Let me check that for you.
       [calls KEEPERGATE_LIST_WORKFLOWS]
       You have 2 workflows: Weekly Rebalance, Treasury Watch.
```

```
User:  Create a new workflow called Treasury Rebalancer
Eliza: Creating workflow...
       [calls KEEPERGATE_CREATE_WORKFLOW]
       Done. Workflow created with ID wf_xyz.
```

---

## Troubleshooting

**Plugin loads but actions never fire.** The `validate()` function checks for specific keywords. Make sure the message contains a word from the trigger column above.

**`KEEPERHUB_API_KEY is required` at startup.** The key must be under `settings.secrets.KEEPERHUB_API_KEY` in `character.json`, not under `settings` directly.
