import { isReadResult, type DirectExecutor } from "@keepergate/core";
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { extractArgs } from "./extract.js";

const TRANSFER_TEMPLATE = `The user wants to send tokens. Extract:
<network>chain id or name (ethereum, base, arbitrum, polygon, etc)</network>
<recipientAddress>destination 0x... address</recipientAddress>
<amount>decimal string, e.g. 0.1</amount>
<tokenAddress>ERC-20 contract address, or empty for native token</tokenAddress>`;

const CALL_CONTRACT_TEMPLATE = `The user wants to read or write a smart contract. Extract:
<network>chain id or name</network>
<contractAddress>0x... contract address</contractAddress>
<functionName>function to call</functionName>
<functionArgs>JSON array of arguments, e.g. ["0x...","1000"], or empty if none</functionArgs>`;

const STATUS_TEMPLATE = `The user wants the status of a previous transaction. Extract:
<executionId>the executionId returned earlier</executionId>`;

const CHECK_AND_EXECUTE_TEMPLATE = `The user wants conditional execution -- read a value, then write if a condition holds. Extract:
<network>chain id or name</network>
<contractAddress>contract to read from</contractAddress>
<functionName>read function name</functionName>
<functionArgs>JSON args for the read</functionArgs>
<operator>one of: eq, neq, gt, lt, gte, lte</operator>
<targetValue>value to compare against (string)</targetValue>
<actionContractAddress>contract to write to if condition met</actionContractAddress>
<actionFunctionName>write function name</actionFunctionName>
<actionFunctionArgs>JSON args for the write</actionFunctionArgs>`;

const HAS_INTENT = (m: Memory, words: string[]): boolean => {
  const text = (m.content?.text ?? "").toLowerCase();
  return words.some((w) => text.includes(w));
};

export function buildDirectActions(executor: DirectExecutor): Action[] {
  const transferAction: Action = {
    name: "KEEPERGATE_TRANSFER",
    similes: ["SEND_TOKENS", "SEND_ETH", "TRANSFER_TOKENS", "PAY"],
    description:
      "Send native tokens (ETH/MATIC/etc.) or ERC-20 tokens via KeeperHub's reliable execution layer with retries and gas optimization.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["send", "transfer", "pay"]),
    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      state: State | undefined,
      _options,
      callback: HandlerCallback | undefined
    ): Promise<ActionResult> => {
      const args = await extractArgs<{
        network: string;
        recipientAddress: string;
        amount: string;
        tokenAddress?: string;
      }>(runtime, message, state, TRANSFER_TEMPLATE);
      if (!args?.network || !args.recipientAddress || !args.amount) {
        return {
          success: false,
          text: "Could not extract transfer parameters from the message.",
        };
      }
      try {
        const result = await executor.transfer({
          network: args.network,
          recipientAddress: args.recipientAddress,
          amount: args.amount,
          tokenAddress: args.tokenAddress || undefined,
        });
        const text = `Transfer submitted on ${args.network}. executionId: ${result.executionId}, status: ${result.status}.`;
        await callback?.({ text, actions: ["KEEPERGATE_TRANSFER"] });
        return {
          success: true,
          text,
          values: { executionId: result.executionId, status: result.status },
          data: { result },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] transfer failed");
        return {
          success: false,
          text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        { name: "{{user}}", content: { text: "Send 0.01 ETH to 0xabc..." } },
        {
          name: "{{agent}}",
          content: {
            text: "Submitting transfer via KeeperHub...",
            actions: ["KEEPERGATE_TRANSFER"],
          },
        },
      ],
    ],
  };

  const callContractAction: Action = {
    name: "KEEPERGATE_CALL_CONTRACT",
    similes: ["READ_CONTRACT", "WRITE_CONTRACT", "CALL_CONTRACT"],
    description:
      "Call any smart contract function via KeeperHub. Auto-detects read vs. write; ABI is auto-fetched from the block explorer if not provided.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, [
        "call",
        "read",
        "write",
        "balance",
        "contract",
        "function",
      ]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback
    ): Promise<ActionResult> => {
      const args = await extractArgs<{
        network: string;
        contractAddress: string;
        functionName: string;
        functionArgs?: string;
      }>(runtime, message, state, CALL_CONTRACT_TEMPLATE);
      if (!args?.network || !args.contractAddress || !args.functionName) {
        return {
          success: false,
          text: "Could not extract contract call parameters from the message.",
        };
      }
      try {
        const res = await executor.callContract({
          network: args.network,
          contractAddress: args.contractAddress,
          functionName: args.functionName,
          functionArgs: args.functionArgs || undefined,
        });
        const text = isReadResult(res)
          ? `Read ${args.functionName} on ${args.contractAddress}: ${res.result}`
          : `Wrote ${args.functionName} on ${args.contractAddress}. executionId: ${res.executionId}`;
        await callback?.({ text, actions: ["KEEPERGATE_CALL_CONTRACT"] });
        return {
          success: true,
          text,
          values: isReadResult(res)
            ? { result: res.result }
            : { executionId: res.executionId, status: res.status },
          data: { res },
        };
      } catch (err) {
        return {
          success: false,
          text: `Contract call failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "What is the USDC balance of 0xd8d... on Ethereum?" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Reading balanceOf via KeeperHub...",
            actions: ["KEEPERGATE_CALL_CONTRACT"],
          },
        },
      ],
    ],
  };

  const checkAndExecuteAction: Action = {
    name: "KEEPERGATE_CHECK_AND_EXECUTE",
    similes: ["CONDITIONAL_EXECUTE", "STOP_LOSS", "TAKE_PROFIT"],
    description:
      "Atomically read a contract value, evaluate a condition, and conditionally execute a write call. Useful for stop-loss, take-profit, threshold-triggered automations.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["if", "when", "stop loss", "take profit", "below", "above"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback
    ): Promise<ActionResult> => {
      const a = await extractArgs<{
        network: string;
        contractAddress: string;
        functionName: string;
        functionArgs?: string;
        operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
        targetValue: string;
        actionContractAddress: string;
        actionFunctionName: string;
        actionFunctionArgs?: string;
      }>(runtime, message, state, CHECK_AND_EXECUTE_TEMPLATE);
      if (
        !a?.network ||
        !a.contractAddress ||
        !a.functionName ||
        !a.operator ||
        !a.targetValue ||
        !a.actionContractAddress ||
        !a.actionFunctionName
      ) {
        return {
          success: false,
          text: "Could not extract conditional-execution parameters.",
        };
      }
      try {
        const res = await executor.checkAndExecute({
          network: a.network,
          contractAddress: a.contractAddress,
          functionName: a.functionName,
          functionArgs: a.functionArgs || undefined,
          condition: { operator: a.operator, value: a.targetValue },
          action: {
            network: a.network,
            contractAddress: a.actionContractAddress,
            functionName: a.actionFunctionName,
            functionArgs: a.actionFunctionArgs || undefined,
          },
        });
        const text = res.executed
          ? `Condition met (${a.operator} ${a.targetValue}). Wrote ${a.actionFunctionName}. executionId: ${res.executionId}.`
          : `Condition not met. No write executed.`;
        await callback?.({ text, actions: ["KEEPERGATE_CHECK_AND_EXECUTE"] });
        return {
          success: true,
          text,
          values: { executed: res.executed, executionId: res.executionId },
          data: { res },
        };
      } catch (err) {
        return {
          success: false,
          text: `check-and-execute failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: "If USDC.balanceOf(0xabc) > 1000, send 100 USDC to 0xdef on Base",
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Checking condition and executing if met...",
            actions: ["KEEPERGATE_CHECK_AND_EXECUTE"],
          },
        },
      ],
    ],
  };

  const getStatusAction: Action = {
    name: "KEEPERGATE_GET_EXECUTION_STATUS",
    similes: ["CHECK_TRANSACTION", "TX_STATUS", "EXECUTION_STATUS"],
    description:
      "Look up the status of a Direct Execution write by its executionId. Returns terminal status, transactionHash, transactionLink (block explorer URL), gas used, and any error.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["status", "did", "land", "confirmed", "tx", "transaction"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback
    ): Promise<ActionResult> => {
      const args = await extractArgs<{ executionId: string }>(
        runtime,
        message,
        state,
        STATUS_TEMPLATE
      );
      if (!args?.executionId) {
        return {
          success: false,
          text: "No executionId found in the message.",
        };
      }
      try {
        const status = await executor.getStatus(args.executionId);
        const link = status.transactionLink ? ` (${status.transactionLink})` : "";
        const text = `Status: ${status.status}. tx: ${status.transactionHash ?? "n/a"}${link}.`;
        await callback?.({
          text,
          actions: ["KEEPERGATE_GET_EXECUTION_STATUS"],
        });
        return {
          success: true,
          text,
          values: {
            status: status.status,
            transactionHash: status.transactionHash,
          },
          data: { status },
        };
      } catch (err) {
        return {
          success: false,
          text: `Status lookup failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "Did execution direct_abc123 land?" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Looking up status...",
            actions: ["KEEPERGATE_GET_EXECUTION_STATUS"],
          },
        },
      ],
    ],
  };

  return [
    transferAction,
    callContractAction,
    checkAndExecuteAction,
    getStatusAction,
  ];
}
