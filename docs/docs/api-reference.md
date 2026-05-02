---
sidebar_position: 5
title: API Reference
---

# API Reference

This page lists all 10 tools KeeperGate exposes, with their inputs and outputs. The same capabilities are available in every framework — only the names differ slightly per convention.

## Tool names by framework

| Capability | LangChain / OpenClaw | ElizaOS |
|---|---|---|
| Transfer tokens | `keepergate_transfer` | `KEEPERGATE_TRANSFER` |
| Call a contract | `keepergate_call_contract` | `KEEPERGATE_CALL_CONTRACT` |
| Conditional execute | `keepergate_check_and_execute` | `KEEPERGATE_CHECK_AND_EXECUTE` |
| Get execution status | `keepergate_get_execution_status` | `KEEPERGATE_GET_EXECUTION_STATUS` |
| List workflows | `keepergate_list_workflows` | `KEEPERGATE_LIST_WORKFLOWS` |
| Run a workflow | `keepergate_run_workflow` | `KEEPERGATE_RUN_WORKFLOW` |
| Create a workflow | `keepergate_create_workflow` | `KEEPERGATE_CREATE_WORKFLOW` |
| Update a workflow | `keepergate_update_workflow` | `KEEPERGATE_UPDATE_WORKFLOW` |
| Delete a workflow | `keepergate_delete_workflow` | `KEEPERGATE_DELETE_WORKFLOW` |
| Duplicate a workflow | `keepergate_duplicate_workflow` | `KEEPERGATE_DUPLICATE_WORKFLOW` |

---

## Direct Execution tools

### transfer

Send native tokens (ETH, BNB, etc.) or ERC-20 tokens.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `network` | string | Network name, e.g. `"ethereum"`, `"base"`, `"arbitrum"` |
| `to` | string | Recipient wallet address |
| `amount` | string | Amount to send as a string, e.g. `"0.1"` |
| `tokenAddress` | string (optional) | ERC-20 contract address. Omit for native transfers |

**Returns:** Transaction hash and explorer link.

---

### call_contract

Read from or write to any smart contract. The ABI is fetched automatically from the block explorer.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `network` | string | Network name, e.g. `"ethereum"`, `"base"` |
| `contractAddress` | string | The contract's address |
| `functionName` | string | The function to call, e.g. `"balanceOf"` |
| `args` | array (optional) | Arguments to pass to the function |
| `abi` | array (optional) | Provide manually if the contract is not verified on an explorer |

**Returns:** For reads: `{ kind: "read", result: <value> }`. For writes: `{ kind: "write", txHash: "0x..." }`.

---

### check_and_execute

Read a value, evaluate a condition, and execute a write only if the condition is true. Useful for stop-losses and take-profit logic.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `network` | string | Network name |
| `readContract` | object | Same fields as `call_contract` — the read step |
| `condition` | object | `{ operator: "gt" \| "lt" \| "eq" \| "gte" \| "lte", value: string }` |
| `executeContract` | object | Same fields as `call_contract` — the write step if condition passes |

**Returns:** `{ conditionMet: boolean, result?: <write result> }`.

---

### get_execution_status

Look up the result of a previous write operation by transaction hash.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `txHash` | string | The transaction hash from a previous `transfer` or `call_contract` write |
| `network` | string | Network where the transaction was submitted |

**Returns:** `{ status, txHash, explorerUrl, gasUsed }`.

---

## Workflow tools

### list_workflows

Return all workflows in the connected KeeperHub account.

**Inputs:** None.

**Returns:** Array of `{ id, name, description }`.

---

### run_workflow

Trigger a workflow and wait for it to reach a terminal status.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `workflowId` | string | The workflow ID from `list_workflows` |
| `inputs` | object (optional) | Key-value pairs passed as trigger inputs |

**Returns:** `{ status, executionId, logs }` where `status` is `"success"`, `"error"`, or `"cancelled"`.

---

### create_workflow

Create a new blank workflow.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name for the workflow |
| `description` | string (optional) | Short description |

**Returns:** `{ id, name, description }` for the newly created workflow.

---

### update_workflow

Modify an existing workflow. This replaces the workflow's node graph in full — partial updates are not supported.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `workflowId` | string | ID of the workflow to update |
| `name` | string (optional) | New name |
| `description` | string (optional) | New description |
| `nodes` | array (optional) | Full replacement node graph |
| `edges` | array (optional) | Full replacement edge list |

**Returns:** Updated workflow object.

---

### delete_workflow

Delete a workflow by ID.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `workflowId` | string | ID of the workflow to delete |
| `force` | boolean (optional) | If `true`, also deletes associated execution history |

**Returns:** Confirmation of deletion.

---

### duplicate_workflow

Clone an existing workflow. The copy is named `<original name> (Copy)`.

**Inputs:**

| Field | Type | Description |
|---|---|---|
| `workflowId` | string | ID of the workflow to clone |

**Returns:** `{ id, name, description }` for the new copy.

---

## Error format

All tools throw a `KeeperHubError` on failure:

```ts
{
  message: string;  // human-readable description
  status: number;   // HTTP status (401, 404, 500, etc.)
  body: unknown;    // raw response from KeeperHub
}
```

Common status codes:

| Status | Meaning |
|---|---|
| 401 | Invalid or missing API key |
| 404 | Workflow or resource not found |
| 422 | Invalid input (check your arguments) |
| 500 | KeeperHub internal error |
