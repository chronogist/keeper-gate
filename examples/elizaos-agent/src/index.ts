import express, { Express, Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import * as path from "path";
import "dotenv/config";

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

// Simple message generator using OpenRouter
async function generateResponse(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set in environment. Get one at https://openrouter.ai"
    );
  }

  const model = process.env.ELIZAOS_MODEL || "openai/gpt-oss-20b:free";

  log(`Calling ${model}`, "tool");

  try {
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
    log(`Received response from ${model}`, "response");
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
server.listen(PORT, () => {
  log(`🚀 ElizaOS Agent running at http://localhost:${PORT}`, "info");
  log(`Open http://localhost:${PORT} in your browser to chat`, "info");
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
