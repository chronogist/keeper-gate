import { tool } from "@langchain/core/tools";
import type { KeeperHubClient } from "@keepergate/core";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().describe("Human-readable name for the workflow."),
  description: z
    .string()
    .nullish()
    .describe("Optional one-line description shown in the workflow list."),
});

const updateSchema = z.object({
  workflowId: z
    .string()
    .describe(
      "Id of the workflow to update, e.g. 'wf_abc...'. Use keepergate_list_workflows to discover ids."
    ),
  name: z.string().nullish().describe("New name. Omit to keep current name."),
  description: z
    .string()
    .nullish()
    .describe("New description. Omit to keep current description."),
  nodesJson: z
    .string()
    .nullish()
    .describe(
      "JSON-encoded array of WorkflowNode objects to replace the current nodes. Omit to leave nodes unchanged. Sending this replaces the entire graph -- partial graph edits aren't supported."
    ),
  edgesJson: z
    .string()
    .nullish()
    .describe(
      "JSON-encoded array of WorkflowEdge objects. Pair with nodesJson when restructuring the graph."
    ),
});

const deleteSchema = z.object({
  workflowId: z.string().describe("Id of the workflow to delete."),
  force: z
    .boolean()
    .nullish()
    .describe(
      "Set true to cascade-delete execution history; otherwise the API returns 409 when the workflow has runs."
    ),
});

const duplicateSchema = z.object({
  workflowId: z.string().describe("Id of the workflow to clone."),
});

const listSchema = z.object({
  projectId: z
    .string()
    .nullish()
    .describe("Optional project id to filter by."),
  tagId: z
    .string()
    .nullish()
    .describe("Optional tag id to filter by."),
});

const runSchema = z.object({
  workflowId: z
    .string()
    .describe(
      "Id of the workflow to run, e.g. 'omfyxouhxbls1qmtimg7c'. Use keepergate_list_workflows first to discover ids."
    ),
  input: z
    .record(z.unknown())
    .nullish()
    .describe(
      "Inputs for the workflow's Manual trigger, e.g. { address: '0x...' }. Pass {} or omit if the workflow takes no inputs."
    ),
  timeoutMs: z
    .number()
    .nullish()
    .describe(
      "How long to poll for terminal status before giving up. Default: 60000 (60s)."
    ),
});

/**
 * LangChain StructuredTools that wrap KeeperHub's workflow surface.
 * Lets an agent discover workflows the user has built in the KeeperHub UI
 * and trigger them by id, optionally with trigger inputs.
 */
export function buildWorkflowTools(client: KeeperHubClient) {
  const listTool = tool(
    async (input) => {
      // KeeperHub's list endpoint doesn't currently accept these filters in the
      // URL the way the docs imply, so we filter client-side after the fetch.
      // Either way the agent gets a clean list of {id, name, description}.
      const wfs = await client.listWorkflows();
      const filtered = wfs.filter((w) => {
        const anyW = w as unknown as Record<string, unknown>;
        if (input.projectId && anyW.projectId !== input.projectId) return false;
        if (input.tagId && anyW.tagId !== input.tagId) return false;
        return true;
      });
      const summary = filtered.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description ?? "",
      }));
      return JSON.stringify(summary);
    },
    {
      name: "keepergate_list_workflows",
      description:
        "List all KeeperHub workflows the authenticated user has built. Returns id, name, and description for each. Call this before keepergate_run_workflow to discover what's available.",
      schema: listSchema,
    }
  );

  const runTool = tool(
    async (input) => {
      const { workflowId } = input;
      const triggerInput =
        input.input && typeof input.input === "object" ? input.input : {};
      const { executionId } = await client.executeWorkflow(
        workflowId,
        triggerInput as Record<string, unknown>
      );
      const result = await client.pollUntilDone(executionId, {
        timeoutMs: input.timeoutMs ?? 60_000,
      });
      // Compact log shape so the agent's context window doesn't blow up.
      const logs = result.logs.map((l) => ({
        node: l.nodeName ?? l.nodeId,
        status: l.status,
        output: l.output,
        error: (l as unknown as { error?: string }).error ?? null,
      }));
      return JSON.stringify({
        executionId: result.executionId,
        status: result.status,
        logs,
      });
    },
    {
      name: "keepergate_run_workflow",
      description:
        "Trigger a KeeperHub workflow by id and wait for it to finish. Pass any trigger inputs as `input`. Returns the executionId, terminal status (success/error), and per-node logs. Use this when the user has pre-built a workflow that does what they're asking for.",
      schema: runSchema,
    }
  );

  const createTool = tool(
    async (input) => {
      const wf = await client.createWorkflow({
        name: input.name,
        description: input.description ?? undefined,
      });
      return JSON.stringify({ id: wf.id, name: wf.name });
    },
    {
      name: "keepergate_create_workflow",
      description:
        "Create a new KeeperHub workflow with a name and optional description. Returns the new workflow's id. The new workflow starts with a default Manual trigger -- use keepergate_update_workflow to add action nodes and connections.",
      schema: createSchema,
    }
  );

  const updateTool = tool(
    async (input) => {
      const patch: Parameters<typeof client.updateWorkflow>[1] = {};
      if (input.name) patch.name = input.name;
      if (input.description) patch.description = input.description;
      if (input.nodesJson) {
        try {
          patch.nodes = JSON.parse(input.nodesJson);
        } catch {
          return JSON.stringify({ error: "nodesJson is not valid JSON" });
        }
      }
      if (input.edgesJson) {
        try {
          patch.edges = JSON.parse(input.edgesJson);
        } catch {
          return JSON.stringify({ error: "edgesJson is not valid JSON" });
        }
      }
      const wf = await client.updateWorkflow(input.workflowId, patch);
      return JSON.stringify({ id: wf.id, name: wf.name });
    },
    {
      name: "keepergate_update_workflow",
      description:
        "Update an existing KeeperHub workflow's name, description, nodes, or edges. Pass only the fields to change. Sending nodesJson/edgesJson replaces the entire current graph -- always pair them when restructuring.",
      schema: updateSchema,
    }
  );

  const deleteTool = tool(
    async (input) => {
      await client.deleteWorkflow(input.workflowId, {
        force: input.force ?? false,
      });
      return JSON.stringify({ deleted: input.workflowId });
    },
    {
      name: "keepergate_delete_workflow",
      description:
        "Delete a KeeperHub workflow by id. Without force=true, returns an error if the workflow has execution history. Use force=true to cascade-delete runs and logs.",
      schema: deleteSchema,
    }
  );

  const duplicateTool = tool(
    async (input) => {
      const wf = await client.duplicateWorkflow(input.workflowId);
      return JSON.stringify({ id: wf.id, name: wf.name });
    },
    {
      name: "keepergate_duplicate_workflow",
      description:
        "Clone an existing workflow into a new one. Useful when you want to start from a working workflow and make small edits via keepergate_update_workflow rather than building from scratch.",
      schema: duplicateSchema,
    }
  );

  return [listTool, runTool, createTool, updateTool, deleteTool, duplicateTool] as const;
}
