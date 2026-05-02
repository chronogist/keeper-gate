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
import {
  TEMPLATES,
  getTemplate,
  describeTemplatesForLLM,
  pickTemplate,
} from "./templates.js";

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

const BUILD_TEMPLATE_PICK = (catalog: string) => `The user wants to build (create + populate) a KeeperHub workflow that does something. Pick the BEST matching template from this catalog and extract a workflow name.

Catalog:
${catalog}

Extract:
<templateId>the chosen template id from the catalog (REQUIRED - exact match)</templateId>
<name>a short, descriptive workflow name based on the user's request (REQUIRED)</name>
<description>optional one-line description of what the workflow does</description>

If no template fits the user's request, set <templateId>none</templateId>.`;

const ADD_NODE_TEMPLATE = `The user wants to add an action node to an existing KeeperHub workflow. Extract:
<workflowId>the target workflow id (REQUIRED)</workflowId>
<nodeJson>JSON object for the new node, with fields: id (string), type ("action"|"condition"|"forEach"), data ({ label?, description?, type?, config? }), and optional position. REQUIRED.</nodeJson>
<connectFrom>id of an existing node to draw an edge FROM (optional - defaults to the last node in the workflow)</connectFrom>`;

const HAS_INTENT = (m: Memory, words: string[]): boolean => {
  const text = (m.content?.text ?? "").toLowerCase();
  return words.some((w) => text.includes(w));
};

const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

// Cache of {id, name} pairs from the most recent LIST_WORKFLOWS call. Lets the
// fallback resolver match workflows by name when the user references them by
// name (e.g. "the Safe Multisig workflow") instead of ID. Module-level is
// fine here because each agent process serves one user account.
type WorkflowSummary = { id: string; name: string };
let workflowCache: WorkflowSummary[] = [];
let workflowCacheAt = 0;
const WORKFLOW_CACHE_TTL_MS = 5 * 60_000;

export function setWorkflowCache(workflows: WorkflowSummary[]): void {
  workflowCache = workflows.map((w) => ({ id: w.id, name: w.name }));
  workflowCacheAt = Date.now();
}

async function getWorkflowCache(
  client: KeeperHubClient
): Promise<WorkflowSummary[]> {
  if (
    workflowCache.length > 0 &&
    Date.now() - workflowCacheAt < WORKFLOW_CACHE_TTL_MS
  ) {
    return workflowCache;
  }
  try {
    const fresh = await client.listWorkflows();
    setWorkflowCache(fresh.map((w) => ({ id: w.id, name: w.name })));
  } catch (err) {
    logger.warn({ err }, "[keepergate] failed to refresh workflow cache");
  }
  return workflowCache;
}

// Strip noise words and punctuation so "the Safe Multisig (Copy) workflow"
// and "safe multisig copy" can match the same cached name.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(the|a|an|workflow|workflows|copy|please|my|your)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length >= 2);
}

type NameMatch = { id: string; name: string; score: number };

// Score every cached workflow against the user text by token overlap, then
// return all matches (caller decides what to do when there are multiple).
function rankWorkflowsByName(text: string): NameMatch[] {
  if (workflowCache.length === 0) return [];
  const userTokens = new Set(tokenize(text));
  if (userTokens.size === 0) return [];

  const matches: NameMatch[] = [];
  for (const w of workflowCache) {
    const nameTokens = tokenize(w.name);
    if (nameTokens.length === 0) continue;
    let overlap = 0;
    for (const t of nameTokens) {
      if (userTokens.has(t)) overlap++;
    }
    if (overlap === 0) continue;
    // Require at least one distinctive (non-generic) token to match.
    const distinctive = nameTokens.some(
      (t) => userTokens.has(t) && !GENERIC_TOKENS.has(t)
    );
    if (!distinctive) continue;
    matches.push({ id: w.id, name: w.name, score: overlap });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// Resolve the user's text to a single workflow id only when unambiguous:
// either exactly one match, or a top match that beats the runner-up by >=2
// tokens. When ambiguous, return null so the caller can prompt the user.
function findIdByName(text: string): string | null {
  const matches = rankWorkflowsByName(text);
  if (matches.length === 0) return null;
  const top = matches[0];
  if (!top) return null;
  if (matches.length === 1) return top.id;
  const next = matches[1];
  if (next && top.score - next.score >= 2) return top.id;
  return null;
}

const GENERIC_TOKENS = new Set([
  "check",
  "checker",
  "balance",
  "wallet",
  "test",
  "new",
  "agent",
  "created",
  "untitled",
  "demo",
]);

// Scan message, agent's prior responses, and composed state text for a
// KeeperHub workflow id. Users often say "delete the last workflow" / "yes"
// after the agent has already named the id in its REPLY or in a LIST result —
// so the fallback must look beyond just `message.content.text`.
//
// Resolution priority (newest signal wins):
//   1. The user's current message — if it names a cached workflow, return that id.
//   2. The agent's current-turn responses — by name, then by bare id.
//   3. The composed state text — by name, then by bare id.
function scanForWorkflowId(
  message: Memory,
  responses: Memory[] | undefined,
  state: State | undefined,
  verbs?: string[]
): string | null {
  const userText = message.content?.text ?? "";
  const responseTexts = (responses ?? [])
    .map((r) => r.content?.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  const stateText = state?.text ?? "";

  // Pass 1: name match — newest signal first. The user's own message is the
  // strongest signal of intent ("the Safe Multisig workflow" → that id).
  const nameSources = [userText, ...responseTexts, stateText];
  for (const text of nameSources) {
    const byName = findIdByName(text);
    if (byName) return byName;
  }

  // Pass 2: id-shaped tokens — search newest first so a recently mentioned
  // id outranks a stale one buried in earlier history.
  const idSources = [...responseTexts.slice().reverse(), userText, stateText];

  const verbAlt = verbs && verbs.length > 0 ? verbs.join("|") : null;
  const hasDigit = (s: string) => /\d/.test(s);
  const isLikelyId = (s: string) => !ETH_ADDRESS.test(s) && hasDigit(s);

  for (const text of idSources) {
    if (verbAlt) {
      const m = text.match(
        new RegExp(
          `(?:${verbAlt})\\s+(?:the\\s+)?(?:workflow\\s+)?["'\`]?([a-z][a-zA-Z0-9_-]{8,})["'\`]?`,
          "i"
        )
      );
      if (m && m[1] && isLikelyId(m[1])) return m[1].trim();
    }
    const m2 = text.match(/workflow\s+["'`]?([a-z][a-zA-Z0-9_-]{8,})["'`]?/i);
    if (m2 && m2[1] && isLikelyId(m2[1])) return m2[1].trim();
  }

  for (const text of idSources) {
    const re = /\b([a-z][a-zA-Z0-9]{14,})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && isLikelyId(m[1])) return m[1].trim();
    }
  }
  return null;
}

// Async variant that warms the cache via the client when no name match is
// found in memory yet (e.g. user names a workflow before LIST has ever run).
async function scanForWorkflowIdAsync(
  client: KeeperHubClient,
  message: Memory,
  responses: Memory[] | undefined,
  state: State | undefined,
  verbs?: string[]
): Promise<string | null> {
  const sync = scanForWorkflowId(message, responses, state, verbs);
  if (sync) return sync;

  const userText = message.content?.text ?? "";
  if (!userText.trim()) return null;
  await getWorkflowCache(client);
  return findIdByName(userText);
}

export function buildWorkflowActions(client: KeeperHubClient): Action[] {
  const listAction: Action = {
    name: "KEEPERGATE_LIST_WORKFLOWS",
    similes: ["LIST_WORKFLOWS", "MY_WORKFLOWS", "SHOW_WORKFLOWS", "KEPPERGATE_LIST_WORKFLOWS", "KEEPER_GATE_LIST_WORKFLOWS"],
    description:
      "List the KeeperHub workflows in the user's account. Returns id, name, and description for each. Useful before KEEPERGATE_RUN_WORKFLOW so the agent can pick by name.",
    validate: async (_runtime, message) =>
      HAS_INTENT(message, [
        "list workflow",
        "workflow",
        "workflows",
        "what workflows",
        "show workflow",
        "my workflow",
        "available workflow",
        "all workflow",
        "any workflow",
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
        setWorkflowCache(summary);
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
    similes: ["RUN_WORKFLOW", "TRIGGER_WORKFLOW", "EXECUTE_WORKFLOW", "KEPPERGATE_RUN_WORKFLOW", "KEEPER_GATE_RUN_WORKFLOW"],
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
        const found = await scanForWorkflowIdAsync(client, message, responses, state, ["run", "trigger", "execute"]);
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

  // Phrases that imply the user wants real logic, not an empty shell. When
  // any of these appear, prefer BUILD over plain CREATE so the agent
  // populates nodes from a template instead of creating an empty workflow
  // that the user then has to wire up by hand.
  const BUILD_INTENT_PHRASES = [
    "if",
    "when",
    "every",
    "schedule",
    "monitor",
    "watch",
    "check if",
    "send when",
    "transfer when",
    "alert when",
    "balance below",
    "balance under",
    "less than",
    "greater than",
    "auto",
    "drip",
    "top up",
    "topup",
    "refill",
    "refuel",
    "airdrop",
  ];

  const buildAction: Action = {
    name: "KEEPERGATE_BUILD_WORKFLOW",
    similes: [
      "BUILD_WORKFLOW",
      "GENERATE_WORKFLOW",
      "AUTO_WORKFLOW",
      "KEPPERGATE_BUILD_WORKFLOW",
      "KEEPER_GATE_BUILD_WORKFLOW",
    ],
    description:
      "Create a KeeperHub workflow populated with nodes from a built-in template. Use this when the user describes WHAT the workflow should do (e.g. 'monitor a balance and transfer when below X', 'top up an address when it runs low'). Picks a template, extracts parameters, builds the node graph, and creates the workflow in one step. Prefer this over KEEPERGATE_CREATE_WORKFLOW whenever the user describes logic — CREATE_WORKFLOW only makes an empty shell.",
    validate: async (_runtime, message) => {
      const text = (message.content?.text ?? "").toLowerCase();
      const mentionsCreate =
        text.includes("create") ||
        text.includes("new workflow") ||
        text.includes("build") ||
        text.includes("make") ||
        text.includes("set up") ||
        text.includes("setup");
      if (!mentionsCreate) return false;
      return BUILD_INTENT_PHRASES.some((p) => text.includes(p));
    },
    handler: async (
      runtime,
      message,
      state,
      _options,
      callback,
      responses
    ): Promise<ActionResult> => {
      const userText = message.content?.text ?? "";

      // Step 1: pick a template. Deterministic keyword scoring runs first
      // (gpt-oss-class models are unreliable at picking from a catalog), and
      // we only fall back to the LLM picker if scoring is inconclusive. The
      // LLM is still asked for the workflow name + description in either path.
      let tpl = pickTemplate(userText);
      const pick = await extractArgs<{
        templateId: string;
        name: string;
        description?: string;
      }>(
        runtime,
        message,
        state,
        BUILD_TEMPLATE_PICK(describeTemplatesForLLM()),
        responses
      );

      if (!tpl) {
        const llmId = pick?.templateId?.trim();
        if (llmId && llmId !== "none") {
          tpl = getTemplate(llmId) ?? null;
        }
      }

      if (!tpl) {
        const text =
          "I don't have a template that fits this request yet. Available templates:\n" +
          TEMPLATES.map((t) => `  • ${t.id} — ${t.summary}`).join("\n") +
          "\n\nFor anything outside these patterns I'd need a free-form builder, which isn't wired up yet. Want me to fall through to KEEPERGATE_CREATE_WORKFLOW and make an empty workflow you can populate in the UI?";
        await callback?.({ text, actions: ["KEEPERGATE_BUILD_WORKFLOW"] });
        return { success: false, text };
      }

      logger.info(
        { templateId: tpl.id, source: pickTemplate(userText) ? "keyword" : "llm" },
        "[keepergate] build workflow: template picked"
      );

      // Step 2: extract template params from the user's request.
      const paramHint =
        `Extract parameters for the "${tpl.title}" workflow template from the user's most recent message.\n\n` +
        `User request: "${userText.replace(/"/g, '\\"').slice(0, 500)}"\n\n` +
        `Fields to extract (output as XML, one tag per field, leave empty if not stated):\n` +
        tpl.params
          .map((p) => {
            const tag = p.required ? "REQUIRED" : "optional";
            const enumPart = p.enumValues
              ? ` (one of: ${p.enumValues.join(", ")})`
              : "";
            const defaultPart =
              p.default !== undefined ? ` Default: ${p.default}.` : "";
            return `<${p.name}>${tag} - ${p.description}${enumPart}.${defaultPart}</${p.name}>`;
          })
          .join("\n");

      const extracted = await extractArgs<Record<string, string>>(
        runtime,
        message,
        state,
        paramHint,
        responses
      );

      const params: Record<string, string> = {};
      for (const p of tpl.params) {
        const raw = extracted?.[p.name];
        const value = typeof raw === "string" ? raw.trim() : "";
        if (value) {
          params[p.name] = value;
        } else if (p.default !== undefined) {
          params[p.name] = String(p.default);
        }
      }

      // Step 3: validate required params are present.
      const missing = tpl.params
        .filter((p) => p.required && !params[p.name])
        .map((p) => p.name);
      if (missing.length > 0) {
        const list = missing
          .map((n) => {
            const spec = tpl.params.find((p) => p.name === n);
            return `  • ${n}: ${spec?.description ?? ""}`;
          })
          .join("\n");
        const text = `I picked the "${tpl.title}" template but I'm missing required parameter(s):\n${list}\n\nReply with the missing values and I'll build it.`;
        await callback?.({ text, actions: ["KEEPERGATE_BUILD_WORKFLOW"] });
        return { success: false, text };
      }

      // Step 4: build node graph and create the workflow.
      const { nodes, edges } = tpl.build(params);
      const name = (pick?.name ?? "").trim() || tpl.title;
      const description = (pick?.description ?? "").trim() || tpl.summary;

      try {
        const wf = await client.createWorkflow({
          name,
          description,
          nodes,
          edges,
        });
        const summary = nodes.map((n) => `  - [${n.type}] ${n.data?.label ?? n.data?.type}`).join("\n");
        const text = `Built workflow "${wf.name}" (id ${wf.id}) from template ${tpl.id} with ${nodes.length} node(s):\n${summary}`;
        await callback?.({ text, actions: ["KEEPERGATE_BUILD_WORKFLOW"] });
        return {
          success: true,
          text,
          values: { workflowId: wf.id, templateId: tpl.id },
          data: { workflow: wf },
        };
      } catch (err) {
        logger.error({ err }, "[keepergate] buildWorkflow failed");
        return {
          success: false,
          text: `Build failed: ${err instanceof Error ? err.message : String(err)}`,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: 'Create a workflow called "Airdrop" that checks if USDC sepolia balance of 0xB3AD... is less than 21 USDC, and if so sends 10 USDC to that address',
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Building from template balance-threshold-transfer...",
            actions: ["KEEPERGATE_BUILD_WORKFLOW"],
          },
        },
      ],
    ],
  };

  const createAction: Action = {
    name: "KEEPERGATE_CREATE_WORKFLOW",
    similes: ["NEW_WORKFLOW", "MAKE_WORKFLOW", "CREATE_WORKFLOW", "KEPPERGATE_CREATE_WORKFLOW", "KEEPER_GATE_CREATE_WORKFLOW"],
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
    similes: ["EDIT_WORKFLOW", "MODIFY_WORKFLOW", "RENAME_WORKFLOW", "KEPPERGATE_UPDATE_WORKFLOW", "KEEPER_GATE_UPDATE_WORKFLOW"],
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
        const found = await scanForWorkflowIdAsync(client, message, responses, state, ["update", "edit", "rename", "modify"]);
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
    similes: ["REMOVE_WORKFLOW", "DELETE_WORKFLOW", "KEPPERGATE_DELETE_WORKFLOW", "KEEPER_GATE_DELETE_WORKFLOW"],
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
        const found = await scanForWorkflowIdAsync(client, message, responses, state, ["delete", "remove"]);
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
    similes: ["CLONE_WORKFLOW", "COPY_WORKFLOW", "KEPPERGATE_DUPLICATE_WORKFLOW", "KEEPER_GATE_DUPLICATE_WORKFLOW"],
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
        const found = await scanForWorkflowIdAsync(client, message, responses, state, ["duplicate", "clone", "copy"]);
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
      "KEPPERGATE_GET_WORKFLOW",
      "KEEPER_GATE_GET_WORKFLOW",
      "KEEPERGATE_GET_WORKFLOW_TRIGGERS",
      "KEEPERGATE_GET_TRIGGERS",
      "KEEPERGATE_LIST_WORKFLOW_NODES",
      "KEEPERGATE_GET_WORKFLOW_NODES",
      "KEPPERGATE_GET_WORKFLOW_TRIGGERS",
    ],
    description:
      "Fetch a single KeeperHub workflow by id and return ALL of its nodes — including triggers, actions, conditions, and forEach loops — plus edges. This is the ONLY action for inspecting a workflow's contents. Use it whenever the user asks about a workflow's actions, triggers, nodes, structure, or what's inside it. Triggers are returned as nodes with type='trigger'; there is no separate get-triggers action.",
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
        "trigger",
        "triggers",
        "what nodes",
        "which nodes",
        "nodes in",
        "show nodes",
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

      // Name-based resolution: if the user's current message names a known
      // workflow, trust that over whatever the LLM extracted from history.
      // The LLM has been observed to pick the wrong id when prior turns
      // mentioned multiple workflows. If the user's text is ambiguous
      // (matches several cached workflows roughly equally), ask them to pick.
      const userText = message.content?.text ?? "";
      if (userText.trim()) {
        await getWorkflowCache(client);
        const ranked = rankWorkflowsByName(userText);
        const top = ranked[0];
        const next = ranked[1];
        if (top && next && top.score - next.score < 2) {
          const llmId = args?.workflowId?.trim();
          const llmInList = llmId
            ? ranked.some((m) => m.id === llmId)
            : false;
          if (!llmInList) {
            const lines = ranked
              .slice(0, 5)
              .map((m) => `  - ${m.id}  ${m.name}`)
              .join("\n");
            const text = `I found multiple workflows that could match. Which one did you mean?\n${lines}`;
            await callback?.({ text, actions: ["KEEPERGATE_GET_WORKFLOW"] });
            return { success: false, text };
          }
        } else {
          const byName = findIdByName(userText);
          if (byName && byName !== args?.workflowId?.trim()) {
            logger.info(
              { llmExtracted: args?.workflowId, byName },
              "[keepergate] get workflow: overriding LLM id with name-matched id"
            );
            args = { workflowId: byName };
          }
        }
      }

      if (!args?.workflowId || args.workflowId.trim() === "" || ETH_ADDRESS.test(args.workflowId)) {
        const found = await scanForWorkflowIdAsync(client, message, responses, state);
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
    similes: ["ADD_NODE", "ADD_ACTION", "APPEND_NODE", "ADD_WORKFLOW_ACTION", "KEPPERGATE_ADD_WORKFLOW_NODE", "KEEPER_GATE_ADD_WORKFLOW_NODE"],
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
        workflowId = (await scanForWorkflowIdAsync(client, message, responses, state)) ?? "";
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
    buildAction,
    createAction,
    updateAction,
    deleteAction,
    duplicateAction,
    addNodeAction,
  ];
}
