# KeeperGate

A universal adapter that connects [KeeperHub](https://keeperhub.com)'s on-chain execution layer to any agent framework — LangChain, ElizaOS, OpenClaw, CrewAI — in one lightweight package.

> **Status:** day 1 scaffold. `@keepergate/core` smoke test working. Framework adapters next.

## Architecture

```
@keepergate/core              ← framework-agnostic engine
  ├── KeeperHubClient         ← REST wrapper (workflows, executions)
  ├── WorkflowTool            ← wraps a workflow as a callable tool
  └── template-refs           ← infers tool input schema from {{@trigger.field}}

@keepergate/langchain  (next) ← StructuredTool[] for LangChain
@keepergate/elizaos    (next) ← Action[] for ElizaOS
```

The trick: a workflow's input schema is **inferred** by scanning downstream action nodes for `{{@trigger.field}}` references. Zero UI work for the user — the schema *is* their workflow.

## Quick start

```bash
pnpm install
cp .env.example .env   # paste KEEPERHUB_API_KEY
pnpm smoke
```

The smoke test:
1. Lists your workflows (auth check)
2. Loads one as a `WorkflowTool` and prints the inferred input schema
3. Executes it, polls to completion, prints node-level logs

Set `KEEPERHUB_WORKFLOW_ID` to target a specific workflow, and `KEEPERHUB_SMOKE_INPUT` (JSON) to pass trigger inputs.
