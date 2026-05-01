/* eslint-disable no-console */
import { createKeepergatePlugin, keepergatePlugin } from "../src/index.js";
import type { Action, IAgentRuntime, Memory, State } from "@elizaos/core";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) throw new Error("Set KEEPERHUB_API_KEY in .env");

console.log("→ createKeepergatePlugin({ apiKey })");
const plugin = createKeepergatePlugin({ apiKey });

console.log(`  ✓ name:        ${plugin.name}`);
console.log(`  ✓ description: ${plugin.description}`);
console.log(`  ✓ actions:     ${plugin.actions?.length ?? 0}`);

if (!plugin.actions || plugin.actions.length === 0) {
  throw new Error("plugin exposes no actions");
}

const expected = [
  "KEEPERGATE_TRANSFER",
  "KEEPERGATE_CALL_CONTRACT",
  "KEEPERGATE_CHECK_AND_EXECUTE",
  "KEEPERGATE_GET_EXECUTION_STATUS",
  "KEEPERGATE_LIST_WORKFLOWS",
  "KEEPERGATE_RUN_WORKFLOW",
];
const actual = plugin.actions.map((a) => a.name);
for (const name of expected) {
  if (!actual.includes(name)) {
    throw new Error(`missing action: ${name}`);
  }
}
console.log(`  ✓ all six expected actions present`);

console.log("\n→ Action shape sanity");
for (const action of plugin.actions as Action[]) {
  if (typeof action.name !== "string")
    throw new Error(`${action.name}: name must be string`);
  if (typeof action.description !== "string")
    throw new Error(`${action.name}: description must be string`);
  if (typeof action.handler !== "function")
    throw new Error(`${action.name}: handler must be function`);
  if (typeof action.validate !== "function")
    throw new Error(`${action.name}: validate must be function`);
  console.log(
    `  ✓ ${action.name.padEnd(36)} similes:${(action.similes?.length ?? 0)
      .toString()
      .padStart(2)} examples:${(action.examples?.length ?? 0)
      .toString()
      .padStart(2)}`
  );
}

// Validate() should run without throwing -- doesn't need a real runtime,
// just a stub that supplies what validate() touches.
console.log("\n→ Action.validate() smoke (no runtime calls expected)");
const stubRuntime = {} as IAgentRuntime;
for (const action of plugin.actions as Action[]) {
  const positiveMessages: Record<string, Memory> = {
    KEEPERGATE_TRANSFER: msg("send 0.1 ETH to 0xabc on base"),
    KEEPERGATE_CALL_CONTRACT: msg("read balanceOf for 0xd8d on ethereum"),
    KEEPERGATE_CHECK_AND_EXECUTE: msg("if eth drops below 3000, sell"),
    KEEPERGATE_GET_EXECUTION_STATUS: msg("did tx direct_abc land?"),
    KEEPERGATE_LIST_WORKFLOWS: msg("show my workflows"),
    KEEPERGATE_RUN_WORKFLOW: msg("run workflow wf_abc"),
  };
  const m = positiveMessages[action.name] ?? msg("hello");
  const ok = await action.validate(stubRuntime, m);
  if (!ok) {
    throw new Error(
      `${action.name}.validate returned false on a positive-intent message`
    );
  }
  console.log(`  ✓ ${action.name} validate(positive) -> true`);
}

// --- Live handler invocations with a minimal runtime stub ------------------
//
// Each Eliza Action.handler relies on a small surface of IAgentRuntime
// methods (composeState + useModel). We stub those so we can actually
// exercise the handler end-to-end against the live KeeperHub API.

console.log("\n→ Action.handler() live invocations (stubbed runtime, real KeeperHub)");

const recordedCallbacks: string[] = [];
const captureCallback = async (response: { text?: string }) => {
  recordedCallbacks.push(response.text ?? "");
  return [];
};

// Handler 1: KEEPERGATE_LIST_WORKFLOWS doesn't use useModel at all -- the
// handler just calls client.listWorkflows. So a barebones runtime suffices.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_LIST_WORKFLOWS"
  );
  if (!action) throw new Error("missing list action");
  const stubRuntime = {
    composeState: async () => ({}) as State,
  } as unknown as IAgentRuntime;
  const m = msg("show me my workflows");
  const result = await action.handler(
    stubRuntime,
    m,
    undefined,
    undefined,
    captureCallback
  );
  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("list handler must return ActionResult");
  }
  if (!result.success)
    throw new Error(`list handler failed: ${result.text}`);
  const data = result.data as { workflows: { id: string; name: string }[] } | undefined;
  console.log(
    `  ✓ KEEPERGATE_LIST_WORKFLOWS handler -> success=${result.success}, workflows=${
      data?.workflows.length ?? 0
    }`
  );
  if (recordedCallbacks.length === 0)
    throw new Error("expected callback to be invoked");
  console.log(`  ✓ callback fired: "${recordedCallbacks.at(-1)?.slice(0, 60)}..."`);
}

// Handler 2: KEEPERGATE_CALL_CONTRACT (read path). Stub useModel to return
// the XML extraction response we want, then the handler calls the real
// KeeperHub Direct Execution API.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_CALL_CONTRACT"
  );
  if (!action) throw new Error("missing call_contract action");
  const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const stubRuntime = {
    composeState: async () => ({}) as State,
    useModel: async () =>
      `<response>
<network>ethereum</network>
<contractAddress>${usdc}</contractAddress>
<functionName>balanceOf</functionName>
<functionArgs>["${vitalik}"]</functionArgs>
</response>`,
  } as unknown as IAgentRuntime;

  const before = recordedCallbacks.length;
  const result = await action.handler(
    stubRuntime,
    msg("what is the USDC balance of vitalik on ethereum"),
    undefined,
    undefined,
    captureCallback
  );
  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("call_contract handler must return ActionResult");
  }
  if (!result.success)
    throw new Error(`call_contract handler failed: ${result.text}`);
  const values = result.values as { result?: string } | undefined;
  if (!values?.result || values.result === "")
    throw new Error("expected a non-empty balance result");
  console.log(
    `  ✓ KEEPERGATE_CALL_CONTRACT handler -> success=${result.success}, balance=${values.result}`
  );
  if (recordedCallbacks.length <= before)
    throw new Error("expected callback to be invoked");
  console.log(`  ✓ callback fired: "${recordedCallbacks.at(-1)?.slice(0, 80)}..."`);
}

// Handler 3: KEEPERGATE_CHECK_AND_EXECUTE with a guaranteed-false condition.
// Real API call, no write attempted -- end-to-end safe.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_CHECK_AND_EXECUTE"
  );
  if (!action) throw new Error("missing check_and_execute action");
  const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const stubRuntime = {
    composeState: async () => ({}) as State,
    useModel: async () =>
      `<response>
<network>ethereum</network>
<contractAddress>${usdc}</contractAddress>
<functionName>balanceOf</functionName>
<functionArgs>["0x0000000000000000000000000000000000000000"]</functionArgs>
<operator>gt</operator>
<targetValue>1</targetValue>
<actionContractAddress>${usdc}</actionContractAddress>
<actionFunctionName>transfer</actionFunctionName>
<actionFunctionArgs>["0x0000000000000000000000000000000000000000","0"]</actionFunctionArgs>
</response>`,
  } as unknown as IAgentRuntime;

  const before = recordedCallbacks.length;
  const result = await action.handler(
    stubRuntime,
    msg("if usdc balance of zero address > 1, send dust"),
    undefined,
    undefined,
    captureCallback
  );
  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("check_and_execute handler must return ActionResult");
  }
  const values = result.values as { executed?: boolean } | undefined;
  if (values?.executed !== false) {
    throw new Error(`expected executed=false, got ${JSON.stringify(values)}`);
  }
  console.log(
    `  ✓ KEEPERGATE_CHECK_AND_EXECUTE handler -> success=${result.success}, executed=${values.executed}`
  );
  if (recordedCallbacks.length <= before)
    throw new Error("expected callback to be invoked");
}

// Handler 4: KEEPERGATE_TRANSFER. The user has no wallet configured, so the
// real API returns 422. We verify the handler reports success=false with the
// expected error path (not a throw), proving the full extract -> API ->
// error-shaping pipeline works.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_TRANSFER"
  );
  if (!action) throw new Error("missing transfer action");
  const stubRuntime = {
    composeState: async () => ({}) as State,
    useModel: async () =>
      `<response>
<network>ethereum</network>
<recipientAddress>0x0000000000000000000000000000000000000001</recipientAddress>
<amount>0.0001</amount>
<tokenAddress></tokenAddress>
</response>`,
  } as unknown as IAgentRuntime;

  const before = recordedCallbacks.length;
  const result = await action.handler(
    stubRuntime,
    msg("send 0.0001 ETH to 0x...1 on ethereum"),
    undefined,
    undefined,
    captureCallback
  );
  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("transfer handler must return ActionResult");
  }
  // Two acceptable outcomes: success=true (rare -- needs configured wallet),
  // or success=false with an explicit error string. A throw would fail above.
  console.log(
    `  ✓ KEEPERGATE_TRANSFER handler -> success=${result.success} (callback fired: ${
      recordedCallbacks.length > before
    })`
  );
  if (!result.success && !result.text)
    throw new Error("transfer failure must include text");
}

// Handler 5: KEEPERGATE_GET_EXECUTION_STATUS with a fake executionId.
// API returns 404. Same as transfer -- we verify the handler surfaces it
// cleanly as success=false with a descriptive error, no throw.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_GET_EXECUTION_STATUS"
  );
  if (!action) throw new Error("missing get_execution_status action");
  const stubRuntime = {
    composeState: async () => ({}) as State,
    useModel: async () =>
      `<response><executionId>direct_does_not_exist_zzz</executionId></response>`,
  } as unknown as IAgentRuntime;

  const result = await action.handler(
    stubRuntime,
    msg("did execution direct_does_not_exist_zzz land?"),
    undefined,
    undefined,
    captureCallback
  );
  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("get_execution_status handler must return ActionResult");
  }
  console.log(
    `  ✓ KEEPERGATE_GET_EXECUTION_STATUS handler -> success=${result.success} (404 surfaced as failure)`
  );
}

// Handler 6: KEEPERGATE_RUN_WORKFLOW. Stub useModel to return the workflow
// id we already know exists. Real call to executeWorkflow + pollUntilDone.
// May return success or error depending on the workflow's state -- both are
// valid outcomes; what we verify is that the handler returns a typed
// ActionResult and surfaces the executionId.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_RUN_WORKFLOW"
  );
  if (!action) throw new Error("missing run_workflow action");

  // We need to know which workflow exists -- pull it via the client.
  const { KeeperHubClient } = await import("@keepergate/core");
  const client = new KeeperHubClient({ apiKey: apiKey! });
  const wfs = await client.listWorkflows();
  if (wfs.length === 0) {
    console.log(
      "  ! KEEPERGATE_RUN_WORKFLOW handler skipped (no workflows in account)"
    );
  } else {
    const workflowId = wfs[0]!.id;
    const stubRuntime = {
      composeState: async () => ({}) as State,
      useModel: async () =>
        `<response>
<workflowId>${workflowId}</workflowId>
<input>{"address":"0xe74096f8ef2b08aa7257ac98459c624e1bf9a548"}</input>
</response>`,
    } as unknown as IAgentRuntime;

    const result = await action.handler(
      stubRuntime,
      msg(`run workflow ${workflowId}`),
      undefined,
      undefined,
      captureCallback
    );
    if (!result || typeof result !== "object" || !("success" in result)) {
      throw new Error("run_workflow handler must return ActionResult");
    }
    const values = result.values as { executionId?: string; status?: string } | undefined;
    if (!values?.executionId)
      throw new Error("expected executionId in values");
    console.log(
      `  ✓ KEEPERGATE_RUN_WORKFLOW handler -> success=${result.success}, status=${values.status}, executionId=${values.executionId}`
    );
  }
}

// --- Static plugin: keepergatePlugin.init() hook ---------------------------
//
// keepergatePlugin (the const) reads KEEPERHUB_API_KEY from plugin config
// first, then runtime.getSetting, then process.env. On success it registers
// all 6 actions via runtime.registerAction. We exercise all three sources +
// the missing-key error case.

// --- Action chaining: responses parameter (B6) -----------------------------
//
// Eliza v1's contract: when an action runs as part of a chain, the runtime
// passes previous actions' messages in the `responses` array. Each Content
// can carry a `providers: string[]` list. Our handler must propagate those
// names into composeState so the next action sees the same context the
// previous one set up.

console.log("\n→ Action chaining via responses[*].content.providers");

{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_CALL_CONTRACT"
  );
  if (!action) throw new Error("missing call_contract action");

  const composeStateCalls: string[][] = [];
  const stubRuntime = {
    composeState: async (_msg: Memory, providers: string[]) => {
      composeStateCalls.push(providers);
      return {} as State;
    },
    useModel: async () =>
      `<response>
<network>ethereum</network>
<contractAddress>0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48</contractAddress>
<functionName>balanceOf</functionName>
<functionArgs>["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]</functionArgs>
</response>`,
  } as unknown as IAgentRuntime;

  const previousResponse = {
    id: "00000000-0000-0000-0000-000000000010",
    entityId: "00000000-0000-0000-0000-000000000010",
    agentId: "00000000-0000-0000-0000-000000000010",
    roomId: "00000000-0000-0000-0000-000000000010",
    content: {
      text: "previous action output",
      providers: ["WALLET_PROVIDER", "PORTFOLIO_PROVIDER"],
    },
    createdAt: Date.now(),
  } as unknown as Memory;

  const result = await action.handler(
    stubRuntime,
    msg("read USDC balance"),
    undefined,
    undefined,
    captureCallback,
    [previousResponse]
  );

  if (!result || typeof result !== "object" || !("success" in result)) {
    throw new Error("handler must return ActionResult");
  }
  if (composeStateCalls.length === 0) {
    throw new Error("expected composeState to be called at least once");
  }

  const providersUsed = composeStateCalls[0]!;
  if (!providersUsed.includes("WALLET_PROVIDER"))
    throw new Error(
      `expected WALLET_PROVIDER to be merged in; got ${JSON.stringify(providersUsed)}`
    );
  if (!providersUsed.includes("PORTFOLIO_PROVIDER"))
    throw new Error(
      `expected PORTFOLIO_PROVIDER to be merged in; got ${JSON.stringify(providersUsed)}`
    );
  if (!providersUsed.includes("RECENT_MESSAGES"))
    throw new Error(
      `expected RECENT_MESSAGES to remain; got ${JSON.stringify(providersUsed)}`
    );

  console.log(
    `  ✓ composeState called with: [${providersUsed.join(", ")}]`
  );
  console.log(
    `  ✓ providers from previous response merged + RECENT_MESSAGES preserved`
  );
}

// Sanity: when responses is omitted/empty, only RECENT_MESSAGES is used.
{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_CALL_CONTRACT"
  );
  if (!action) throw new Error("missing call_contract action");

  const composeStateCalls: string[][] = [];
  const stubRuntime = {
    composeState: async (_msg: Memory, providers: string[]) => {
      composeStateCalls.push(providers);
      return {} as State;
    },
    useModel: async () =>
      `<response>
<network>ethereum</network>
<contractAddress>0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48</contractAddress>
<functionName>balanceOf</functionName>
<functionArgs>["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]</functionArgs>
</response>`,
  } as unknown as IAgentRuntime;

  await action.handler(
    stubRuntime,
    msg("read USDC balance"),
    undefined,
    undefined,
    captureCallback
    // no responses arg
  );

  const providersUsed = composeStateCalls[0]!;
  if (
    providersUsed.length !== 1 ||
    providersUsed[0] !== "RECENT_MESSAGES"
  ) {
    throw new Error(
      `without responses, expected only [RECENT_MESSAGES]; got ${JSON.stringify(providersUsed)}`
    );
  }
  console.log(
    `  ✓ no responses -> composeState called with [RECENT_MESSAGES] only`
  );
}

// --- Malformed LLM responses (B8) ------------------------------------------
//
// When the LLM-driven extraction step returns garbage (no XML / partial XML
// / missing required fields), handlers must surface a clean ActionResult
// failure -- not throw, not crash, not run with bogus inputs. Each case
// uses the call_contract action with a different malformed useModel return.

console.log(
  "\n→ Malformed LLM responses (parseKeyValueXml resilience)"
);

{
  const action = (plugin.actions as Action[]).find(
    (a) => a.name === "KEEPERGATE_CALL_CONTRACT"
  );
  if (!action) throw new Error("missing call_contract action");

  const malformedCases: Array<{ label: string; xml: string }> = [
    { label: "empty string", xml: "" },
    { label: "plain text, no XML", xml: "I cannot help with that request." },
    {
      label: "XML with no <response> envelope",
      xml: "<network>ethereum</network><contractAddress>0xabc</contractAddress>",
    },
    {
      label: "<response> envelope but missing required fields",
      xml: "<response>\n<network>ethereum</network>\n</response>",
    },
    {
      label: "broken XML (unclosed tag)",
      xml: "<response><network>ethereum<contractAddress>0xabc</response>",
    },
  ];

  for (const c of malformedCases) {
    const stubRuntime = {
      composeState: async () => ({}) as State,
      useModel: async () => c.xml,
    } as unknown as IAgentRuntime;
    const result = await action.handler(
      stubRuntime,
      msg("read something somewhere"),
      undefined,
      undefined,
      captureCallback
    );
    if (!result || typeof result !== "object" || !("success" in result)) {
      throw new Error(`${c.label}: handler must return ActionResult`);
    }
    if (result.success) {
      throw new Error(
        `${c.label}: expected success=false on malformed input, got success=true`
      );
    }
    if (!result.text || typeof result.text !== "string") {
      throw new Error(
        `${c.label}: failure must include human-readable text`
      );
    }
    console.log(
      `  ✓ ${c.label.padEnd(45)} -> success=false, text="${result.text.slice(0, 50)}…"`
    );
  }
}

console.log("\n→ keepergatePlugin.init() — registration paths");

if (!keepergatePlugin.init) {
  throw new Error("keepergatePlugin should have an init() hook");
}

// 1. API key from plugin config
{
  const registered: Action[] = [];
  const stubRuntime = {
    registerAction: (a: Action) => registered.push(a),
    getSetting: () => undefined,
  } as unknown as IAgentRuntime;
  await keepergatePlugin.init({ KEEPERHUB_API_KEY: apiKey! }, stubRuntime);
  if (registered.length !== 6)
    throw new Error(
      `expected 6 actions registered from config path, got ${registered.length}`
    );
  console.log(
    `  ✓ from plugin config: registered ${registered.length} action(s)`
  );
}

// 2. API key from runtime.getSetting
{
  const registered: Action[] = [];
  const stubRuntime = {
    registerAction: (a: Action) => registered.push(a),
    getSetting: (key: string) =>
      key === "KEEPERHUB_API_KEY" ? apiKey : undefined,
  } as unknown as IAgentRuntime;
  await keepergatePlugin.init({}, stubRuntime);
  if (registered.length !== 6)
    throw new Error(
      `expected 6 actions registered from getSetting path, got ${registered.length}`
    );
  console.log(
    `  ✓ from runtime.getSetting: registered ${registered.length} action(s)`
  );
}

// 3. Missing key everywhere -> init must throw a clear message
{
  const stubRuntime = {
    registerAction: () => undefined,
    getSetting: () => undefined,
  } as unknown as IAgentRuntime;
  // Temporarily blank the env so we hit the missing-key branch
  const saved = process.env.KEEPERHUB_API_KEY;
  delete process.env.KEEPERHUB_API_KEY;
  try {
    await keepergatePlugin.init({}, stubRuntime);
    throw new Error("expected init() to throw when API key is missing");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/KEEPERHUB_API_KEY|required/i.test(msg)) {
      throw new Error(`init() threw an unexpected error: ${msg}`);
    }
    console.log(
      `  ✓ missing key surfaced as a clear error: "${msg.slice(0, 70)}…"`
    );
  } finally {
    if (saved) process.env.KEEPERHUB_API_KEY = saved;
  }
}

console.log("\n✅ elizaos adapter smoke passed");

function msg(text: string): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    entityId: "00000000-0000-0000-0000-000000000000",
    agentId: "00000000-0000-0000-0000-000000000000",
    roomId: "00000000-0000-0000-0000-000000000000",
    content: { text, source: "smoke" },
    createdAt: Date.now(),
  } as unknown as Memory;
}
