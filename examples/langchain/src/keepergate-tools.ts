import { tool } from "@langchain/core/tools";
import { z } from "zod";

const BASE_URL = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com/api";
const API_KEY = process.env.KEEPERHUB_API_KEY ?? "";

const TERMINAL_STATUSES = new Set(["success", "error", "cancelled", "completed", "failed"]);

async function khFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ? JSON.stringify(body.error) : res.statusText;
    throw new Error(`KeeperHub ${path} → ${res.status} ${msg}`);
  }

  return res.json();
}

async function pollUntilDone(
  executionId: string,
  timeoutMs = 60_000
): Promise<{ status: string; logs: unknown[] }> {
  const intervalMs = 1500;
  const startedAt = Date.now();

  while (true) {
    const statusRes = await khFetch(`/workflows/executions/${executionId}/status`);
    if (TERMINAL_STATUSES.has(statusRes.status)) {
      const logsRes = await khFetch(`/workflows/executions/${executionId}/logs`).catch(() => ({ data: [] }));
      const logs = Array.isArray(logsRes) ? logsRes : logsRes?.logs ?? logsRes?.data ?? [];
      return { status: statusRes.status, logs };
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Execution ${executionId} timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const listWorkflowsTool = tool(
  async () => {
    const workflows = await khFetch("/workflows");
    const summary = (Array.isArray(workflows) ? workflows : []).map((w: Record<string, unknown>) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? "",
      updatedAt: w.updatedAt ?? w.createdAt ?? "",
    }));
    return JSON.stringify(summary);
  },
  {
    name: "keepergate_list_workflows",
    description: "List all KeeperHub workflows in the user's account. Returns id, name, description, and last updated date.",
    schema: z.object({}),
  }
);

export const getWorkflowTool = tool(
  async ({ workflowId }: { workflowId: string }) => {
    const workflow = await khFetch(`/workflows/${workflowId}`);
    return JSON.stringify(workflow);
  },
  {
    name: "keepergate_get_workflow",
    description: "Get full details of a specific KeeperHub workflow by its ID, including nodes and edges.",
    schema: z.object({
      workflowId: z.string().describe("The workflow ID"),
    }),
  }
);

export const runWorkflowTool = tool(
  async ({ workflowId, input, timeoutMs }: { workflowId: string; input?: Record<string, unknown>; timeoutMs?: number }) => {
    const execRes = await khFetch(`/workflow/${workflowId}/execute`, {
      method: "POST",
      body: JSON.stringify({ input: input ?? {} }),
    });

    const executionId: string = execRes.executionId ?? execRes.runId;
    if (!executionId) return JSON.stringify({ error: "No executionId returned", raw: execRes });

    const result = await pollUntilDone(executionId, timeoutMs ?? 60_000);
    const logs = (result.logs as Record<string, unknown>[]).map((l) => ({
      node: l.nodeName ?? l.nodeId,
      status: l.status,
      output: l.output ?? null,
      error: (l as { error?: string }).error ?? null,
    }));

    return JSON.stringify({ executionId, status: result.status, logs });
  },
  {
    name: "keepergate_run_workflow",
    description: "Execute a KeeperHub workflow by ID and wait for it to finish. Optionally pass input values for the trigger.",
    schema: z.object({
      workflowId: z.string().describe("The workflow ID to execute"),
      input: z.record(z.unknown()).optional().describe("Optional trigger input key-value pairs"),
      timeoutMs: z.number().optional().describe("Max wait time in ms (default 60000)"),
    }),
  }
);

export const createWorkflowTool = tool(
  async ({ name, description, projectId }: { name: string; description?: string; projectId?: string }) => {
    const workflow = await khFetch("/workflows/create", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description ?? "",
        ...(projectId ? { projectId } : {}),
        nodes: [
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
        edges: [],
      }),
    });
    return JSON.stringify({ id: workflow.id, name: workflow.name, description: workflow.description });
  },
  {
    name: "keepergate_create_workflow",
    description: "Create a new empty KeeperHub workflow with a given name and optional description.",
    schema: z.object({
      name: z.string().describe("Name of the new workflow"),
      description: z.string().optional().describe("Optional description"),
      projectId: z.string().optional().describe("Optional project ID to assign the workflow to"),
    }),
  }
);

export const updateWorkflowTool = tool(
  async ({ workflowId, name, description, visibility }: {
    workflowId: string;
    name?: string;
    description?: string;
    visibility?: string;
  }) => {
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (visibility !== undefined) updates.visibility = visibility;

    const workflow = await khFetch(`/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return JSON.stringify({ id: workflow.id, name: workflow.name, description: workflow.description });
  },
  {
    name: "keepergate_update_workflow",
    description: "Update a KeeperHub workflow's name, description, or visibility.",
    schema: z.object({
      workflowId: z.string().describe("The workflow ID to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      visibility: z.string().optional().describe("New visibility (e.g. 'public' or 'private')"),
    }),
  }
);

export const deleteWorkflowTool = tool(
  async ({ workflowId, force }: { workflowId: string; force?: boolean }) => {
    await khFetch(`/workflows/${workflowId}${force ? "?force=true" : ""}`, { method: "DELETE" });
    return JSON.stringify({ deleted: true, workflowId });
  },
  {
    name: "keepergate_delete_workflow",
    description: "Delete a KeeperHub workflow by ID. Use force=true if the workflow has execution history.",
    schema: z.object({
      workflowId: z.string().describe("The workflow ID to delete"),
      force: z.boolean().optional().describe("Set true to force-delete even if execution history exists"),
    }),
  }
);

export const duplicateWorkflowTool = tool(
  async ({ workflowId }: { workflowId: string }) => {
    const workflow = await khFetch(`/workflows/${workflowId}/duplicate`, { method: "POST" });
    return JSON.stringify({ id: workflow.id, name: workflow.name });
  },
  {
    name: "keepergate_duplicate_workflow",
    description: "Duplicate an existing KeeperHub workflow. Returns the new cloned workflow.",
    schema: z.object({
      workflowId: z.string().describe("The workflow ID to duplicate"),
    }),
  }
);

export const getExecutionStatusTool = tool(
  async ({ executionId }: { executionId: string }) => {
    const status = await khFetch(`/workflows/executions/${executionId}/status`);
    return JSON.stringify(status);
  },
  {
    name: "keepergate_get_execution_status",
    description: "Check the status of a previously triggered KeeperHub workflow execution.",
    schema: z.object({
      executionId: z.string().describe("The execution ID returned when the workflow was run"),
    }),
  }
);

export const allKeeperGateTools = [
  listWorkflowsTool,
  getWorkflowTool,
  runWorkflowTool,
  createWorkflowTool,
  updateWorkflowTool,
  deleteWorkflowTool,
  duplicateWorkflowTool,
  getExecutionStatusTool,
];
