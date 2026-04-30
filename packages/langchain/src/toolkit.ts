import {
  DirectExecutor,
  KeeperHubClient,
  type KeeperHubClientOptions,
} from "@keepergate/core";
import { buildDirectTools } from "./direct-tools.js";
import { buildWorkflowTools } from "./workflow-tools.js";

export interface KeeperGateToolkitOptions extends KeeperHubClientOptions {
  /**
   * Restrict the toolkit to a subset of tools. Useful when an agent should
   * only have read access, or only a specific capability.
   * Default: all available tools.
   */
  include?: ToolName[];
}

export type ToolName =
  | "transfer"
  | "callContract"
  | "checkAndExecute"
  | "getExecutionStatus"
  | "listWorkflows"
  | "runWorkflow";

const ALL_TOOLS: ToolName[] = [
  "transfer",
  "callContract",
  "checkAndExecute",
  "getExecutionStatus",
  "listWorkflows",
  "runWorkflow",
];

/**
 * KeeperGateToolkit — the one-stop entry point for plugging KeeperHub
 * into a LangChain agent. Construct with an API key, call `getTools()`,
 * pass the result to your agent.
 *
 * @example
 * ```ts
 * const toolkit = new KeeperGateToolkit({ apiKey: process.env.KEEPERHUB_API_KEY! });
 * const tools = await toolkit.getTools();
 * const agent = createAgent({ llm, tools });
 * ```
 */
export class KeeperGateToolkit {
  readonly client: KeeperHubClient;
  readonly direct: DirectExecutor;
  private readonly include: ToolName[];

  constructor(opts: KeeperGateToolkitOptions) {
    this.client = new KeeperHubClient(opts);
    this.direct = new DirectExecutor(this.client);
    this.include = opts.include ?? ALL_TOOLS;
  }

  /**
   * Returns LangChain StructuredTool[] ready to pass to any LangChain agent.
   * The set is filtered by the `include` option passed at construction.
   */
  async getTools() {
    const direct = buildDirectTools(this.direct);
    const workflow = buildWorkflowTools(this.client);
    const byName = new Map<ToolName, (typeof direct)[number] | (typeof workflow)[number]>([
      ["transfer", direct[0]],
      ["callContract", direct[1]],
      ["checkAndExecute", direct[2]],
      ["getExecutionStatus", direct[3]],
      ["listWorkflows", workflow[0]],
      ["runWorkflow", workflow[1]],
    ]);
    return this.include.flatMap((n) => {
      const t = byName.get(n);
      return t ? [t] : [];
    });
  }
}
