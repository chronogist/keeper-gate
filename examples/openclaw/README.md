# KeeperGate × OpenClaw Integration Guide

This example wires KeeperHub's on-chain execution layer into an OpenClaw agent via the `@keepergate/openclaw` plugin. Once set up, your agent gets 10 tools covering direct on-chain operations and workflow management — no extra code required.

## Prerequisites

- OpenClaw installed globally: `npm install -g openclaw`
- A KeeperHub account and API key — create one at [app.keeperhub.com](https://app.keeperhub.com) → Settings → API Keys

---

## Step 1 — Build the plugin

The plugin ships as TypeScript source. Build it into a self-contained bundle first:

```bash
# From the repo root
pnpm install
pnpm --filter @keepergate/openclaw build
```

This produces `packages/openclaw/dist/index.js` (~231kb, all deps bundled in).

---

## Step 2 — Pack and install the plugin

OpenClaw installs plugins from tarballs. Pack it with npm (not pnpm — pnpm pack has different flag syntax):

```bash
cd packages/openclaw
npm pack
```

Then install into OpenClaw's global plugin store:

```bash
KEEPERHUB_API_KEY=kh_your_key_here openclaw plugins install --force ./keepergate-openclaw-0.0.2.tgz
```

> The `KEEPERHUB_API_KEY` env var is required during install because OpenClaw validates the plugin loads cleanly. The plugin reads the key from env if it's not in config.

---

## Step 3 — Allow and enable the plugin

OpenClaw requires non-bundled plugins to be explicitly allowed. Add this to `~/.openclaw/openclaw.json`:

```jsonc
{
  // ... your existing config ...
  "plugins": {
    "allow": ["keepergate"],
    "entries": {
      "keepergate": {
        "enabled": true
      }
    }
  }
}
```

---

## Step 4 — Inject the API key into the gateway service

The gateway runs as a background LaunchAgent (macOS) or systemd service (Linux) and doesn't inherit your shell env. Add the key to the service env file:

```bash
echo "export KEEPERHUB_API_KEY='kh_your_key_here'" >> ~/.openclaw/service-env/ai.openclaw.gateway.env
```

Then restart the gateway to pick it up:

```bash
openclaw gateway stop
openclaw gateway start
```

---

## Step 5 — Verify

```bash
openclaw plugins list
```

You should see:

```
│ KeeperGate │ keepergate │ openclaw │ enabled │ global:keepergate/dist/index.js │ 0.0.2 │
```

And:

```bash
openclaw plugins inspect keepergate
# Status: loaded
```

---

## Step 6 — Start your agent

```bash
cd examples/openclaw
npm start
# runs: OPENCLAW_CONFIG_PATH=./openclaw.json openclaw gateway start
```

The `openclaw.json` in this directory configures the model provider and gateway settings. Edit it to point at your own LLM provider:

```jsonc
{
  "models": {
    "mode": "replace",
    "providers": {
      "your-provider": {
        "baseUrl": "https://your-llm-endpoint/v1",
        "apiKey": "your-llm-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "your-model-id",
            "name": "Your Model",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 16000,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "your-provider/your-model-id" }
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token", "token": "your-gateway-token" }
  }
}
```

---

## Available tools

Once loaded, your agent has these tools automatically:

### Direct on-chain execution

| Tool | What it does |
|---|---|
| `keepergate_transfer` | Transfer native tokens or ERC-20s to any address |
| `keepergate_call_contract` | Call any contract function — auto-detects read vs write, auto-fetches ABI |
| `keepergate_check_and_execute` | Atomic read → condition check → conditional write (stop-loss, take-profit) |
| `keepergate_get_execution_status` | Look up tx hash, explorer link, and gas used for a previous write |

### Workflow management

| Tool | What it does |
|---|---|
| `keepergate_list_workflows` | List all workflows in your KeeperHub account |
| `keepergate_run_workflow` | Execute a workflow by ID, polls until terminal status |
| `keepergate_create_workflow` | Create a new workflow with a manual trigger |
| `keepergate_update_workflow` | Patch a workflow's name, description, or graph |
| `keepergate_delete_workflow` | Delete a workflow (use `force: true` to cascade-delete run history) |
| `keepergate_duplicate_workflow` | Clone a workflow |

---

## Troubleshooting

**`plugins.entries.keepergate: Unrecognized keys: "apiKey", "baseUrl"`**

OpenClaw rejects plugin-specific config keys before the plugin is installed. Install the plugin first (Step 2), then add config. Use env vars as an alternative — `KEEPERHUB_API_KEY` is always respected.

**`plugins.allow is empty; discovered non-bundled plugins may auto-load`**

Add `"allow": ["keepergate"]` under `"plugins"` in `~/.openclaw/openclaw.json` and restart the gateway.

**`plugin load failed: keepergate: invalid config: apiKey: must have required property 'apiKey'`**

Pass `KEEPERHUB_API_KEY=kh_...` as an env var when running the install command. The schema validator runs before your config is applied.

**Token mismatch on dashboard**

The gateway uses the token from whichever `openclaw.json` it loaded at startup. Check which config is active with `openclaw gateway status` (look for `Config (service):`) and use the token from that file.

**Plugin shows `(anonymous)` tools**

This is expected — the plugin uses a lazy factory pattern where tools are registered per-invocation. The tools are still available to the agent; they just don't have static names at inspection time.
