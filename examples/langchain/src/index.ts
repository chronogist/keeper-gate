import "dotenv/config";
import * as readline from "readline";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { allKeeperGateTools } from "./keepergate-tools.js";

const llm = new ChatOpenAI({
  model: process.env.MODEL ?? "gpt-oss:20b",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL ?? "https://ollama.com/v1",
  },
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
    schema: z.object({
      expression: z.string().describe("The math expression to evaluate"),
    }),
  }
);

const getWeather = tool(
  ({ city }: { city: string }) => {
    const conditions = ["sunny", "cloudy", "rainy", "windy"];
    const temp = Math.floor(Math.random() * 30) + 5;
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    return `${city}: ${temp}°C, ${condition}`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    schema: z.object({
      city: z.string().describe("The city name"),
    }),
  }
);

const agent = createReactAgent({
  llm,
  tools: [...allKeeperGateTools, calculator, getWeather],
});

const history: (HumanMessage | AIMessage)[] = [];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

console.log("\n🤖LangChain Agent — type your message, or 'exit' to quit");
console.log("📊 Traces: https://smith.langchain.com\n");

async function chat() {
  while (true) {
    const input = await prompt("You: ");
    if (input.trim().toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      break;
    }
    if (!input.trim()) continue;

    history.push(new HumanMessage(input));

    try {
      const result = await agent.invoke({ messages: history });
      const last = result.messages.at(-1) as AIMessage;
      const reply = typeof last.content === "string" ? last.content : JSON.stringify(last.content);

      history.push(new AIMessage(reply));
      console.log(`\nAgent: ${reply}\n`);
    } catch (err) {
      console.error("Error:", err);
    }
  }
}

chat();
