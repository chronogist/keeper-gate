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
