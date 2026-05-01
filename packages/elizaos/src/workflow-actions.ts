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
<workflowId>the workflow id to run (REQUIRED - look for ids like "wf_abc", "omfyxouhxbls1qmtimg7c", or extract from workflow name in recent messages)</workflowId>
<input>JSON object of trigger inputs, or {} if none. Example: {"address":"0x..."}</input>`;

const CREATE_TEMPLATE = `The user wants to create a new KeeperHub workflow. You must extract:
- a name for the workflow (look for explicit names like "OG Balance check", or infer from the description of what the workflow should do)
- an optional description

If the user describes what the workflow should do but doesn't give an explicit name, create a short descriptive name from their description. For example:
  - User says "check my COMP holdings" -> name="COMP Holdings Checker"
  - User says "check wallet balance" -> name="Wallet Balance Check"
  - User says "OG Balance check" -> name="OG Balance check"

Extract:
<name>the workflow name (REQUIRED - infer from context if needed)</name>
<description>optional one-line description of what the workflow does</description>`;

const UPDATE_TEMPLATE = `The user wants to update a KeeperHub workflow. Extract only the fields that should change:
<workflowId>the workflow id to update (REQUIRED)</workflowId>
<name>new name, or empty to keep current</name>
<description>new description, or empty to keep current</description>
<nodesJson>JSON-encoded array of WorkflowNode objects to replace the current nodes, or empty to keep current</nodesJson>
<edgesJson>JSON-encoded array of WorkflowEdge objects, or empty to keep current</edgesJson>`;

const DELETE_TEMPLATE = `The user wants to delete a KeeperHub workflow. Extract:
<workflowId>the workflow id to delete (REQUIRED - look for ids like "wf_abc", "omfyxouhxbls1qmtimg7c", or extract from workflow name/description)</workflowId>
<force>"true" to cascade-delete execution history, "false" or empty otherwise</force>`;

const DUPLICATE_TEMPLATE = `The user wants to duplicate a KeeperHub workflow. Extract:
<workflowId>the workflow id to clone (REQUIRED)</workflowId>`;

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
      let args = await extractArgs<{
        workflowId: string;
        input?: string;
      }>(runtime, message, state, RUN_TEMPLATE, responses);

      // Fallback: if extraction failed, try to extract workflowId from the message text
      if (!args?.workflowId || args.workflowId.trim() === "") {
        const userText = message.content?.text ?? "";
        logger.warn(
          {
            args,
            messageText: userText.slice(0, 150),
            fallbackAttempt: true,
          },
          "[keepergate] run workflow: LLM extraction returned empty, trying fallback"
        );

        // Try to find workflow ID patterns
        const idMatch = userText.match(
          /(?:run|trigger|execute)\s+(?:workflow\s+)?(?:["'])?([a-zA-Z0-9_-]+)(?:["'])?/i
        ) ||
          userText.match(/\b([a-zA-Z0-9_]{10,})\b/);

        if (idMatch && idMatch[1]) {
          args = {
            workflowId: idMatch[1].trim(),
            input: args?.input,
          };
          logger.info(
            { extractedId: args.workflowId },
            "[keepergate] fallback extraction succeeded"
          );
        }
      }

      if (!args?.workflowId || args.workflowId.trim() === "") {
        logger.error(
          { args, messageText: message.content?.text?.slice(0, 150) },
          "[keepergate] run workflow: failed to extract workflowId from message"
        );
        return {
          success: false,
          text: "No workflowId found in the message. Please specify the workflow ID to run (e.g., 'Run workflow omfyxouhxbls1qmtimg7c').",
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
          args.workflowId.trim(),
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
      let args = await extractArgs<{ name: string; description?: string }>(
        runtime,
        message,
        state,
        CREATE_TEMPLATE,
        responses
      );

      // Fallback: if extraction failed or returned empty name, try to extract from the message text
      if (!args?.name || args.name.trim() === "") {
        const userText = message.content?.text ?? "";
        logger.warn(
          {
            args,
            messageText: userText.slice(0, 150),
            fallbackAttempt: true,
          },
          "[keepergate] create workflow: LLM extraction returned empty, trying fallback"
        );

        // Try to find patterns like "workflow called X" or "workflow named X"
        const calledMatch = userText.match(
          /(?:workflow|check|monitor)(?:\s+(?:called|named|for))?\s+(?:["'])?([^"'\n.!?,]+)/i
        );
        if (calledMatch && calledMatch[1]) {
          args = {
            name: calledMatch[1].trim(),
            description: args?.description,
          };
          logger.info(
            { extractedName: args.name },
            "[keepergate] fallback extraction succeeded"
          );
        }
      }

      if (!args?.name || args.name.trim() === "") {
        logger.error(
          { args, messageText: message.content?.text?.slice(0, 150) },
          "[keepergate] create workflow: failed to extract name from message"
        );
        return {
          success: false,
          text: "No workflow name found in the message. Please specify a name for the workflow (e.g., 'Create a workflow called OG Balance check').",
        };
      }

      try {
        const wf = await client.createWorkflow({
          name: args.name.trim(),
          description: args.description?.trim() || undefined,
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
        logger.error({ err }, "[keepergate] createWorkflow failed");
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
      let args = await extractArgs<{
        workflowId: string;
        name?: string;
        description?: string;
        nodesJson?: string;
        edgesJson?: string;
      }>(runtime, message, state, UPDATE_TEMPLATE, responses);

      // Fallback: if extraction failed, try to extract workflowId
      if (!args?.workflowId || args.workflowId.trim() === "") {
        const userText = message.content?.text ?? "";
        logger.warn(
          {
            args,
            messageText: userText.slice(0, 150),
            fallbackAttempt: true,
          },
          "[keepergate] update workflow: LLM extraction returned empty, trying fallback"
        );

        const idMatch = userText.match(
          /(?:update|edit|rename|modify)\s+(?:workflow\s+)?(?:["'])?([a-zA-Z0-9_-]+)(?:["'])?/i
        ) ||
          userText.match(/\b([a-zA-Z0-9_]{10,})\b/);

        if (idMatch && idMatch[1]) {
          args = {
            ...args,
            workflowId: idMatch[1].trim(),
          };
          logger.info(
            { extractedId: args.workflowId },
            "[keepergate] fallback extraction succeeded"
          );
        }
      }

      if (!args?.workflowId || args.workflowId.trim() === "") {
        logger.error(
          { args, messageText: message.content?.text?.slice(0, 150) },
          "[keepergate] update workflow: failed to extract workflowId"
        );
        return {
          success: false,
          text: "No workflowId found in the message. Please specify the workflow ID to update.",
        };
      }

      const patch: Parameters<typeof client.updateWorkflow>[1] = {};
      if (args.name) patch.name = args.name.trim();
      if (args.description) patch.description = args.description.trim();
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
        const wf = await client.updateWorkflow(args.workflowId.trim(), patch);
        const text = `Updated workflow ${wf.id} ("${wf.name}").`;
        await callback?.({ text, actions: ["KEEPERGATE_UPDATE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, name: wf.name },
          data: { workflow: wf },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] updateWorkflow failed");
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
      let args = await extractArgs<{ workflowId: string; force?: string }>(
        runtime,
        message,
        state,
        DELETE_TEMPLATE,
        responses
      );

      // Fallback: if extraction failed, try to extract workflowId from the message text
      if (!args?.workflowId || args.workflowId.trim() === "") {
        const userText = message.content?.text ?? "";
        logger.warn(
          {
            args,
            messageText: userText.slice(0, 150),
            fallbackAttempt: true,
          },
          "[keepergate] delete workflow: LLM extraction returned empty, trying fallback"
        );

        // Try to find workflow ID patterns:
        // 1. Explicit IDs like "wf_abc", "omfyxouhxbls1qmtimg7c", etc
        // 2. After "delete" or "remove" keywords
        const idMatch = userText.match(
          /(?:delete|remove|delete workflow|remove workflow)\s+(?:["'])?([a-zA-Z0-9_-]+)(?:["'])?/i
        ) ||
          userText.match(/\b([a-zA-Z0-9_]{10,})\b/) || // long alphanumeric strings (likely IDs)
          userText.match(/(?:workflow|id)?\s+["']?([a-zA-Z0-9_-]+)["']?\s+(?:titled|named|called|")/i);

        if (idMatch && idMatch[1]) {
          args = {
            workflowId: idMatch[1].trim(),
            force: args?.force,
          };
          logger.info(
            { extractedId: args.workflowId },
            "[keepergate] fallback extraction succeeded"
          );
        }
      }

      if (!args?.workflowId || args.workflowId.trim() === "") {
        logger.error(
          { args, messageText: message.content?.text?.slice(0, 150) },
          "[keepergate] delete workflow: failed to extract workflowId from message"
        );
        return {
          success: false,
          text: "No workflowId found in the message. Please specify the workflow ID to delete (e.g., 'Delete workflow omfyxouhxbls1qmtimg7c').",
        };
      }

      try {
        await client.deleteWorkflow(args.workflowId.trim(), {
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
        logger.error({ err }, "[keepergate] deleteWorkflow failed");
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
      let args = await extractArgs<{ workflowId: string }>(
        runtime,
        message,
        state,
        DUPLICATE_TEMPLATE,
        responses
      );

      // Fallback: if extraction failed, try to extract workflowId
      if (!args?.workflowId || args.workflowId.trim() === "") {
        const userText = message.content?.text ?? "";
        logger.warn(
          {
            args,
            messageText: userText.slice(0, 150),
            fallbackAttempt: true,
          },
          "[keepergate] duplicate workflow: LLM extraction returned empty, trying fallback"
        );

        const idMatch = userText.match(
          /(?:duplicate|clone|copy)\s+(?:workflow\s+)?(?:["'])?([a-zA-Z0-9_-]+)(?:["'])?/i
        ) ||
          userText.match(/\b([a-zA-Z0-9_]{10,})\b/);

        if (idMatch && idMatch[1]) {
          args = {
            workflowId: idMatch[1].trim(),
          };
          logger.info(
            { extractedId: args.workflowId },
            "[keepergate] fallback extraction succeeded"
          );
        }
      }

      if (!args?.workflowId || args.workflowId.trim() === "") {
        logger.error(
          { args, messageText: message.content?.text?.slice(0, 150) },
          "[keepergate] duplicate workflow: failed to extract workflowId"
        );
        return {
          success: false,
          text: "No workflowId found in the message. Please specify the workflow ID to duplicate.",
        };
      }

      try {
        const wf = await client.duplicateWorkflow(args.workflowId.trim());
        const text = `Duplicated workflow ${args.workflowId} as ${wf.id} ("${wf.name}").`;
        await callback?.({ text, actions: ["KEEPERGATE_DUPLICATE_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, name: wf.name },
          data: { workflow: wf },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] duplicateWorkflow failed");
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
