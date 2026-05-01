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
<workflowId>the workflow id to update (REQUIRED - format: alphanumeric like "o1kdn23oq3f03j61nx7og", NOT an 0x address)</workflowId>
<name>new name, or empty to keep current</name>
<description>new description, or empty to keep current</description>
<nodesJson>JSON-encoded array of WorkflowNode objects to replace the current nodes, or empty to keep current</nodesJson>
<edgesJson>JSON-encoded array of WorkflowEdge objects, or empty to keep current</edgesJson>`;

const DELETE_TEMPLATE = `The user wants to delete a KeeperHub workflow. Extract:
<workflowId>the workflow id to delete (REQUIRED - look for ids like "wf_abc", "omfyxouhxbls1qmtimg7c", or extract from workflow name/description)</workflowId>
<force>"true" to cascade-delete execution history, "false" or empty otherwise</force>`;

const DUPLICATE_TEMPLATE = `The user wants to duplicate a KeeperHub workflow. Extract:
<workflowId>the workflow id to clone (REQUIRED)</workflowId>`;

const GET_TEMPLATE = `The user wants to view the details (actions/nodes) of a KeeperHub workflow. Extract:
<workflowId>the workflow id to inspect (REQUIRED - look for ids in recent messages, e.g. "ppa2iasa59itskhj6r37y")</workflowId>`;

const ADD_NODE_TEMPLATE = `The user wants to add an action node to an existing KeeperHub workflow. Extract:
<workflowId>the target workflow id (REQUIRED)</workflowId>
<nodeJson>JSON object for the new node, with fields: id (string), type ("action"|"condition"|"forEach"), data ({ label?, description?, type?, config? }), and optional position. REQUIRED.</nodeJson>
<connectFrom>id of an existing node to draw an edge FROM (optional - defaults to the last node in the workflow)</connectFrom>`;

const HAS_INTENT = (m: Memory, words: string[]): boolean => {
  const text = (m.content?.text ?? "").toLowerCase();
  return words.some((w) => text.includes(w));
};

const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

// Scan message, agent's prior responses, and composed state text for a
// KeeperHub workflow id. Users often say "delete the last workflow" / "yes"
// after the agent has already named the id in its REPLY or in a LIST result —
// so the fallback must look beyond just `message.content.text`.
function scanForWorkflowId(
  message: Memory,
  responses: Memory[] | undefined,
  state: State | undefined,
  verbs?: string[]
): string | null {
  const sources: string[] = [];
  const userText = message.content?.text ?? "";
  if (userText) sources.push(userText);
  for (const r of responses ?? []) {
    const t = r.content?.text;
    if (typeof t === "string" && t) sources.push(t);
  }
  if (state?.text) sources.push(state.text);

  const verbAlt = verbs && verbs.length > 0 ? verbs.join("|") : null;

  for (const text of sources) {
    if (verbAlt) {
      const m = text.match(
        new RegExp(
          `(?:${verbAlt})\\s+(?:the\\s+)?(?:workflow\\s+)?["'\`]?([a-z][a-zA-Z0-9_-]{8,})["'\`]?`,
          "i"
        )
      );
      if (m && m[1] && !ETH_ADDRESS.test(m[1])) return m[1].trim();
    }
    const m2 = text.match(/workflow\s+["'`]?([a-z][a-zA-Z0-9_-]{8,})["'`]?/i);
    if (m2 && m2[1] && !ETH_ADDRESS.test(m2[1])) return m2[1].trim();
  }

  for (const text of sources) {
    const m = text.match(/\b([a-z][a-zA-Z0-9]{15,})\b/);
    if (m && m[1] && !ETH_ADDRESS.test(m[1])) return m[1].trim();
  }
  return null;
}

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

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = scanForWorkflowId(message, responses, state, ["run", "trigger", "execute"]);
        logger.warn(
          { args, fallbackAttempt: true, found },
          "[keepergate] run workflow: LLM extraction empty/invalid, trying fallback"
        );
        if (found) args = { workflowId: found, input: args?.input };
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

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = scanForWorkflowId(message, responses, state, ["update", "edit", "rename", "modify"]);
        logger.warn(
          { args, fallbackAttempt: true, found },
          "[keepergate] update workflow: LLM extraction empty/invalid, trying fallback"
        );
        if (found) args = { ...(args ?? {}), workflowId: found } as typeof args;
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

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = scanForWorkflowId(message, responses, state, ["delete", "remove"]);
        logger.warn(
          { args, fallbackAttempt: true, found },
          "[keepergate] delete workflow: LLM extraction empty/invalid, trying fallback"
        );
        if (found) args = { workflowId: found, force: args?.force };
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

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = scanForWorkflowId(message, responses, state, ["duplicate", "clone", "copy"]);
        logger.warn(
          { args, fallbackAttempt: true, found },
          "[keepergate] duplicate workflow: LLM extraction empty/invalid, trying fallback"
        );
        if (found) args = { workflowId: found };
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

  const getAction: Action = {
    name: "KEEPERGATE_GET_WORKFLOW",
    similes: [
      "VIEW_WORKFLOW",
      "SHOW_WORKFLOW_DETAILS",
      "WORKFLOW_ACTIONS",
      "LIST_WORKFLOW_ACTIONS",
      "INSPECT_WORKFLOW",
    ],
    description:
      "Fetch a single KeeperHub workflow by id and return its nodes (actions/triggers/conditions) and edges. Use this when the user asks what actions a workflow has, what's inside a workflow, or to inspect a workflow's structure.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, [
        "what actions",
        "which actions",
        "view workflow",
        "show workflow details",
        "details of workflow",
        "inside the workflow",
        "actions in",
        "actions does",
        "actions they",
        "inspect workflow",
        "workflow have",
      ]),
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
        GET_TEMPLATE,
        responses
      );

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = scanForWorkflowId(message, responses, state);
        logger.warn(
          { args, fallbackAttempt: true, found },
          "[keepergate] get workflow: LLM extraction empty/invalid, trying fallback"
        );
        if (found) args = { workflowId: found };
      }

      if (!args?.workflowId || args.workflowId.trim() === "") {
        return {
          success: false,
          text: "No workflowId found. Please specify which workflow to inspect (e.g., 'Show actions in workflow ppa2iasa59itskhj6r37y').",
        };
      }

      try {
        const wf = await client.getWorkflow(args.workflowId.trim());
        const nodes = wf.nodes ?? [];
        if (nodes.length === 0) {
          const text = `Workflow ${wf.id} ("${wf.name}") has no nodes.`;
          await callback?.({ text, actions: ["KEEPERGATE_GET_WORKFLOW"] });
          return { success: true, text, data: { workflow: wf } };
        }
        const lines = nodes.map((n, i) => {
          const label = n.data?.label ?? n.data?.type ?? n.type;
          const subtype = n.data?.type ? ` (${n.data.type})` : "";
          const desc = n.data?.description ? ` — ${n.data.description}` : "";
          return `  ${i + 1}. [${n.type}] ${label}${subtype}${desc}  id=${n.id}`;
        });
        const text = `Workflow ${wf.id} ("${wf.name}") has ${nodes.length} node(s):\n${lines.join("\n")}`;
        await callback?.({ text, actions: ["KEEPERGATE_GET_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, nodeCount: nodes.length },
          data: { workflow: wf },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] getWorkflow failed");
        return {
          success: false,
          text: `Failed to fetch workflow: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: { text: "What actions does my COMP workflow have?" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Fetching workflow details...",
            actions: ["KEEPERGATE_GET_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const addNodeAction: Action = {
    name: "KEEPERGATE_ADD_WORKFLOW_NODE",
    similes: ["ADD_NODE", "ADD_ACTION", "APPEND_NODE", "ADD_WORKFLOW_ACTION"],
    description:
      "Append a new node (action/condition/forEach) to an existing KeeperHub workflow. Fetches the current nodes/edges, appends the new node, and connects it to a chosen source node (default: the last node).",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, [
        "add action",
        "add a node",
        "add node",
        "append action",
        "add step",
        "add an action",
      ]),
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
        nodeJson: string;
        connectFrom?: string;
      }>(runtime, message, state, ADD_NODE_TEMPLATE, responses);

      let workflowId = args?.workflowId?.trim();
      if (!workflowId || ETH_ADDRESS.test(workflowId)) {
        workflowId = scanForWorkflowId(message, responses, state) ?? "";
      }

      if (!workflowId) {
        return {
          success: false,
          text: "No workflowId found. Please specify which workflow to add the node to.",
        };
      }
      if (!args?.nodeJson || args.nodeJson.trim() === "") {
        return {
          success: false,
          text: "No nodeJson provided. Please describe the action to add (id, type, data.label, data.config).",
        };
      }

      let newNode;
      try {
        newNode = JSON.parse(args.nodeJson);
      } catch (err) {
        return {
          success: false,
          text: `Invalid nodeJson: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (!newNode || typeof newNode !== "object" || !newNode.id || !newNode.type) {
        return {
          success: false,
          text: "nodeJson must be an object with at least { id, type } fields.",
        };
      }

      try {
        const wf = await client.getWorkflow(workflowId);
        const nodes = [...(wf.nodes ?? []), newNode];
        const sourceId = args.connectFrom?.trim() || wf.nodes?.[wf.nodes.length - 1]?.id;
        const edges = [...(wf.edges ?? [])];
        if (sourceId) {
          edges.push({
            id: `edge-${sourceId}-${newNode.id}`,
            source: sourceId,
            target: newNode.id,
          });
        }
        const updated = await client.updateWorkflow(workflowId, { nodes, edges });
        const text = `Added node "${newNode.id}" to workflow ${updated.id}. Now has ${updated.nodes.length} node(s).`;
        await callback?.({ text, actions: ["KEEPERGATE_ADD_WORKFLOW_NODE"] });
        return {
          success: true,
          text,
          values: { workflowId: updated.id, nodeId: newNode.id },
          data: { workflow: updated },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] addWorkflowNode failed");
        return {
          success: false,
          text: `Add node failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: 'Add an action node to ppa2iasa59itskhj6r37y: {"id":"a1","type":"action","data":{"label":"Send alert","type":"webhook","config":{"url":"https://..."}}}',
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Adding node...",
            actions: ["KEEPERGATE_ADD_WORKFLOW_NODE"],
          },
        },
      ],
    ],
  };

  return [
    listAction,
    getAction,
    runAction,
    createAction,
    updateAction,
    deleteAction,
    duplicateAction,
    addNodeAction,
  ];
}
