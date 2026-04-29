import type {
  ExecuteResponse,
  ExecutionLogsResponse,
  ExecutionResult,
  ExecutionStatusResponse,
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
    const res = await this.request<ExecutionLogsResponse | ExecutionLogsResponse["data"]>(
      `/workflows/executions/${executionId}/logs`
    );
    // The API has shipped both shapes ({data: [...]} and [...]). Normalize.
    if (Array.isArray(res)) return { data: res };
    return { data: res?.data ?? [] };
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
