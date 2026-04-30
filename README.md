# KeeperGate

> The universal adapter that drops [KeeperHub](https://keeperhub.com)'s on-chain execution layer into any agent framework — in 3 lines.

**LangChain:**

```ts
const tools = await new KeeperGateToolkit({ apiKey }).getTools();
const agent = createReactAgent({ llm, tools });
```

**ElizaOS:**

```ts
const character = {
  ...,
  plugins: [createKeepergatePlugin({ apiKey })],
};
```

That's the whole integration. Any LangChain or ElizaOS agent now has reliable on-chain execution — retries, gas optimization, audit trails — without writing a line of HTTP / RPC / tx-sending code.

---

## Why this exists

KeeperHub is the execution and reliability layer for AI agents operating on-chain. Their docs say *"Official SDKs are planned for future release"* — meanwhile every LangChain / ElizaOS / CrewAI dev who wants to use KeeperHub has to hand-roll the same REST client, polling loop, and tool-wrapping boilerplate.

KeeperGate is that boilerplate, written once. **One framework-agnostic core, thin per-framework adapters, every agent dev gets KeeperHub for free.**

## Architecture

```
                            +-------------------+
                            |  @keepergate/core |
                            |                   |
                            |  KeeperHubClient  |  REST wrapper (auth, errors, polling)
                            |  DirectExecutor   |  /api/execute/* — sync on-chain ops
                            |  WorkflowTool     |  workflow-as-callable-tool
                            |  template-refs    |  schema inference from {{@trigger.X}}
                            +---------+---------+
                                      |
                  +-------------------+--------------------+
                  |                                        |
        +---------v----------+                  +----------v---------+
        | @keepergate/       |                  | @keepergate/       |
        |   langchain        |                  |   elizaos          |
        |                    |                  |                    |
        | StructuredTool[]   |                  | Plugin + Action[]  |
        +--------------------+                  +--------------------+
```

The hard work — auth, error handling, polling, schema inference, response-shape normalization — lives once in `core`. Each adapter is ~100 lines that translate the same `WorkflowTool` / `DirectExecutor` shape into its framework's native tool contract. Add a new framework adapter, get the entire surface for free.

## What an agent gets — six capabilities

Each capability ships as a tool in LangChain and an action in ElizaOS, mapping to the same `DirectExecutor` / `KeeperHubClient` underneath.

| Category | LangChain tool | ElizaOS action | What it does |
|---|---|---|---|
| Direct | `keepergate_transfer` | `KEEPERGATE_TRANSFER` | Native + ERC-20 transfers |
| Direct | `keepergate_call_contract` | `KEEPERGATE_CALL_CONTRACT` | Read or write any contract; auto-fetches ABI |
| Direct | `keepergate_check_and_execute` | `KEEPERGATE_CHECK_AND_EXECUTE` | Atomic read → condition → conditional write |
| Direct | `keepergate_get_execution_status` | `KEEPERGATE_GET_EXECUTION_STATUS` | Look up tx hash + explorer link for a previous write |
| Workflow | `keepergate_list_workflows` | `KEEPERGATE_LIST_WORKFLOWS` | Discover workflows the user pre-built in the KeeperHub UI |
| Workflow | `keepergate_run_workflow` | `KEEPERGATE_RUN_WORKFLOW` | Trigger a workflow by id, poll to terminal status |

Every operation runs through KeeperHub's execution layer — the agent inherits retries, gas optimization, MEV protection, and full audit trails with no extra wiring.

## Quick start

```bash
git clone https://github.com/chronogist/keeper-gate.git
cd keeper-gate
pnpm install
cp .env.example .env
# Edit .env: KEEPERHUB_API_KEY=kh_...  OPENROUTER_API_KEY=sk-or-v1-...
```

### Run the live LLM agent demo

```bash
pnpm --filter langchain-demo start
```

Reads vitalik.eth's USDC balance through a real LLM (gpt-oss-20b on OpenRouter) picking our `keepergate_call_contract` tool autonomously. Output looks like:

```
[user]      What is the USDC balance of vitalik.eth on Ethereum?
[ai → tool] keepergate_call_contract({"network":"ethereum","contractAddress":"0xA0b...","functionName":"balanceOf",...})
[tool ←]    {"kind":"read","result":"120133626066"}
[ai]        The USDC balance of vitalik.eth on Ethereum mainnet is 120,133.626066 USDC.

✅ demo run complete
```

### Run the smoke tests

Verifies adapters are wired correctly against the live KeeperHub API.

```bash
pnpm --filter @keepergate/core smoke              # workflows API path
pnpm --filter @keepergate/core smoke:direct       # direct execution API path
pnpm --filter @keepergate/langchain smoke         # 4 tools through LangChain's StructuredTool interface
pnpm --filter @keepergate/elizaos smoke           # plugin shape + 6 actions + validate() paths
```

## Use it in your own agent

### LangChain

```ts
import { KeeperGateToolkit } from "@keepergate/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const toolkit = new KeeperGateToolkit({ apiKey: process.env.KEEPERHUB_API_KEY! });
const tools = await toolkit.getTools();

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools,
});

await agent.invoke({
  messages: [{
    role: "user",
    content: "Check my USDC balance on Base. If it's over $100, run my rebalance workflow.",
  }],
});
```

The agent figures out the multi-step flow on its own:
1. `keepergate_call_contract` to read the balance
2. `keepergate_list_workflows` to find "rebalance"
3. `keepergate_run_workflow` to trigger it

### ElizaOS

```ts
import { createKeepergatePlugin } from "@keepergate/elizaos";

const character = {
  name: "Treasury",
  // ...character config
  plugins: [createKeepergatePlugin({ apiKey: process.env.KEEPERHUB_API_KEY! })],
};
```

Or via `character.json` with the static plugin form:

```jsonc
{
  "plugins": ["@keepergate/elizaos"],
  "settings": { "secrets": { "KEEPERHUB_API_KEY": "kh_..." } }
}
```

The plugin's `init` hook reads the API key from plugin config / runtime settings / env and registers all six actions on the runtime.

## Repo layout

```
keeper-gate/
├── packages/
│   ├── core/             # @keepergate/core — framework-agnostic engine
│   ├── langchain/        # @keepergate/langchain — LangChain adapter
│   └── elizaos/          # @keepergate/elizaos — ElizaOS plugin
└── examples/
    └── langchain-demo/   # runnable LLM-driven agent demo
```

## Tech stack

- **TypeScript 5** with strict + `noUncheckedIndexedAccess`
- **pnpm workspace** monorepo
- **Zod** for tool schemas (with per-field `.describe()` so the LLM gets argument-level hints)
- **`@langchain/core`** for the `tool()` factory and `StructuredTool` shape
- **`@elizaos/core`** v1.7+ for `Plugin`, `Action`, `runtime.useModel`, `parseKeyValueXml`
- **OpenRouter** for the demo LLM (any OpenAI-compatible endpoint works)

## What's been verified live against KeeperHub

| Capability | Verified by |
|---|---|
| Auth (`Bearer kh_...`) | every smoke + demo run |
| List workflows | `pnpm --filter @keepergate/core smoke` |
| Execute workflow + poll to terminal status | same |
| Read per-node logs (real `{execution, logs}` shape) | same |
| Schema inference from `{{@trigger.X}}` template refs | same |
| Direct contract read against mainnet | `pnpm --filter @keepergate/core smoke:direct` |
| Tools callable through LangChain `.invoke()` | `pnpm --filter @keepergate/langchain smoke` |
| `KeeperGateToolkit.include` filter restricts the tool surface | same smoke |
| Real LLM (gpt-oss-20b) picks tool, fills args, calls KeeperHub, reports answer | `pnpm --filter langchain-demo start` |
| ElizaOS plugin instantiates with all 6 actions, shape-correct, `validate()` paths green | `pnpm --filter @keepergate/elizaos smoke` |

## Findings while building

We hit a critical KeeperHub runtime bug while integrating: **`{{@trigger.X}}` template references aren't resolved at runtime** for Web3 actions, breaking the *"agent passes args into a Manual-trigger workflow"* path. We tested both `{{@trigger.address}}` and `{{@trigger.data.address}}` — both pass through to the contract validator as literal strings.

This pivoted the LangChain adapter to lean primarily on the **Direct Execution API** (`/api/execute/*`), which is unaffected by the bug. Workflow tools are still exposed for parameter-less workflows. Full reproduction steps and other findings are tracked locally for the Builder Feedback Bounty submission.

## Project info

- **Name:** KeeperGate
- **Repo:** [github.com/chronogist/keeper-gate](https://github.com/chronogist/keeper-gate)
- **Maintainer:** chronogist ([@chronogist](https://github.com/chronogist))
- **License:** Apache 2.0 (matching KeeperHub)
- **Built for:** the KeeperHub Best Integration bounty (Focus Area 2 — Agent frameworks)
