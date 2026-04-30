import {
  DirectExecutor,
  KeeperHubClient,
  type KeeperHubClientOptions,
} from "@keepergate/core";
import type { Plugin } from "@elizaos/core";
import { buildDirectActions } from "./direct-actions.js";
import { buildWorkflowActions } from "./workflow-actions.js";

export interface KeepergatePluginOptions extends KeeperHubClientOptions {}

/**
 * Build a fully configured ElizaOS plugin from a KeeperHub API key.
 *
 * @example
 * ```ts
 * import { createKeepergatePlugin } from "@keepergate/elizaos";
 *
 * const character = {
 *   ...,
 *   plugins: [createKeepergatePlugin({ apiKey: process.env.KEEPERHUB_API_KEY! })],
 * };
 * ```
 */
export function createKeepergatePlugin(
  opts: KeepergatePluginOptions
): Plugin {
  const client = new KeeperHubClient(opts);
  const executor = new DirectExecutor(client);
  return {
    name: "@keepergate/elizaos",
    description:
      "Reliable on-chain execution via KeeperHub: transfers, contract calls, conditional execution, and pre-built workflow triggers.",
    actions: [
      ...buildDirectActions(executor),
      ...buildWorkflowActions(client),
    ],
  };
}

/**
 * Statically registered plugin that reads its API key from runtime config
 * via Plugin.init. Use this form when adding the plugin by name in a
 * character file rather than constructing it explicitly:
 *
 * ```jsonc
 * {
 *   "plugins": ["@keepergate/elizaos"],
 *   "settings": { "secrets": { "KEEPERHUB_API_KEY": "kh_..." } }
 * }
 * ```
 */
export const keepergatePlugin: Plugin = {
  name: "@keepergate/elizaos",
  description:
    "Reliable on-chain execution via KeeperHub: transfers, contract calls, conditional execution, and pre-built workflow triggers.",
  init: async (config, runtime) => {
    const apiKey =
      config.KEEPERHUB_API_KEY ||
      runtime.getSetting?.("KEEPERHUB_API_KEY") ||
      process.env.KEEPERHUB_API_KEY;
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error(
        "[@keepergate/elizaos] KEEPERHUB_API_KEY is required (set via plugin config, runtime setting, or env var)."
      );
    }
    const baseUrl =
      config.KEEPERHUB_BASE_URL ||
      runtime.getSetting?.("KEEPERHUB_BASE_URL") ||
      process.env.KEEPERHUB_BASE_URL;
    const client = new KeeperHubClient({
      apiKey,
      baseUrl: typeof baseUrl === "string" ? baseUrl : undefined,
    });
    const executor = new DirectExecutor(client);
    // Register actions on the runtime at init time. The runtime is the
    // canonical place to add capabilities discovered after plugin construction.
    for (const action of buildDirectActions(executor)) {
      runtime.registerAction(action);
    }
    for (const action of buildWorkflowActions(client)) {
      runtime.registerAction(action);
    }
  },
};
