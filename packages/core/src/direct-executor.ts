import type { KeeperHubClient } from "./client.js";
import type {
  DirectCheckAndExecuteInput,
  DirectCheckAndExecuteResult,
  DirectContractCallInput,
  DirectExecutionStatus,
  DirectReadResult,
  DirectTransferInput,
  DirectWriteResult,
} from "./types.js";

/**
 * DirectExecutor wraps KeeperHub's Direct Execution API — synchronous
 * blockchain operations that don't require a workflow definition.
 *
 * Unlike workflow execution, these endpoints accept all parameters explicitly
 * and skip the workflow engine entirely, making them the right surface for
 * agent tools that need to compose on-chain calls dynamically.
 *
 * All endpoints require an organization API key (kh_*).
 */
export class DirectExecutor {
  constructor(private readonly client: KeeperHubClient) {}

  /** Transfer native tokens (omit tokenAddress) or ERC-20 tokens. */
  transfer(input: DirectTransferInput): Promise<DirectWriteResult> {
    return this.client.rawRequest<DirectWriteResult>("/execute/transfer", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Call a smart contract function.
   *
   * Read functions (view/pure) return synchronously with `{ result }`.
   * Write functions return `{ executionId, status }` and execute synchronously.
   * Use `isReadResult` to discriminate at the call site.
   */
  callContract(
    input: DirectContractCallInput
  ): Promise<DirectReadResult | DirectWriteResult> {
    return this.client.rawRequest<DirectReadResult | DirectWriteResult>(
      "/execute/contract-call",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  /** Read a value, evaluate a condition, conditionally execute a write. */
  checkAndExecute(
    input: DirectCheckAndExecuteInput
  ): Promise<DirectCheckAndExecuteResult> {
    return this.client.rawRequest<DirectCheckAndExecuteResult>(
      "/execute/check-and-execute",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  /** Status of a direct execution by its id. */
  getStatus(executionId: string): Promise<DirectExecutionStatus> {
    return this.client.rawRequest<DirectExecutionStatus>(
      `/execute/${executionId}/status`
    );
  }
}

export function isReadResult(
  res: DirectReadResult | DirectWriteResult
): res is DirectReadResult {
  return "result" in res;
}
