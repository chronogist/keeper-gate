import { tool } from "@langchain/core/tools";
import {
  type DirectExecutor,
  isReadResult,
} from "@keepergate/core";
import { z } from "zod";

const networkSchema = z
  .string()
  .describe(
    'Network name or chain id, e.g. "ethereum", "base", "arbitrum", "polygon", "8453".'
  );

const transferSchema = z.object({
  network: networkSchema,
  recipientAddress: z.string().describe("Destination wallet address (0x...)."),
  amount: z
    .string()
    .describe('Human-readable amount, e.g. "0.1" for 0.1 ETH or 0.1 tokens.'),
  tokenAddress: z
    .string()
    .nullish()
    .describe(
      "ERC-20 token contract address. Omit for native token (ETH/MATIC/etc.)."
    ),
  gasLimitMultiplier: z
    .string()
    .nullish()
    .describe('Gas limit multiplier, e.g. "1.2" for 20% buffer.'),
});

const callContractSchema = z.object({
  network: networkSchema,
  contractAddress: z.string().describe("Smart contract address (0x...)."),
  functionName: z.string().describe("Function name to call."),
  functionArgs: z
    .string()
    .nullish()
    .describe(
      'JSON array of arguments, e.g. \'["0x...", "1000"]\'. Omit if none.'
    ),
  abi: z
    .string()
    .nullish()
    .describe(
      "Contract ABI as JSON string. Omit to auto-fetch from block explorer."
    ),
  value: z
    .string()
    .nullish()
    .describe("Wei to send for payable functions."),
});

const statusSchema = z.object({
  executionId: z
    .string()
    .describe(
      "The executionId returned by a previous keepergate_transfer or keepergate_call_contract write call."
    ),
});

const checkAndExecuteSchema = z.object({
  network: networkSchema,
  contractAddress: z.string(),
  functionName: z
    .string()
    .describe("Read function whose return value is checked."),
  functionArgs: z.string().nullish(),
  abi: z.string().nullish(),
  condition: z
    .object({
      operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte"]),
      value: z.string().describe("Target value, as a stringified number."),
    })
    .describe("Condition to evaluate against the read return value."),
  action: z
    .object({
      network: networkSchema,
      contractAddress: z.string(),
      functionName: z.string(),
      functionArgs: z.string().nullish(),
      abi: z.string().nullish(),
      value: z.string().nullish(),
      gasLimitMultiplier: z.string().nullish(),
    })
    .describe("Write call to execute when the condition is met."),
});

/**
 * Build the LangChain StructuredTool[] surface for the Direct Execution API.
 * Each tool maps 1:1 to a DirectExecutor method, returns JSON-stringified
 * results (which is what LangChain agents expect for tool outputs).
 */
/** LLMs sometimes pass `null` for omitted optional args. Strip nulls. */
function compact<T>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as T;
}

export function buildDirectTools(executor: DirectExecutor) {
  const transferTool = tool(
    async (input) => {
      const res = await executor.transfer(
        compact(input) as Parameters<typeof executor.transfer>[0]
      );
      return JSON.stringify(res);
    },
    {
      name: "keepergate_transfer",
      description:
        "Transfer native tokens (ETH/MATIC/etc.) or ERC-20 tokens via KeeperHub's reliable execution layer. Handles retries, gas optimization, and audit trails. Returns an executionId and status.",
      schema: transferSchema,
    }
  );

  const callContractTool = tool(
    async (input) => {
      const res = await executor.callContract(
        compact(input) as Parameters<typeof executor.callContract>[0]
      );
      // Tag the response so the agent can tell read from write at a glance.
      const tagged = isReadResult(res)
        ? { kind: "read", ...res }
        : { kind: "write", ...res };
      return JSON.stringify(tagged);
    },
    {
      name: "keepergate_call_contract",
      description:
        "Call any smart contract function. Auto-detects read vs. write. Read calls return the value synchronously; write calls execute via KeeperHub and return an executionId. ABI is auto-fetched from the block explorer if omitted.",
      schema: callContractSchema,
    }
  );

  const checkAndExecuteTool = tool(
    async (input) => {
      const cleaned = {
        ...compact(input),
        action: compact(input.action),
      } as Parameters<typeof executor.checkAndExecute>[0];
      const res = await executor.checkAndExecute(cleaned);
      return JSON.stringify(res);
    },
    {
      name: "keepergate_check_and_execute",
      description:
        "Read a contract value, evaluate a condition, and conditionally execute a write call — all in one atomic on-chain check. Useful for stop-loss, take-profit, threshold-triggered automations.",
      schema: checkAndExecuteSchema,
    }
  );

  const getStatusTool = tool(
    async (input) => {
      const status = await executor.getStatus(input.executionId);
      return JSON.stringify(status);
    },
    {
      name: "keepergate_get_execution_status",
      description:
        "Look up the status of a Direct Execution write (transfer, contract write, or check-and-execute action) by its executionId. Returns the terminal status, transactionHash, transactionLink (block explorer URL), gas used, and any error. Use this after a write call when you need to confirm the transaction landed or fetch the explorer link.",
      schema: statusSchema,
    }
  );

  return [
    transferTool,
    callContractTool,
    checkAndExecuteTool,
    getStatusTool,
  ] as const;
}
