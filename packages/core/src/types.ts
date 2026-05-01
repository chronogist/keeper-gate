export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "cancelled"
  | "completed"
  | "failed";

export interface WorkflowNode {
  id: string;
  type: "trigger" | "action" | "condition" | "forEach" | string;
  data?: {
    label?: string;
    description?: string;
    type?: string;
    config?: Record<string, unknown>;
    status?: string;
  };
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  visibility?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ExecuteResponse {
  executionId: string;
  runId?: string;
  status: ExecutionStatus;
}

export interface NodeStatus {
  nodeId: string;
  status: ExecutionStatus;
}

export interface ExecutionStatusResponse {
  status: ExecutionStatus;
  nodeStatuses?: NodeStatus[];
  progress?: {
    totalSteps: number;
    completedSteps: number;
    runningSteps: number;
    currentNodeId?: string;
    percentage: number;
  };
}

export interface ExecutionLogEntry {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  status: ExecutionStatus;
  input?: unknown;
  output?: unknown;
  duration?: number;
  createdAt?: string;
}

export interface ExecutionLogsResponse {
  data: ExecutionLogEntry[];
}

export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  logs: ExecutionLogEntry[];
}

// --- Direct Execution -------------------------------------------------------

export interface DirectTransferInput {
  /** Chain id or network name (e.g. "base", "ethereum", "8453"). */
  network: string;
  recipientAddress: string;
  /** Human-readable amount, e.g. "0.1". */
  amount: string;
  /** Omit for native tokens; set to ERC-20 contract for token transfers. */
  tokenAddress?: string;
  /** JSON string with token metadata for non-standard ERC-20s. */
  tokenConfig?: string;
  gasLimitMultiplier?: string;
}

export interface DirectContractCallInput {
  contractAddress: string;
  network: string;
  functionName: string;
  /** JSON-encoded array of args, e.g. '["0x...","1000"]'. */
  functionArgs?: string;
  /** ABI as JSON string. Auto-fetched from explorer if omitted. */
  abi?: string;
  /** Wei to send for payable functions. */
  value?: string;
  gasLimitMultiplier?: string;
}

export interface DirectCondition {
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
  value: string;
}

export interface DirectCheckAndExecuteInput
  extends DirectContractCallInput {
  condition: DirectCondition;
  action: DirectContractCallInput;
}

/**
 * Read-call result (synchronous return).
 *
 * KeeperHub returns either a bare value (string for primitive types like
 * uint256) or an object keyed by the ABI's named output fields. Both are
 * possible from the same endpoint depending on the function signature, so
 * callers should treat result as opaque and parse based on what they sent.
 */
export interface DirectReadResult {
  result: string | Record<string, unknown> | unknown[];
}

/** Write-call / transfer result (synchronous return). */
export interface DirectWriteResult {
  executionId: string;
  status: ExecutionStatus;
}

export interface DirectCheckAndExecuteResult {
  executed: boolean;
  executionId?: string;
  status?: ExecutionStatus;
  condition: {
    met: boolean;
    observedValue: string;
    targetValue: string;
    operator: DirectCondition["operator"];
  };
}

export interface DirectExecutionStatus {
  executionId: string;
  status: ExecutionStatus;
  type?: string;
  transactionHash?: string;
  transactionLink?: string;
  gasUsedWei?: string;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string;
}
