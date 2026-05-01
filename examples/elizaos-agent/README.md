# ElizaOS Agent

A simple, pure ElizaOS agent with a web interface for chatting. This is a standalone agent that doesn't integrate with KeeperHub or KeeperGate.

Features:
- 🤖 Web-based chat interface
- 📋 Real-time terminal logs visible in UI
- 🔍 See all tool calls and responses
- 💬 Real-time WebSocket communication
- ⚡ Uses OpenRouter with gpt-oss-20b (free tier)

## Features

- 🤖 AI-powered chat using OpenAI's GPT-3.5-turbo
- 💬 CLI interface with a simple conversational interface
- 🎭 Customizable personality (see `character.json`)
- ⚡ Fast and lightweight

## Setup

### Prerequisites

- Node.js 18+ (or bun)
- pnpm (or npm)
- OpenRouter API key (same as KeeperGate uses)

### Installation

1. Navigate to the elizaos-agent directory:

```bash
cd examples/elizaos-agent
```

2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file in the project root with your OpenRouter API key:

```bash
cp ../../.env .env
# Or manually add:
echo "OPENROUTER_API_KEY=sk-or-v1-your-key-here" > .env
```

Get an OpenRouter API key from: https://openrouter.ai/

By default, the agent uses **`openai/gpt-oss-20b:free`** (same model as KeeperGate demo).

## Usage

### Run the agent

```bash
pnpm start
```

Open your browser at `http://localhost:3000` and start chatting!

You'll see:
- **Left side**: Chat interface with your messages and Eliza's responses
- **Right side**: Terminal logs showing all API calls, tool invocations, and responses in real-time

### Development mode (with hot reload)

```bash
pnpm dev
```

### Type check

```bash
pnpm typecheck
```

## Chatting with Eliza

1. Open `http://localhost:3000` in your browser
2. Type a message in the input field
3. Press Enter or click Send
4. Watch the terminal logs on the right for real-time API calls
5. See Eliza's response in the chat

### Logs You'll See

- **ℹ️ Info**: Connection status, server events
- **📝 Log**: User messages being processed
- **🔧 Tool**: API calls to OpenRouter
- **✅ Response**: Successful responses received
- **❌ Error**: Any errors that occur

## Customization

### Change the personality

Edit `character.json` to customize:
- **name**: Agent name
- **system**: System prompt that defines behavior
- **bio**: Agent biography
- **style**: Communication style guidelines
- **topics**: Areas of expertise

Example system prompt change:

```json
{
  "system": "You are Shakespeare, responding in Elizabethan English..."
}
```

### Change the model

The model is configured via the `ELIZAOS_MODEL` environment variable. See the "Customizing the Model" section above for details and examples.

### Add memory or persistence

You can extend the agent by:
1. Adding a database backend (PostgreSQL with pglite)
2. Storing conversation history
3. Building memory/context over time

See the main ElizaOS docs for advanced customization.

## Customizing the Model

By default, the agent uses `openai/gpt-oss-20b:free`. To use a different model:

```bash
# Set environment variable before running
export ELIZAOS_MODEL=openai/gpt-4o-mini
pnpm start
```

Or in your `.env` file:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
ELIZAOS_MODEL=openai/gpt-4o-mini
```

Popular OpenRouter models:
- `openai/gpt-oss-20b:free` (default, free tier)
- `openai/gpt-4o-mini` (affordable)
- `openai/gpt-4o` (more powerful)
- `anthropic/claude-3-5-sonnet` (Claude)

See https://openrouter.ai/docs/models for full list.

## Troubleshooting

### "OPENROUTER_API_KEY not set"

Make sure you've created the `.env` file with your API key:

```bash
echo "OPENROUTER_API_KEY=sk-or-v1-..." > .env
```

### "Invalid API key" or "401 Unauthorized"

Check that:
1. Your API key is correct (should start with `sk-or-v1-`)
2. Your OpenRouter account has credits
3. The key hasn't been revoked
4. Check https://openrouter.ai/account/billing/overview for account status

### Connection errors

Make sure you have internet access and OpenRouter's API is reachable (https://openrouter.ai).

## Project Structure

```
elizaos-agent/
├── src/
│   └── index.ts          # Main agent code
├── character.json        # Agent personality config
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
└── README.md            # This file
```

## Next Steps

To extend this agent:

1. **Add plugins**: Install elizaos plugins (Discord, Twitter, etc.)
2. **Add custom actions**: Create custom tools/actions for the agent
3. **Persistent memory**: Add database storage for conversations
4. **Deploy**: Ship to production using Eliza Cloud or Docker

See https://docs.elizaos.ai/ for full documentation.

## License

MIT (matching the main KeeperGate project)
