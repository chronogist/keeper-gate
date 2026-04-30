import { tool } from "@langchain/core/tools";
import type { KeeperHubClient } from "@keepergate/core";
import { z } from "zod";

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

  return [listTool, runTool] as const;
}
