import { z, type ZodTypeAny } from "zod";
import type { KeeperHubClient } from "./client.js";
import { extractTriggerInputFields } from "./template-refs.js";
import type { ExecutionResult, Workflow } from "./types.js";

export interface WorkflowToolInfo {
  workflowId: string;
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  inputFields: string[];
}

/**
 * A WorkflowTool wraps a KeeperHub workflow as a callable, schema-typed tool.
 * Each framework adapter (langchain, elizaos, ...) maps this into its native tool shape.
 */
export class WorkflowTool {
  readonly info: WorkflowToolInfo;

  private constructor(
    private readonly client: KeeperHubClient,
    private readonly workflow: Workflow,
    info: WorkflowToolInfo
  ) {
    this.info = info;
  }

  static async fromWorkflowId(
    client: KeeperHubClient,
    workflowId: string
  ): Promise<WorkflowTool> {
    const wf = await client.getWorkflow(workflowId);
    return WorkflowTool.fromWorkflow(client, wf);
  }

  static fromWorkflow(client: KeeperHubClient, wf: Workflow): WorkflowTool {
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    const fields = trigger ? extractTriggerInputFields(wf.nodes, trigger.id) : [];

    const shape: Record<string, ZodTypeAny> = {};
    for (const f of fields) {
      shape[f] = z
        .string()
        .describe(`Workflow input "${f}" (referenced by an action via {{@trigger.${f}}})`);
    }

    const inputSchema = fields.length
      ? z.object(shape)
      : z.object({}).describe("This workflow takes no inputs.");

    const info: WorkflowToolInfo = {
      workflowId: wf.id,
      name: toolNameFromWorkflow(wf.name),
      description:
        wf.description ||
        `Run the "${wf.name}" KeeperHub workflow.${
          fields.length ? ` Inputs: ${fields.join(", ")}.` : ""
        }`,
      inputSchema,
      inputFields: fields,
    };

    return new WorkflowTool(client, wf, info);
  }

  async call(input: Record<string, unknown> = {}): Promise<ExecutionResult> {
    const { executionId } = await this.client.executeWorkflow(
      this.workflow.id,
      input
    );
    return this.client.pollUntilDone(executionId);
  }
}

function toolNameFromWorkflow(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "keepergate_workflow"
  );
}
