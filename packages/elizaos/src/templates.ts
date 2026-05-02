import type { WorkflowNode, WorkflowEdge } from "@keepergate/core";

// A template generates a complete {nodes, edges} pair for a KeeperHub
// workflow when supplied with its declared params. Keeping templates as code
// (rather than JSON) lets us compose dynamic ids, position layout, and
// templated cross-node references in one place.

export type ParamType = "string" | "number" | "address" | "cron" | "enum";

export interface ParamSpec {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
  enumValues?: string[];
  default?: string | number;
}

export interface WorkflowTemplate {
  id: string;
  title: string;
  summary: string;
  // Natural-language phrases the matcher should recognize. Used by the LLM
  // and a fallback keyword scorer to pick a template from a user request.
  keywords: string[];
  params: ParamSpec[];
  build: (params: Record<string, string>) => {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
}

// Small id helper so node ids look like the ones KeeperHub generates in the
// UI. Doesn't need cryptographic randomness — just collision-free within one
// workflow.
function nid(): string {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 5);
}

function eid(): string {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 5);
}

// KeeperHub's condition node config follows a structured rule-group format
// (see Safe Multisig template). This builds the simplest single-rule group.
function singleRuleConditionConfig(
  left: string,
  operator: string,
  right: string
) {
  return {
    group: {
      id: nid(),
      logic: "AND",
      rules: [
        {
          id: nid(),
          operator,
          leftOperand: left,
          rightOperand: right,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 1. balance-threshold-transfer
// Schedule trigger -> read ERC20 balance -> condition -> transfer ERC20
// ---------------------------------------------------------------------------

const balanceThresholdTransfer: WorkflowTemplate = {
  id: "balance-threshold-transfer",
  title: "Balance Threshold Transfer",
  summary:
    "On a schedule, check an ERC20 balance and transfer tokens to that address when it falls below (or rises above) a threshold.",
  keywords: [
    "airdrop",
    "top up",
    "topup",
    "refill",
    "refuel",
    "balance below",
    "balance under",
    "if balance",
    "send when",
    "transfer when",
    "drip",
    "auto fund",
    "auto-fund",
  ],
  params: [
    {
      name: "network",
      type: "string",
      required: true,
      description: "Chain id (e.g. 1 for ethereum mainnet, 11155111 for sepolia)",
    },
    {
      name: "tokenAddress",
      type: "address",
      required: true,
      description: "ERC20 token contract address being watched and transferred",
    },
    {
      name: "watchAddress",
      type: "address",
      required: true,
      description: "Address whose balance is monitored (and the recipient of the top-up)",
    },
    {
      name: "threshold",
      type: "string",
      required: true,
      description: "Threshold balance in human units (e.g. '21' for 21 USDC)",
    },
    {
      name: "comparator",
      type: "enum",
      required: false,
      enumValues: ["<", "<=", ">", ">=", "==", "!="],
      default: "<",
      description: "Comparison operator (default '<' = trigger when balance below threshold)",
    },
    {
      name: "transferAmount",
      type: "string",
      required: true,
      description: "Amount to transfer in human units (e.g. '10' for 10 USDC)",
    },
    {
      name: "recipient",
      type: "address",
      required: false,
      description: "Recipient of the transfer (defaults to watchAddress)",
    },
    {
      name: "cron",
      type: "cron",
      required: false,
      default: "*/5 * * * *",
      description: "Cron schedule (default every 5 minutes)",
    },
  ],
  build: (p) => {
    const triggerId = nid();
    const balanceId = nid();
    const conditionId = nid();
    const transferId = nid();
    const network = p.network ?? "1";
    const tokenAddress = p.tokenAddress ?? "";
    const watchAddress = p.watchAddress ?? "";
    const threshold = p.threshold ?? "0";
    const transferAmount = p.transferAmount ?? "0";
    const recipient = p.recipient || watchAddress;
    const cron = p.cron || "*/5 * * * *";
    const comparator = p.comparator || "<";

    const balanceRef = `{{@${balanceId}:Read Balance.balance}}`;

    const nodes: WorkflowNode[] = [
      {
        id: triggerId,
        type: "trigger",
        position: { x: 0, y: 200 },
        data: {
          type: "trigger",
          label: cron === "*/5 * * * *" ? "Every 5 Minutes" : "Schedule",
          description: "Polls on a cron schedule",
          status: "idle",
          config: {
            triggerType: "Schedule",
            scheduleCron: cron,
          },
        },
      },
      {
        id: balanceId,
        type: "action",
        position: { x: 300, y: 200 },
        data: {
          type: "action",
          label: "Read Balance",
          description: "Read ERC20 balance of the watched address",
          status: "idle",
          config: {
            actionType: "web3/get-erc20-balance",
            network,
            tokenAddress,
            address: watchAddress,
          },
        },
      },
      {
        id: conditionId,
        type: "action",
        position: { x: 600, y: 200 },
        data: {
          type: "action",
          label: "Check Threshold",
          description: `Trigger when balance ${comparator} ${threshold}`,
          status: "idle",
          config: {
            actionType: "Condition",
            condition: `${balanceRef} ${comparator} ${threshold}`,
            conditionConfig: singleRuleConditionConfig(
              balanceRef,
              comparator,
              threshold
            ),
          },
        },
      },
      {
        id: transferId,
        type: "action",
        position: { x: 900, y: 200 },
        data: {
          type: "action",
          label: "Transfer Tokens",
          description: `Transfer ${transferAmount} tokens to ${recipient}`,
          status: "idle",
          config: {
            actionType: "web3/transfer-erc20",
            network,
            tokenAddress,
            recipientAddress: recipient,
            amount: transferAmount,
          },
        },
      },
    ];

    const edges: WorkflowEdge[] = [
      {
        id: eid(),
        source: triggerId,
        target: balanceId,
      },
      {
        id: eid(),
        source: balanceId,
        target: conditionId,
      },
      {
        id: eid(),
        source: conditionId,
        target: transferId,
        sourceHandle: "true",
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TEMPLATES: WorkflowTemplate[] = [balanceThresholdTransfer];

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// Deterministic template picker. Scores each template by:
//   1. explicit keyword hits (e.g. "airdrop", "top up", "balance below")
//   2. structural pattern hits (a comparator + a token amount + an address)
// Returns the top-scoring template if it clears a minimum confidence bar,
// else null. The LLM-based picker is used only as a tiebreaker.
export function pickTemplate(userText: string): WorkflowTemplate | null {
  const text = userText.toLowerCase();
  if (!text.trim()) return null;

  let best: { tpl: WorkflowTemplate; score: number } | null = null;
  for (const tpl of TEMPLATES) {
    let score = 0;
    for (const kw of tpl.keywords) {
      if (text.includes(kw.toLowerCase())) score += 2;
    }
    // Pattern signals shared across balance-threshold templates.
    if (tpl.id === "balance-threshold-transfer") {
      const hasComparator =
        /(less than|under|below|<\s*\d|greater than|above|over|>\s*\d|more than)/i.test(
          text
        );
      const hasTransferVerb =
        /(send|transfer|deposit|drip|top.?up|fund|airdrop)/i.test(text);
      const hasBalanceWord = /(balance|holdings|amount)/i.test(text);
      const hasAddress = /0x[a-f0-9]{40}/i.test(text);
      if (hasComparator && hasTransferVerb) score += 4;
      if (hasBalanceWord) score += 2;
      if (hasAddress) score += 1;
    }
    if (!best || score > best.score) best = { tpl, score };
  }
  // Confidence threshold — at least one strong signal cluster.
  if (best && best.score >= 4) return best.tpl;
  return null;
}

export function describeTemplatesForLLM(): string {
  return TEMPLATES.map((t) => {
    const params = t.params
      .map((p) => {
        const tag = p.required ? "REQUIRED" : `optional${p.default !== undefined ? `, default=${p.default}` : ""}`;
        const enumPart = p.enumValues ? ` (one of: ${p.enumValues.join(", ")})` : "";
        return `    - ${p.name} (${p.type}, ${tag})${enumPart}: ${p.description}`;
      })
      .join("\n");
    return `  • ${t.id} — ${t.title}\n    ${t.summary}\n${params}`;
  }).join("\n\n");
}
