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
    .optional()
    .describe(
      "ERC-20 token contract address. Omit for native token (ETH/MATIC/etc.)."
    ),
  gasLimitMultiplier: z
    .string()
    .optional()
    .describe('Gas limit multiplier, e.g. "1.2" for 20% buffer.'),
});

const callContractSchema = z.object({
  network: networkSchema,
  contractAddress: z.string().describe("Smart contract address (0x...)."),
  functionName: z.string().describe("Function name to call."),
  functionArgs: z
    .string()
    .optional()
    .describe(
      'JSON array of arguments, e.g. \'["0x...", "1000"]\'. Omit if none.'
    ),
  abi: z
    .string()
    .optional()
    .describe(
      "Contract ABI as JSON string. Omit to auto-fetch from block explorer."
    ),
  value: z
    .string()
    .optional()
    .describe("Wei to send for payable functions."),
});

const checkAndExecuteSchema = z.object({
  network: networkSchema,
  contractAddress: z.string(),
  functionName: z
    .string()
    .describe("Read function whose return value is checked."),
  functionArgs: z.string().optional(),
  abi: z.string().optional(),
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
      functionArgs: z.string().optional(),
      abi: z.string().optional(),
      value: z.string().optional(),
      gasLimitMultiplier: z.string().optional(),
    })
    .describe("Write call to execute when the condition is met."),
});

/**
 * Build the LangChain StructuredTool[] surface for the Direct Execution API.
 * Each tool maps 1:1 to a DirectExecutor method, returns JSON-stringified
 * results (which is what LangChain agents expect for tool outputs).
 */
export function buildDirectTools(executor: DirectExecutor) {
  const transferTool = tool(
    async (input) => {
      const res = await executor.transfer(input);
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
      const res = await executor.callContract(input);
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
      const res = await executor.checkAndExecute(input);
      return JSON.stringify(res);
    },
    {
      name: "keepergate_check_and_execute",
      description:
        "Read a contract value, evaluate a condition, and conditionally execute a write call — all in one atomic on-chain check. Useful for stop-loss, take-profit, threshold-triggered automations.",
      schema: checkAndExecuteSchema,
    }
  );

  return [transferTool, callContractTool, checkAndExecuteTool] as const;
}
