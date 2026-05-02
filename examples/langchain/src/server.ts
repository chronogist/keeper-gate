import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { allKeeperGateTools } from "./keepergate-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const llm = new ChatOpenAI({
  model: process.env.MODEL ?? "gpt-oss:20b",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL ?? "https://ollama.com/v1" },
  streaming: true,
});

const calculator = tool(
  ({ expression }: { expression: string }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return String(result);
    } catch {
      return "Error: invalid expression";
    }
  },
  {
    name: "calculator",
    description: "Evaluate a math expression like '2 + 2' or '10 * 5 / 2'.",
    schema: z.object({ expression: z.string() }),
  }
);

const getWeather = tool(
  ({ city }: { city: string }) => {
    const conditions = ["sunny", "cloudy", "rainy", "windy"];
    const temp = Math.floor(Math.random() * 30) + 5;
    return `${city}: ${temp}°C, ${conditions[Math.floor(Math.random() * conditions.length)]}`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    schema: z.object({ city: z.string() }),
  }
);

const agent = createReactAgent({
  llm,
  tools: [...allKeeperGateTools, calculator, getWeather],
});

// Per-session conversation history
const sessions = new Map<string, BaseMessage[]>();

function getHistory(sessionId: string): BaseMessage[] {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId)!;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// SSE streaming chat endpoint
app.post("/api/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body as { message: string; sessionId?: string };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const history = getHistory(sessionId);
  history.push(new HumanMessage(message));

  try {
    const stream = await agent.stream(
      { messages: history },
      { streamMode: "messages" }
    );

    let fullReply = "";

    for await (const [chunk, metadata] of stream) {
      const nodeType = (metadata as { langgraph_node?: string }).langgraph_node;

      // Tool call happening
      if (chunk.constructor.name === "AIMessageChunk") {
        const c = chunk as { tool_calls?: { name: string }[]; content?: string };

        if (c.tool_calls && c.tool_calls.length > 0) {
          for (const tc of c.tool_calls) {
            send("tool_start", { tool: tc.name });
          }
        }

        if (typeof c.content === "string" && c.content && nodeType === "agent") {
          fullReply += c.content;
          send("token", { text: c.content });
        }
      }

      // Tool result
      if (chunk.constructor.name === "ToolMessage") {
        const t = chunk as { name?: string; content?: string };
        send("tool_end", { tool: t.name ?? "tool", result: t.content?.slice(0, 200) });
      }
    }

    history.push(new AIMessage(fullReply));
    send("done", { sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send("error", { message: msg });
  }

  res.end();
});

// Clear session history
app.delete("/api/session/:sessionId", (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ cleared: true });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🤖 KeeperGate Agent running at http://localhost:${PORT}`);
  console.log(`📊 LangSmith traces: https://smith.langchain.com\n`);
});
