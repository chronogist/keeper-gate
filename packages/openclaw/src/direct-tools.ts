import { Type, type Static } from "typebox";
import {
  type DirectExecutor,
  isReadResult,
} from "@keepergate/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

const NETWORK_DESC =
  'Chain id or name (e.g. "ethereum", "base", or "42161" for Arbitrum).';

const transferSchema = Type.Object({
  network: Type.String({ description: NETWORK_DESC }),
  recipientAddress: Type.String({
    description: "Destination wallet address (0x...).",
  }),
  amount: Type.String({
    description: 'Human-readable amount, e.g. "0.1".',
  }),
  tokenAddress: Type.Optional(
    Type.String({
      description:
        "ERC-20 token contract address. Omit for native token.",
    })
  ),
  gasLimitMultiplier: Type.Optional(Type.String()),
});

const callContractSchema = Type.Object({
  network: Type.String({ description: NETWORK_DESC }),
  contractAddress: Type.String(),
  functionName: Type.String(),
  functionArgs: Type.Optional(
    Type.String({
      description:
        'JSON array of args, e.g. \'["0x...","1000"]\'. Omit if none.',
    })
  ),
  abi: Type.Optional(
    Type.String({
      description:
        "Contract ABI as JSON string. Omit to auto-fetch from explorer.",
    })
  ),
  value: Type.Optional(Type.String()),
});

const checkAndExecuteSchema = Type.Object({
  network: Type.String({ description: NETWORK_DESC }),
  contractAddress: Type.String(),
  functionName: Type.String({
    description: "Read function whose return value is checked.",
  }),
  functionArgs: Type.Optional(Type.String()),
  abi: Type.Optional(Type.String()),
  operator: Type.Union([
    Type.Literal("eq"),
    Type.Literal("neq"),
    Type.Literal("gt"),
    Type.Literal("lt"),
    Type.Literal("gte"),
    Type.Literal("lte"),
  ]),
  targetValue: Type.String({
    description: "Value to compare against (string).",
  }),
  actionContractAddress: Type.String(),
  actionFunctionName: Type.String(),
  actionFunctionArgs: Type.Optional(Type.String()),
});

const statusSchema = Type.Object({
  executionId: Type.String({
    description: "executionId returned by a previous transfer / write call.",
  }),
});

function jsonText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    details: payload as Record<string, unknown>,
  };
}

/**
 * Build the AnyAgentTool[] surface for the Direct Execution API.
 * Each tool wraps a DirectExecutor method with TypeBox parameters
 * (the schema dialect OpenClaw expects -- not Zod).
 */
export function buildDirectTools(executor: DirectExecutor): AnyAgentTool[] {
  const transferTool: AnyAgentTool = {
    name: "keepergate_transfer",
    label: "KeeperGate transfer",
    description:
      "Send native tokens or ERC-20 tokens via KeeperHub's reliable execution layer (retries, gas optimization, audit trails). Returns an executionId and status.",
    parameters: transferSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof transferSchema>;
      signal?.throwIfAborted?.();
      const res = await executor.transfer({
        network: args.network,
        recipientAddress: args.recipientAddress,
        amount: args.amount,
        tokenAddress: args.tokenAddress,
        gasLimitMultiplier: args.gasLimitMultiplier,
      });
      return jsonText(res);
    },
  };

  const callContractTool: AnyAgentTool = {
    name: "keepergate_call_contract",
    label: "KeeperGate call contract",
    description:
      "Call any smart contract function on any chain KeeperHub supports. Auto-detects read vs. write; ABI is auto-fetched from the block explorer if not provided.",
    parameters: callContractSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof callContractSchema>;
      signal?.throwIfAborted?.();
      const res = await executor.callContract({
        network: args.network,
        contractAddress: args.contractAddress,
        functionName: args.functionName,
        functionArgs: args.functionArgs,
        abi: args.abi,
        value: args.value,
      });
      const tagged = isReadResult(res)
        ? { kind: "read", ...res }
        : { kind: "write", ...res };
      return jsonText(tagged);
    },
  };

  const checkAndExecuteTool: AnyAgentTool = {
    name: "keepergate_check_and_execute",
    label: "KeeperGate check + execute",
    description:
      "Atomically read a contract value, evaluate a condition, and conditionally execute a write call. Useful for stop-loss, take-profit, threshold-triggered automations.",
    parameters: checkAndExecuteSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof checkAndExecuteSchema>;
      signal?.throwIfAborted?.();
      const res = await executor.checkAndExecute({
        network: args.network,
        contractAddress: args.contractAddress,
        functionName: args.functionName,
        functionArgs: args.functionArgs,
        abi: args.abi,
        condition: { operator: args.operator, value: args.targetValue },
        action: {
          network: args.network,
          contractAddress: args.actionContractAddress,
          functionName: args.actionFunctionName,
          functionArgs: args.actionFunctionArgs,
        },
      });
      return jsonText(res);
    },
  };

  const getStatusTool: AnyAgentTool = {
    name: "keepergate_get_execution_status",
    label: "KeeperGate execution status",
    description:
      "Look up the status, transactionHash, and explorer link of a previous Direct Execution write by its executionId.",
    parameters: statusSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof statusSchema>;
      signal?.throwIfAborted?.();
      const res = await executor.getStatus(args.executionId);
      return jsonText(res);
    },
  };

  return [transferTool, callContractTool, checkAndExecuteTool, getStatusTool];
}
