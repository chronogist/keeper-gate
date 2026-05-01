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

  return [listAction, runAction];
}
