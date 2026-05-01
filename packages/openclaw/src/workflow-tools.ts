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

  return [listTool, runTool];
}
