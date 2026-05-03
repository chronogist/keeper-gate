import {
  DirectExecutor,
  KeeperHubClient,
  type KeeperHubClientOptions,
} from "@keepergate/core";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { buildDirectTools } from "./direct-tools.js";
import { buildWorkflowTools } from "./workflow-tools.js";

const PLUGIN_ID = "keepergate";

export interface KeepergatePluginOptions extends KeeperHubClientOptions {}

/**
 * Build all six KeeperGate AnyAgentTool[] from a KeeperHubClient.
 * Convenience for callers that want the tools without the
 * definePluginEntry wrapper -- e.g. embedding inside another plugin.
 */
export function buildKeepergateTools(
  client: KeeperHubClient
): AnyAgentTool[] {
  const executor = new DirectExecutor(client);
  return [...buildDirectTools(executor), ...buildWorkflowTools(client)];
}

/**
 * Read the plugin's runtime config (apiKey, baseUrl) from the OpenClaw
 * tool context. OpenClaw stores plugin config under
 * runtimeConfig.plugins.entries[<pluginId>] (see openclaw.json).
 */
function readConfig(ctx: OpenClawPluginToolContext): KeepergatePluginOptions {
  // Try runtimeConfig first (primary), then config (fallback)
  const cfg = ctx.runtimeConfig ?? ctx.config;
  
  if (!cfg || typeof cfg !== 'object') {
    // If no config context, fall back to environment variable only
    const apiKey = process.env.KEEPERHUB_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[@keepergate/openclaw] KEEPERHUB_API_KEY is required. Either set it via plugin config or as an environment variable."
      );
    }
    return { apiKey };
  }

  // Safely extract plugin entries from config
  const entries = (cfg as Record<string, any>)?.plugins?.entries;
  if (!entries || typeof entries !== 'object') {
    // Config exists but no plugin entries section - use env var
    const apiKey = process.env.KEEPERHUB_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[@keepergate/openclaw] KEEPERHUB_API_KEY is required. Either set it via plugin config or as an environment variable."
      );
    }
    return { apiKey };
  }

  const own = (entries as Record<string, any>)?.[PLUGIN_ID] as Record<string, unknown> | undefined ?? {};
  
  // Extract apiKey from config or fall back to environment variable
  const configApiKey = typeof own.apiKey === "string" ? own.apiKey : null;
  const apiKey = configApiKey || process.env.KEEPERHUB_API_KEY;
  
  if (!apiKey) {
    throw new Error(
      "[@keepergate/openclaw] KEEPERHUB_API_KEY is required. Either set it via plugin config or as an environment variable."
    );
  }

  // Extract optional baseUrl from config
  const baseUrl = typeof own.baseUrl === "string" ? own.baseUrl : undefined;

  return { apiKey, baseUrl };
}

/**
 * The OpenClaw plugin entry. Imported from the package's main and named
 * in the package's `openclaw.plugin.json` manifest. Plugin authors who
 * want to register the tools manually can use buildKeepergateTools()
 * instead.
 *
 * @example
 *   // src/plugin-entry.ts (the file the manifest points at)
 *   export { default } from "@keepergate/openclaw";
 */
export const keepergatePluginEntry = definePluginEntry({
  id: PLUGIN_ID,
  name: "KeeperGate",
  description:
    "Reliable on-chain execution via KeeperHub: transfers, contract calls, conditional execution, and pre-built workflow triggers.",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        apiKey: {
          type: "string",
          description:
            "KeeperHub organisation API key (kh_...). Required.",
        },
        baseUrl: {
          type: "string",
          description:
            "Override the KeeperHub API base URL. Defaults to https://app.keeperhub.com/api.",
        },
      },
      required: [],
    },
  },
  register(api) {
    // The factory runs lazily for each tool invocation -- ctx is fresh,
    // so config changes (e.g. user rotating their key) take effect on
    // the next call without restarting the whole plugin.
    api.registerTool((ctx) => {
      const opts = readConfig(ctx);
      const client = new KeeperHubClient(opts);
      return buildKeepergateTools(client);
    });
  },
});

export default keepergatePluginEntry;
