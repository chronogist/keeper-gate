/* eslint-disable no-console */
//
// Multi-step demo: the prompt forces the agent to pick TWO tools in
// sequence -- list_workflows to discover what's available, then run_workflow
// with an id from the first call's result. This is the flow that proves
// "agent uses KeeperHub like a developer would" rather than just "agent
// reads a single value".
//

import { KeeperGateToolkit } from "@keepergate/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";

const KEEPERHUB_API_KEY = required("KEEPERHUB_API_KEY");
const OPENROUTER_API_KEY = required("OPENROUTER_API_KEY");
const MODEL = process.env.LANGCHAIN_DEMO_MODEL || "openai/gpt-oss-20b:free";

const PROMPT =
  process.argv.slice(2).join(" ") ||
  "List my KeeperHub workflows, then trigger the first one in the list using `{}` as the input. Report the resulting executionId and status when it finishes.";

console.log(`\n→ Building agent (multi-step demo)`);
console.log(`  model:   ${MODEL}`);
console.log(`  via:     OpenRouter`);
console.log(`  toolkit: @keepergate/langchain\n`);

const toolkit = new KeeperGateToolkit({ apiKey: KEEPERHUB_API_KEY });
const tools = await toolkit.getTools();
console.log(`  tools:   ${tools.map((t) => t.name).join(", ")}\n`);

const llm = new ChatOpenAI({
  model: MODEL,
  apiKey: OPENROUTER_API_KEY,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
  temperature: 0,
});

const agent = createReactAgent({ llm, tools });

console.log(`→ Prompt`);
console.log(`  ${PROMPT}\n`);

console.log(`→ Streaming agent steps...`);
const stream = await agent.stream(
  { messages: [new HumanMessage(PROMPT)] },
  { streamMode: "values", recursionLimit: 10 }
);

const toolsUsed = new Set<string>();
let final: { messages: Array<{ content: unknown }> } | undefined;
for await (const step of stream) {
  final = step;
  const last = step.messages.at(-1);
  if (!last) continue;
  trackToolsUsed(last, toolsUsed);
  printStep(last);
}

console.log(`\n→ Tools the agent picked: ${[...toolsUsed].join(", ") || "(none)"}`);
console.log(`→ Final answer`);
const answer = final?.messages.at(-1)?.content;
console.log(`  ${typeof answer === "string" ? answer : JSON.stringify(answer)}\n`);

if (toolsUsed.size < 2) {
  console.error(
    `❌ multi-step demo expected at least 2 tools to be invoked, saw ${toolsUsed.size}`
  );
  process.exit(1);
}
console.log(`✅ multi-step demo complete (${toolsUsed.size} tools chained)`);

// ---------- helpers ----------

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function trackToolsUsed(
  msg: { tool_calls?: Array<{ name: string }>; _getType?: () => string },
  acc: Set<string>
): void {
  if (msg._getType?.() === "ai" && msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) acc.add(tc.name);
  }
}

function printStep(msg: {
  content: unknown;
  tool_calls?: Array<{ name: string; args: unknown }>;
  name?: string;
  _getType?: () => string;
}): void {
  const kind = msg._getType?.() ?? "?";
  if (kind === "human") {
    console.log(`  [user]      ${truncate(String(msg.content))}`);
  } else if (kind === "ai") {
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        console.log(
          `  [ai → tool] ${tc.name}(${truncate(JSON.stringify(tc.args), 120)})`
        );
      }
    } else if (msg.content) {
      console.log(`  [ai]        ${truncate(String(msg.content))}`);
    }
  } else if (kind === "tool") {
    console.log(
      `  [tool ←]    ${msg.name ?? ""}: ${truncate(String(msg.content), 200)}`
    );
  }
}

function truncate(s: string, n = 240): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
