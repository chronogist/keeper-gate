import type {
  CreateWorkflowInput,
  ExecuteResponse,
  ExecutionLogsResponse,
  ExecutionResult,
  ExecutionStatusResponse,
  UpdateWorkflowInput,
  Workflow,
} from "./types.js";

export interface KeeperHubClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const TERMINAL_STATUSES = new Set([
  "success",
  "error",
  "cancelled",
  "completed",
  "failed",
]);

export class KeeperHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "KeeperHubError";
  }
}

export class KeeperHubClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: KeeperHubClientOptions) {
    if (!opts.apiKey) throw new Error("KeeperHubClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://app.keeperhub.com/api").replace(
      /\/$/,
      ""
    );
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /**
   * Low-level request escape hatch. Used by DirectExecutor and any caller
   * that needs to hit an endpoint not yet wrapped by a typed method.
   */
  async rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, init);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const msg =
        (body && typeof body === "object" && "error" in body
          ? JSON.stringify((body as { error: unknown }).error)
          : res.statusText) || `HTTP ${res.status}`;
      throw new KeeperHubError(`${path} → ${msg}`, res.status, body);
    }
    return body as T;
  }

  listWorkflows(): Promise<Workflow[]> {
    return this.request<Workflow[]>("/workflows");
  }

  getWorkflow(workflowId: string): Promise<Workflow> {
    return this.request<Workflow>(`/workflows/${workflowId}`);
  }

  /**
   * Create a new workflow. KeeperHub's create endpoint requires nodes and
   * edges; if the caller doesn't supply them we send a default Manual trigger
   * node and empty edges so the call still succeeds. Callers that want a
   * real workflow shape can either pass nodes/edges here or follow up with
   * updateWorkflow.
   */
  createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    const body = {
      name: input.name,
      description: input.description ?? "",
      projectId: input.projectId,
      nodes: input.nodes ?? [
        {
          id: "trigger-1",
          type: "trigger",
          data: {
            type: "trigger",
            label: "",
            description: "",
            status: "idle",
            config: { triggerType: "Manual" },
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: input.edges ?? [],
    };
    return this.request<Workflow>("/workflows/create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing workflow. Pass only the fields you want to change.
   * Sending a full nodes/edges array replaces the current ones in their
   * entirety -- this endpoint is not a partial-graph patch.
   */
  updateWorkflow(
    workflowId: string,
    input: UpdateWorkflowInput
  ): Promise<Workflow> {
    return this.request<Workflow>(`/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  /**
   * Delete a workflow. KeeperHub returns 409 if the workflow has execution
   * history; pass `force: true` to cascade-delete runs and logs along with
   * it. Returns the response body (shape varies; we keep it `unknown`).
   */
  deleteWorkflow(
    workflowId: string,
    opts: { force?: boolean } = {}
  ): Promise<unknown> {
    const qs = opts.force ? "?force=true" : "";
    return this.request<unknown>(`/workflows/${workflowId}${qs}`, {
      method: "DELETE",
    });
  }

  /**
   * Clone an existing workflow into a new one. Returns the new workflow.
   * Useful for the "find a similar workflow, duplicate, edit" pattern --
   * lighter cognitive load for an LLM than building from scratch.
   */
  duplicateWorkflow(workflowId: string): Promise<Workflow> {
    return this.request<Workflow>(`/workflows/${workflowId}/duplicate`, {
      method: "POST",
    });
  }

  executeWorkflow(
    workflowId: string,
    input: Record<string, unknown> = {}
  ): Promise<ExecuteResponse> {
    return this.request<ExecuteResponse>(`/workflow/${workflowId}/execute`, {
      method: "POST",
      body: JSON.stringify({ input }),
    });
  }

  getExecutionStatus(executionId: string): Promise<ExecutionStatusResponse> {
    return this.request<ExecutionStatusResponse>(
      `/workflows/executions/${executionId}/status`
    );
  }

  async getExecutionLogs(executionId: string): Promise<ExecutionLogsResponse> {
    const res = await this.request<unknown>(
      `/workflows/executions/${executionId}/logs`
    );
    // The API ships several shapes: bare array, {data: [...]}, or {execution, logs: [...]}.
    if (Array.isArray(res)) return { data: res as ExecutionLogsResponse["data"] };
    if (res && typeof res === "object") {
      const obj = res as Record<string, unknown>;
      if (Array.isArray(obj.logs)) return { data: obj.logs as ExecutionLogsResponse["data"] };
      if (Array.isArray(obj.data)) return { data: obj.data as ExecutionLogsResponse["data"] };
    }
    return { data: [] };
  }

  async pollUntilDone(
    executionId: string,
    opts: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<ExecutionResult> {
    const intervalMs = opts.intervalMs ?? 1000;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const startedAt = Date.now();

    while (true) {
      const status = await this.getExecutionStatus(executionId);
      if (TERMINAL_STATUSES.has(status.status)) {
        const logs = await this.getExecutionLogs(executionId).catch(() => ({
          data: [],
        }));
        return {
          executionId,
          status: status.status,
          logs: logs.data ?? [],
        };
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Execution ${executionId} did not complete within ${timeoutMs}ms (last status: ${status.status})`
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
