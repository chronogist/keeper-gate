# KeeperGate × LangChain Example

A LangChain ReAct agent wired to KeeperHub via KeeperGate. Ships in two modes: a **CLI chat** and a **streaming web UI**.

## Prerequisites

- Node.js 18+
- A KeeperHub API key (`kh_...`) — get one at [app.keeperhub.com](https://app.keeperhub.com) → Settings → API Keys
- An OpenAI-compatible LLM endpoint and key

---

## Setup

```bash
cd examples/langchain
npm install
cp .env .env.local   # or edit .env directly
```

Fill in `.env`:

```
KEEPERHUB_API_KEY=kh_your_key_here
KEEPERHUB_BASE_URL=https://app.keeperhub.com/api

OPENAI_API_KEY=your_llm_key
OPENAI_BASE_URL=https://ollama.com/v1
MODEL=gpt-oss:20b
```

Optional — enable LangSmith tracing:

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_langsmith_key
LANGCHAIN_PROJECT=langchain-agent
```

---

## CLI mode

```bash
npm start
```

Starts an interactive terminal chat. Type a message and press Enter. Type `exit` to quit.

```
You: List my KeeperHub workflows
Agent: [calls keepergate_list_workflows]
       You have 2 workflows: Weekly Rebalance (wf_abc123), Treasury Watch (wf_def456)

You: Run the Weekly Rebalance workflow
Agent: [calls keepergate_run_workflow]
       Execution complete. Status: success
```

---

## Web UI mode

```bash
npm run web
```

Starts an Express server at `http://localhost:3000`. Open it in a browser to chat with the agent. Tool calls are shown as they happen, and the agent's reply streams in token by token.

For auto-reload during development:

```bash
npm run web:dev
```

---

## How it works

All KeeperHub tools are defined in `src/keepergate-tools.ts` as plain LangChain `tool()` calls that hit the KeeperHub REST API directly using `fetch`. The agent is created with `createReactAgent` from `@langchain/langgraph`:

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { allKeeperGateTools } from "./keepergate-tools.js";

const agent = createReactAgent({
  llm,
  tools: [...allKeeperGateTools, calculator, getWeather],
});
```

The CLI (`src/index.ts`) and web server (`src/server.ts`) both use the same agent and tool set. The web server streams responses via Server-Sent Events (SSE).

---

## Available tools

| Tool | What it does |
|---|---|
| `keepergate_list_workflows` | List all workflows — returns id, name, description, last updated |
| `keepergate_get_workflow` | Get full details of a workflow by ID (includes nodes and edges) |
| `keepergate_run_workflow` | Execute a workflow by ID, polls until terminal status |
| `keepergate_create_workflow` | Create a new workflow with a manual trigger node |
| `keepergate_update_workflow` | Patch a workflow's name, description, or visibility |
| `keepergate_delete_workflow` | Delete a workflow; pass `force: true` to also delete execution history |
| `keepergate_duplicate_workflow` | Clone a workflow |
| `keepergate_get_execution_status` | Check the status of a triggered execution by executionId |
