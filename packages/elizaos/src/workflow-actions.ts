import type { KeeperHubClient } from "@keepergate/core";
import {
  type Action,
  type ActionResult,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { extractArgs } from "./extract.js";

const RUN_TEMPLATE = `The user wants to run a KeeperHub workflow. Extract:
<workflowId>the workflow id, e.g. wf_abc123 (look at recent messages for a list_workflows result if needed)</workflowId>
<input>JSON object of trigger inputs, or {} if none. Example: {"address":"0x..."}</input>`;

const CREATE_TEMPLATE = `The user wants to create a new KeeperHub workflow. Extract:
<name>human-readable name for the workflow</name>
<description>one-line description, or empty if none</description>`;

const UPDATE_TEMPLATE = `The user wants to update a KeeperHub workflow. Extract only the fields that should change:
<workflowId>the workflow id to update</workflowId>
<name>new name, or empty to keep current</name>
<description>new description, or empty to keep current</description>
<nodesJson>JSON-encoded array of WorkflowNode objects to replace the current nodes, or empty to keep current</nodesJson>
<edgesJson>JSON-encoded array of WorkflowEdge objects, or empty to keep current</edgesJson>`;

const DELETE_TEMPLATE = `The user wants to delete a KeeperHub workflow. Extract:
<workflowId>the workflow id to delete</workflowId>
<force>"true" to cascade-delete execution history, "false" or empty otherwise</force>`;

const DUPLICATE_TEMPLATE = `The user wants to duplicate a KeeperHub workflow. Extract:
<workflowId>the workflow id to clone</workflowId>`;

const HAS_INTENT = (m: Memory, words: string[]): boolean => {
  const text = (m.content?.text ?? "").toLowerCase();
  return words.some((w) => text.includes(w));
};

export function buildWorkflowActions(client: KeeperHubClient): Action[] {
  const listAction: Action = {
    name: "KEEPERGATE_LIST_WORKFLOWS",
    similes: ["LIST_WORKFLOWS", "MY_WORKFLOWS", "SHOW_WORKFLOWS"],
    description:
      "List the KeeperHub workflows in the user's account. Returns id, name, and description for each. Useful before KEEPERGATE_RUN_WORKFLOW so the agent can pick by name.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, [
        "list workflow",
        "workflows",
        "what workflows",
        "show workflow",
        "my workflow",
      ]),
    handler: async (
      _runtime: IAgentRuntime,
      _message: Memory,
      _state: State | undefined,
      _options,
      callback
    ): Promise<ActionResult> => {
      try {
        const workflows = await client.listWorkflows();
        const summary = workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description ?? "",
        }));
        const lines = summary
          .map((w) => `  - ${w.id}  ${w.name}`)
          .join("\n");
        const text =
          summary.length === 0
            ? "No workflows found."
            : `Found ${summary.length} workflow(s):\n${lines}`;
        await callback?.({
          text,
          actions: ["KEEPERGATE_LIST_WORKFLOWS"],
        });
        return {
          success: true,
          text,
          values: { workflowCount: summary.length },
          data: { workflows: summary },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] listWorkflows failed");
        return {
          success: false,
          text: `Failed to list workflows: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "What workflows do I have on KeeperHub?" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Listing workflows...",
            actions: ["KEEPERGATE_LIST_WORKFLOWS"],
          },
        },
      ],
    ],
  };

  const runAction: Action = {
    name: "KEEPERGATE_RUN_WORKFLOW",
    similes: ["RUN_WORKFLOW", "TRIGGER_WORKFLOW", "EXECUTE_WORKFLOW"],
    description:
      "Trigger a KeeperHub workflow by id and wait for terminal status. Returns executionId, status, and per-node logs.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["run workflow", "trigger workflow", "execute workflow"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const args = await extractArgs<{
        workflowId: string;
        input?: string;
      }>(runtime, message, state, RUN_TEMPLATE, responses);
      if (!args?.workflowId) {
        return {
          success: false,
          text: "No workflowId found in the message.",
        };
      }
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
      try {
        const { executionId } = await client.executeWorkflow(
          args.workflowId,
          triggerInput
        );
        const result = await client.pollUntilDone(executionId);
        const logs = result.logs.map((l) => ({
          node: l.nodeName ?? l.nodeId,
          status: l.status,
          output: l.output,
        }));
        const text = `Workflow ${args.workflowId} finished with status: ${result.status}. ${logs.length} log entrie(s).`;
        await callback?.({
          text,
          actions: ["KEEPERGATE_RUN_WORKFLOW"],
        });
        return {
          success: result.status === "success" || result.status === "completed",
          text,
          values: { executionId: result.executionId, status: result.status },
          data: { logs },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] runWorkflow failed");
        return {
          success: false,
          text: `Workflow run failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "Run my rebalance workflow." },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Triggering rebalance and waiting for it to finish...",
            actions: ["KEEPERGATE_RUN_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const createAction: Action = {
    name: "KEEPERGATE_CREATE_WORKFLOW",
    similes: ["NEW_WORKFLOW", "MAKE_WORKFLOW", "CREATE_WORKFLOW"],
    description:
      "Create a new KeeperHub workflow with a name and optional description. Returns the new workflow id. Starts with a default Manual trigger -- use KEEPERGATE_UPDATE_WORKFLOW to add real action nodes.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["create workflow", "new workflow", "make a workflow"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const args = await extractArgs<{ name: string; description?: string }>(
        runtime,
        message,
        state,
        CREATE_TEMPLATE,
        responses
      );
      if (!args?.name) {
        return { success: false, text: "No workflow name found in the message." };
      }
      try {
        const wf = await client.createWorkflow({
          name: args.name,
          description: args.description || undefined,
        });
        const text = `Created workflow "${wf.name}" with id ${wf.id}.`;
        await callback?.({ text, actions: ["KEEPERGATE_CREATE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, name: wf.name },
          data: { workflow: wf },
        };
      } catch (err) {
        return {
          success: false,
          text: `Create failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        { name: "{{user}}", content: { text: "Create a new workflow called Treasury Rebalancer" } },
        {
          name: "{{agent}}",
          content: {
            text: "Creating workflow...",
            actions: ["KEEPERGATE_CREATE_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const updateAction: Action = {
    name: "KEEPERGATE_UPDATE_WORKFLOW",
    similes: ["EDIT_WORKFLOW", "MODIFY_WORKFLOW", "RENAME_WORKFLOW"],
    description:
      "Update an existing KeeperHub workflow's name, description, nodes, or edges. Sending nodesJson or edgesJson replaces the entire current graph.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["update workflow", "edit workflow", "rename workflow", "modify workflow"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const args = await extractArgs<{
        workflowId: string;
        name?: string;
        description?: string;
        nodesJson?: string;
        edgesJson?: string;
      }>(runtime, message, state, UPDATE_TEMPLATE, responses);
      if (!args?.workflowId) {
        return { success: false, text: "No workflowId found in the message." };
      }
      const patch: Parameters<typeof client.updateWorkflow>[1] = {};
      if (args.name) patch.name = args.name;
      if (args.description) patch.description = args.description;
      if (args.nodesJson) {
        try {
          patch.nodes = JSON.parse(args.nodesJson);
        } catch {
          return { success: false, text: "nodesJson is not valid JSON." };
        }
      }
      if (args.edgesJson) {
        try {
          patch.edges = JSON.parse(args.edgesJson);
        } catch {
          return { success: false, text: "edgesJson is not valid JSON." };
        }
      }
      try {
        const wf = await client.updateWorkflow(args.workflowId, patch);
        const text = `Updated workflow ${wf.id} ("${wf.name}").`;
        await callback?.({ text, actions: ["KEEPERGATE_UPDATE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, name: wf.name },
          data: { workflow: wf },
        };
      } catch (err) {
        return {
          success: false,
          text: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "Rename workflow wf_abc to Treasury v2" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Updating workflow...",
            actions: ["KEEPERGATE_UPDATE_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const deleteAction: Action = {
    name: "KEEPERGATE_DELETE_WORKFLOW",
    similes: ["REMOVE_WORKFLOW", "DELETE_WORKFLOW"],
    description:
      "Delete a KeeperHub workflow by id. Without force=true, returns an error if the workflow has run history. Use force=true to cascade-clean.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["delete workflow", "remove workflow"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const args = await extractArgs<{ workflowId: string; force?: string }>(
        runtime,
        message,
        state,
        DELETE_TEMPLATE,
        responses
      );
      if (!args?.workflowId) {
        return { success: false, text: "No workflowId found in the message." };
      }
      try {
        await client.deleteWorkflow(args.workflowId, {
          force: String(args.force).toLowerCase() === "true",
        });
        const text = `Deleted workflow ${args.workflowId}.`;
        await callback?.({ text, actions: ["KEEPERGATE_DELETE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { deleted: args.workflowId },
        };
      } catch (err) {
        return {
          success: false,
          text: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        { name: "{{user}}", content: { text: "Delete workflow wf_abc" } },
        {
          name: "{{agent}}",
          content: {
            text: "Deleting workflow...",
            actions: ["KEEPERGATE_DELETE_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const duplicateAction: Action = {
    name: "KEEPERGATE_DUPLICATE_WORKFLOW",
    similes: ["CLONE_WORKFLOW", "COPY_WORKFLOW"],
    description:
      "Clone an existing KeeperHub workflow into a new one (named '<original> (Copy)'). Useful when starting from a working workflow and making small edits.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, ["duplicate workflow", "clone workflow", "copy workflow"]),
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const args = await extractArgs<{ workflowId: string }>(
        runtime,
        message,
        state,
        DUPLICATE_TEMPLATE,
        responses
      );
      if (!args?.workflowId) {
        return { success: false, text: "No workflowId found in the message." };
      }
      try {
        const wf = await client.duplicateWorkflow(args.workflowId);
        const text = `Duplicated workflow ${args.workflowId} as ${wf.id} ("${wf.name}").`;
        await callback?.({ text, actions: ["KEEPERGATE_DUPLICATE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, name: wf.name },
          data: { workflow: wf },
        };
      } catch (err) {
        return {
          success: false,
          text: `Duplicate failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        { name: "{{user}}", content: { text: "Clone workflow wf_abc" } },
        {
          name: "{{agent}}",
          content: {
            text: "Cloning workflow...",
            actions: ["KEEPERGATE_DUPLICATE_WORKFLOW"],
          },
        },
      ],
    ],
  };

  return [listAction, runAction, createAction, updateAction, deleteAction, duplicateAction];
}
