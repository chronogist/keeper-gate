import {
  type Content,
  type IAgentRuntime,
  type Memory,
  type State,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
  logger,
} from "@elizaos/core";

/**
 * Extract typed args from a user message using the agent's LLM.
 *
 * Eliza v1's recommended pattern: build a prompt from current state with a
 * key/value-XML extraction template, ask TEXT_SMALL to fill it in, parse the
 * XML back. Returns null if extraction fails -- callers fall back to action
 * defaults or surface an error to the user.
 *
 * @param hint A natural-language description of what fields to extract,
 *             plus the XML schema the model should emit. Example:
 *
 *               "Extract these fields from the latest message:
 *                <network>chain id or name</network>
 *                <recipient>0x... address</recipient>
 *                <amount>decimal string</amount>"
 */
export async function extractArgs<T extends Record<string, unknown>>(
  runtime: IAgentRuntime,
  message: Memory,
  state: State | undefined,
  hint: string,
  responses?: Memory[]
): Promise<T | null> {
  // Eliza v1's action-chaining contract: when an action runs as part of a
  // chain, the runtime passes the previous actions' messages in `responses`.
  // Each Content can carry a `providers: string[]` list -- our handler must
  // propagate those into composeState so the next action sees the same
  // context the previous one set up. See plugin-bootstrap's replyAction.
  const chainedProviders =
    responses?.flatMap(
      (r) => ((r.content as Content | undefined)?.providers ?? []) as string[]
    ) ?? [];

  const composed =
    state ??
    (await runtime.composeState(message, [
      ...chainedProviders,
      "RECENT_MESSAGES",
    ]));

  const template = `${hint}

Respond ONLY with the XML fields requested. Do not add any other text.`;

  const prompt = composePromptFromState({ state: composed, template });

  try {
    const raw = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      stopSequences: [],
    });
    
    if (!raw || typeof raw !== "string") {
      logger.error(
        { raw, type: typeof raw },
        "[keepergate] extractArgs received invalid model response"
      );
      return null;
    }

    const result = parseKeyValueXml<T>(raw);
    if (!result) {
      logger.warn(
        { raw: raw.slice(0, 200), template: hint.slice(0, 200) },
        "[keepergate] extractArgs failed to parse XML response"
      );
      return null;
    }
    return result;
  } catch (err) {
    logger.error(
      { err, message: message.content?.text?.slice(0, 100) },
      "[keepergate] extractArgs failed"
    );
    return null;
  }
}
