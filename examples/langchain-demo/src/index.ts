/* eslint-disable no-console */
import { KeeperGateToolkit } from "@keepergate/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";

const KEEPERHUB_API_KEY = required("KEEPERHUB_API_KEY");
const OPENROUTER_API_KEY = required("OPENROUTER_API_KEY");
const MODEL = process.env.LANGCHAIN_DEMO_MODEL || "openai/gpt-oss-20b:free";

const PROMPT =
  process.argv.slice(2).join(" ") ||
  "What is the USDC balance of vitalik.eth (0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045) on Ethereum mainnet? USDC contract is 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48. Use the keepergate_call_contract tool to read it, then report the result in human-readable USDC (the token has 6 decimals).";

console.log(`\n→ Building agent`);
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
  { streamMode: "values" }
);

let final: { messages: Array<{ content: unknown }> } | undefined;
for await (const step of stream) {
  final = step;
  const last = step.messages.at(-1);
  if (!last) continue;
  printStep(last);
}

console.log(`\n→ Final answer`);
const answer = final?.messages.at(-1)?.content;
console.log(`  ${typeof answer === "string" ? answer : JSON.stringify(answer)}\n`);

console.log(`✅ demo run complete`);

// ---------- helpers ----------

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
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
