import express, { Express, Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import * as path from "path";
import "dotenv/config";

// KeeperGate Integration: Import KeeperGate plugin actions
import { buildDirectActions, buildWorkflowActions } from "@keepergate/elizaos";
import { KeeperHubClient, DirectExecutor } from "@keepergate/core";

const app: Express = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Logging utility that shows both in terminal and sends to client
const activeConnections = new Set<WebSocket>();

function log(message: string, type: "info" | "log" | "tool" | "response" = "log"): void {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}]`;

  // Console output with colors
  switch (type) {
    case "info":
      console.log(`\x1b[36m${prefix} ℹ️  ${message}\x1b[0m`);
      break;
    case "tool":
      console.log(`\x1b[33m${prefix} 🔧 ${message}\x1b[0m`);
      break;
    case "response":
      console.log(`\x1b[32m${prefix} ✅ ${message}\x1b[0m`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }

  // Send to all connected clients
  activeConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, message, timestamp }));
    }
  });
}

// KeeperGate Integration: Initialize KeeperGate client and actions
let keepergateClient: KeeperHubClient | null = null;
let keepergateActions: Array<{ name: string; handler: (params: unknown) => Promise<string> }> = [];

// KeeperGate Integration: Load character configuration
import characterData from "../character.json" assert { type: "json" };

async function initializeKeeperGate(): Promise<void> {
  // KeeperGate Integration: Try to get API key from env first, then from character.json
  let keeperhubApiKey = process.env.KEEPERHUB_API_KEY;
  
  if (!keeperhubApiKey && characterData.settings?.secrets?.KEEPERHUB_API_KEY) {
    keeperhubApiKey = characterData.settings.secrets.KEEPERHUB_API_KEY as string;
    log("ℹ️  Loaded KEEPERHUB_API_KEY from character.json", "info");
  }
  
  if (!keeperhubApiKey) {
    log("⚠️  KEEPERHUB_API_KEY not set. Add it to .env or character.json", "info");
    return;
  }

  log("Initializing KeeperGate integration...", "info");

  try {
    // KeeperGate Integration: Create KeeperHub client
    keepergateClient = new KeeperHubClient({
      apiKey: keeperhubApiKey,
    });

    // KeeperGate Integration: Create executor and build actions
    const executor = new DirectExecutor(keepergateClient);
    const directActions = buildDirectActions(executor);
    const workflowActions = buildWorkflowActions(keepergateClient);

    // KeeperGate Integration: Store available KeeperGate actions for later use
    keepergateActions = [...directActions, ...workflowActions].map((action) => ({
      name: action.name,
      handler: async (params: unknown) => {
        try {
          const result = await action.handler(
            {} as any,
            { text: JSON.stringify(params) } as any
          );
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
          return `Error executing ${action.name}: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }));

    log(`✅ KeeperGate initialized with ${keepergateActions.length} actions available`, "info");
    log(`Available actions: ${keepergateActions.map((a) => a.name).join(", ")}`, "info");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`⚠️  Failed to initialize KeeperGate: ${errorMessage}`, "info");
  }
}

// KeeperGate Integration: Determine if a message should use KeeperGate actions
function shouldUseKeeperGateAction(userMessage: string): boolean {
  // KeeperGate Integration: Check for keywords that suggest KeeperGate action usage
  const keepergateKeywords = [
    "transfer",
    "send",
    "execute",
    "workflow",
    "contract",
    "call",
    "check",
    "conditional",
    "create workflow",
    "delete workflow",
    "update workflow",
    "run workflow",
  ];

  const lowerMessage = userMessage.toLowerCase();
  return keepergateKeywords.some((keyword) => lowerMessage.includes(keyword));
}

// KeeperGate Integration: Process message with potential KeeperGate actions
async function generateResponse(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set in environment. Get one at https://openrouter.ai"
    );
  }

  const model = process.env.ELIZAOS_MODEL || "openai/gpt-oss-20b:free";

  log(`Processing message with ElizaOS (${model})`, "tool");

  try {
    // KeeperGate Integration: Check if this message needs KeeperGate actions
    if (shouldUseKeeperGateAction(userMessage) && keepergateActions.length > 0) {
      log(`🔧 Message matches KeeperGate keywords, considering actions...`, "tool");

      // KeeperGate Integration: Use LLM to decide which action to take
      const actionSelectionResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://github.com/chronogist/keeper-gate",
            "X-Title": "ElizaOS Agent with KeeperGate",
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: "system",
                content: `You are Eliza, an AI assistant with blockchain capabilities via KeeperGate. 
Available KeeperGate actions: ${keepergateActions.map((a) => a.name).join(", ")}

IMPORTANT: You MUST respond with ONLY valid JSON. No other text.

When a user asks about workflows, list workflows, or retrieve workflow information:
- Respond: {"shouldExecute": true, "action": "KEEPERGATE_LIST_WORKFLOWS", "params": {}}

When a user asks to run/execute a workflow:
- Respond: {"shouldExecute": true, "action": "KEEPERGATE_RUN_WORKFLOW", "params": {"workflowId": "workflow_id"}}

For any other request where action is not needed:
- Respond: {"shouldExecute": false}

Examples of valid responses:
{"shouldExecute": true, "action": "KEEPERGATE_LIST_WORKFLOWS", "params": {}}
{"shouldExecute": false}`,
              },
              {
                role: "user",
                content: userMessage,
              },
            ],
            max_tokens: 500,
            temperature: 0.7,
          }),
        }
      );

      if (actionSelectionResponse.ok) {
        const actionData = (await actionSelectionResponse.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        const responseText = actionData.choices[0]?.message?.content || "";

        try {
          const parsed = JSON.parse(responseText);
          if (parsed.shouldExecute && parsed.action) {
            log(`⚡ Executing KeeperGate action: ${parsed.action}`, "tool");
            const action = keepergateActions.find((a) => a.name === parsed.action);
            if (action) {
              const actionResult = await action.handler(parsed.params);
              log(`✅ KeeperGate action completed`, "response");
              return `Action executed: ${action.name}\n\nResult: ${actionResult}`;
            }
          }
        } catch (parseError) {
          // KeeperGate Integration: Log actual error for debugging
          const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
          log(`⚠️  Action response was not valid JSON: ${errorMsg}`, "info");
          log(`Raw response: ${responseText.substring(0, 100)}...`, "info");
          log("Generating text response instead", "info");
        }
      }
    }

    // KeeperGate Integration: Generate regular text response
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/chronogist/keeper-gate",
        "X-Title": "ElizaOS Agent",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content:
              "You are Eliza, a helpful and friendly AI assistant. You are curious, thoughtful, and always try to provide accurate and helpful responses. Keep your responses concise but informative.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content || "I didn't understand that.";
    log(`Text response generated`, "response");
    return content;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`, "info");
    throw new Error(`Failed to generate response: ${errorMessage}`);
  }
}

// WebSocket connection handler
wss.on("connection", (ws: WebSocket) => {
  activeConnections.add(ws);
  log("Client connected", "info");

  ws.on("message", async (message: string) => {
    try {
      const data = JSON.parse(message) as { text: string };
      const userMessage = data.text.trim();

      if (!userMessage) return;

      log(`User: ${userMessage}`, "log");

      // Generate response
      const response = await generateResponse(userMessage);

      log(`Eliza: ${response}`, "response");

      // Send response back to client
      ws.send(
        JSON.stringify({
          type: "user-message",
          role: "assistant",
          content: response,
        })
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Error processing message: ${errorMessage}`, "info");
      ws.send(
        JSON.stringify({
          type: "error",
          message: errorMessage,
        })
      );
    }
  });

  ws.on("close", () => {
    activeConnections.delete(ws);
    log("Client disconnected", "info");
  });

  ws.on("error", (error: Error) => {
    log(`WebSocket error: ${error.message}`, "info");
  });
});

// Serve static files
app.use(express.static("public"));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start server
server.listen(PORT, async () => {
  log(`🚀 ElizaOS Agent running at http://localhost:${PORT}`, "info");
  log(`Open http://localhost:${PORT} in your browser to chat`, "info");
  
  // KeeperGate Integration: Initialize KeeperGate on startup
  await initializeKeeperGate();
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...", "info");
  wss.clients.forEach((client: WebSocket) => {
    client.close();
  });
  server.close(() => {
    process.exit(0);
  });
});
