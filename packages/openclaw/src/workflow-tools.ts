import { Type, type Static } from "typebox";
import type { KeeperHubClient } from "@keepergate/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

const listSchema = Type.Object({});

const runSchema = Type.Object({
  workflowId: Type.String({
    description:
      "Id of the workflow to run, e.g. 'wf_abc...'. Use keepergate_list_workflows first to discover available ids.",
  }),
  input: Type.Optional(
    Type.String({
      description:
        'JSON object of trigger inputs as a string, e.g. \'{"address":"0x..."}\'. Pass "{}" or omit if the workflow takes no inputs.',
    })
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        "How long to poll for terminal status before giving up. Default 60000 (60s).",
    })
  ),
});

const createSchema = Type.Object({
  name: Type.String({ description: "Human-readable name for the workflow." }),
  description: Type.Optional(
    Type.String({ description: "One-line description shown in the workflow list." })
  ),
});

const updateSchema = Type.Object({
  workflowId: Type.String(),
  name: Type.Optional(Type.String({ description: "New name; omit to keep current." })),
  description: Type.Optional(
    Type.String({ description: "New description; omit to keep current." })
  ),
  nodesJson: Type.Optional(
    Type.String({
      description:
        "JSON-encoded array of WorkflowNode objects to replace the current nodes. Sending this replaces the entire graph.",
    })
  ),
  edgesJson: Type.Optional(
    Type.String({
      description: "JSON-encoded array of WorkflowEdge objects to replace the current edges.",
    })
  ),
});

const deleteSchema = Type.Object({
  workflowId: Type.String(),
  force: Type.Optional(
    Type.Boolean({
      description:
        "Set true to cascade-delete execution history; otherwise the API returns 409 when the workflow has runs.",
    })
  ),
});

const duplicateSchema = Type.Object({
  workflowId: Type.String({ description: "Id of the workflow to clone." }),
});

function jsonText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    details: payload as Record<string, unknown>,
  };
}

/**
 * Workflow surface for OpenClaw: discover and trigger user-built KeeperHub
 * workflows from inside a plugin tool.
 */
export function buildWorkflowTools(client: KeeperHubClient): AnyAgentTool[] {
  const listTool: AnyAgentTool = {
    name: "keepergate_list_workflows",
    label: "KeeperGate list workflows",
    description:
      "List the KeeperHub workflows in the user's account. Returns id, name, and description for each. Call before keepergate_run_workflow to discover what's available.",
    parameters: listSchema,
    async execute(_toolCallId, _params, signal) {
      signal?.throwIfAborted?.();
      const wfs = await client.listWorkflows();
      const summary = wfs.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description ?? "",
      }));
      return jsonText(summary);
    },
  };

  const runTool: AnyAgentTool = {
    name: "keepergate_run_workflow",
    label: "KeeperGate run workflow",
    description:
      "Trigger a KeeperHub workflow by id and wait for it to finish. Returns executionId, terminal status, and per-node logs.",
    parameters: runSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof runSchema>;
      signal?.throwIfAborted?.();
      let triggerInput: Record<string, unknown> = {};
      if (args.input) {
        try {
          const parsed = JSON.parse(args.input);
          if (parsed && typeof parsed === "object") {
            triggerInput = parsed as Record<string, unknown>;
          }
        } catch {
          // ignore -- run with empty input
        }
      }
      const { executionId } = await client.executeWorkflow(
        args.workflowId,
        triggerInput
      );
      const result = await client.pollUntilDone(executionId, {
        timeoutMs: args.timeoutMs ?? 60_000,
      });
      const logs = result.logs.map((l) => ({
        node: l.nodeName ?? l.nodeId,
        status: l.status,
        output: l.output,
        error: (l as unknown as { error?: string }).error ?? null,
      }));
      return jsonText({
        executionId: result.executionId,
        status: result.status,
        logs,
      });
    },
  };

  const createTool: AnyAgentTool = {
    name: "keepergate_create_workflow",
    label: "KeeperGate create workflow",
    description:
      "Create a new KeeperHub workflow with a name and optional description. Returns the new workflow id. Starts with a default Manual trigger -- use keepergate_update_workflow to add real action nodes.",
    parameters: createSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof createSchema>;
      signal?.throwIfAborted?.();
      const wf = await client.createWorkflow({
        name: args.name,
        description: args.description,
      });
      return jsonText({ id: wf.id, name: wf.name });
    },
  };

  const updateTool: AnyAgentTool = {
    name: "keepergate_update_workflow",
    label: "KeeperGate update workflow",
    description:
      "Update an existing KeeperHub workflow's name, description, nodes, or edges. Pass only fields to change. nodesJson/edgesJson, when provided, replace the entire current graph.",
    parameters: updateSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof updateSchema>;
      signal?.throwIfAborted?.();
      const patch: Parameters<typeof client.updateWorkflow>[1] = {};
      if (args.name) patch.name = args.name;
      if (args.description) patch.description = args.description;
      if (args.nodesJson) {
        try {
          patch.nodes = JSON.parse(args.nodesJson);
        } catch {
          return jsonText({ error: "nodesJson is not valid JSON" });
        }
      }
      if (args.edgesJson) {
        try {
          patch.edges = JSON.parse(args.edgesJson);
        } catch {
          return jsonText({ error: "edgesJson is not valid JSON" });
        }
      }
      const wf = await client.updateWorkflow(args.workflowId, patch);
      return jsonText({ id: wf.id, name: wf.name });
    },
  };

  const deleteTool: AnyAgentTool = {
    name: "keepergate_delete_workflow",
    label: "KeeperGate delete workflow",
    description:
      "Delete a KeeperHub workflow by id. Without force=true, returns an error if the workflow has run history. Use force=true to cascade-clean.",
    parameters: deleteSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof deleteSchema>;
      signal?.throwIfAborted?.();
      await client.deleteWorkflow(args.workflowId, { force: args.force });
      return jsonText({ deleted: args.workflowId });
    },
  };

  const duplicateTool: AnyAgentTool = {
    name: "keepergate_duplicate_workflow",
    label: "KeeperGate duplicate workflow",
    description:
      "Clone an existing KeeperHub workflow into a new one. The clone is named '<original> (Copy)'. Use this when starting from a working workflow and making small edits.",
    parameters: duplicateSchema,
    async execute(_toolCallId, params, signal) {
      const args = params as Static<typeof duplicateSchema>;
      signal?.throwIfAborted?.();
      const wf = await client.duplicateWorkflow(args.workflowId);
      return jsonText({ id: wf.id, name: wf.name });
    },
  };

  return [listTool, runTool, createTool, updateTool, deleteTool, duplicateTool];
}
