/**
 * Pi's built-in codemode, tool-search, and MCP extensions in a subagent, against
 * the real SDK. Only pi's CLI loads built-ins, so this pins that `runAgent`
 * supplies them, that pi's activation rules (`defaultTools`, MCP exposure) hold
 * across turns, and that the user's `extensions` setting and the agent's
 * `extensions:` / `exclude_extensions:` / `isolated` still decide what loads.
 *
 * MCP is real end to end: `mcp.json` in the stubbed agent dir starts
 * test/fixtures/mcp-stdio-server.mjs over stdio.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, type ExtensionAPI, type ExtensionContext, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { runAgent } from "../../src/agent-runner.js";
import { registerAgents } from "../../src/agent-types.js";
import type { AgentConfig } from "../../src/types.js";
import { fauxModelBackend } from "../helpers/faux-model-backend.js";
import { registerFauxProvider } from "../helpers/pi-ai.js";

const SERVER = fileURLToPath(new URL("../fixtures/mcp-stdio-server.mjs", import.meta.url));
const FETCH = "mcp__docs__fetch";
const SEARCH = "mcp__docs__search";

interface Scenario {
  name: string;
  /** Extra keys for the stubbed agent dir's settings.json. */
  settings?: Record<string, unknown>;
  agent?: Partial<AgentConfig>;
  isolated?: boolean;
  /** Declared to the model on BOTH turns. */
  declared: string[];
  /** Declared on neither turn. */
  undeclared: string[];
  /** Registered (callable by codemode/tool_search or activatable) after the run. */
  registered: string[];
  unregistered: string[];
  /** Turn 1 calls `mcp__docs__fetch`; turn 2 then sees its result. */
  callsFetch: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: "defaultTools +codemode, deferred MCP server with a direct tool",
    settings: { defaultTools: ["+codemode"] },
    // `search` is deferred: tool_search can load it, but nothing may declare
    // it on its own. The pre-1.0 widening re-narrow declared it on turn 2.
    declared: ["read", "grep", "codemode", "tool_search", FETCH],
    undeclared: [SEARCH],
    registered: ["codemode", "tool_search", FETCH, SEARCH],
    unregistered: [],
    callsFetch: true,
  },
  {
    name: "codemode registered but inactive without defaultTools",
    declared: ["read", "tool_search", FETCH],
    undeclared: ["codemode", SEARCH],
    registered: ["codemode", FETCH, SEARCH],
    unregistered: [],
    callsFetch: true,
  },
  {
    name: "the user's -builtin:codemode setting still disables it",
    settings: { defaultTools: ["+codemode"], extensions: ["-builtin:codemode"] },
    declared: ["read", FETCH],
    undeclared: ["codemode", SEARCH],
    registered: [FETCH],
    unregistered: ["codemode"],
    callsFetch: true,
  },
  {
    name: "exclude_extensions: builtin:mcp",
    settings: { defaultTools: ["+codemode"] },
    agent: { excludeExtensions: ["builtin:mcp"] },
    declared: ["read", "codemode"],
    undeclared: [FETCH, SEARCH],
    registered: ["codemode"],
    unregistered: [FETCH, SEARCH],
    callsFetch: false,
  },
  {
    name: "ext:builtin:mcp/mcp__docs__fetch narrows the built-in's tools",
    settings: { defaultTools: ["+codemode"] },
    agent: { extSelectors: [`ext:builtin:mcp/${FETCH}`] },
    declared: ["read", FETCH],
    undeclared: ["codemode", "tool_search", SEARCH],
    registered: [FETCH],
    unregistered: [],
    callsFetch: true,
  },
  {
    name: "isolated",
    settings: { defaultTools: ["+codemode"] },
    isolated: true,
    declared: ["read"],
    undeclared: ["codemode", "tool_search", FETCH, SEARCH],
    registered: [],
    unregistered: ["codemode", "tool_search", FETCH, SEARCH],
    callsFetch: false,
  },
];

it.each(SCENARIOS)("$name", async (scenario) => {
  const agentDir = mkdtempSync(join(tmpdir(), "builtin-ext-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "builtin-ext-cwd-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    retry: { enabled: false },
    compaction: { enabled: false },
    ...scenario.settings,
  }));
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: {
      docs: { command: process.execPath, args: [SERVER], exposure: "deferred", toolExposure: { fetch: "direct" } },
    },
  }));

  const faux = registerFauxProvider({ provider: "builtin-faux", models: [{ id: "builtin" }] });
  const { modelRuntime } = await fauxModelBackend(faux.getModel());
  let parentContext: ExtensionContext | undefined;
  let parentApi: ExtensionAPI | undefined;
  const loader = new DefaultResourceLoader({
    cwd, agentDir, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true,
    extensionFactories: [(pi) => {
      parentApi = pi;
      pi.on("session_start", (_event, ctx) => { parentContext = ctx; });
    }],
  });
  await loader.reload();
  const { session: parent } = await createAgentSession({
    cwd, agentDir, modelRuntime, model: faux.getModel(), resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
  });
  await parent.bindExtensions({});

  registerAgents(new Map([["builtin-probe", {
    name: "builtin-probe", description: "probe", builtinToolNames: ["read", "grep"],
    extensions: true, skills: false, systemPrompt: "Probe built-ins", promptMode: "replace",
    inheritContext: false, runInBackground: false, isolated: false, persistSession: false,
    ...scenario.agent,
  } as AgentConfig]]));

  const declaredPerTurn: string[][] = [];
  const declared = (context: Context) => {
    const names = getCurrentTools(context.messages)?.map((tool) => tool.name) ?? [];
    declaredPerTurn.push(names);
  };
  faux.setResponses([
    (context) => {
      declared(context);
      return scenario.callsFetch
        ? fauxAssistantMessage(fauxToolCall(FETCH, {}), { stopReason: "toolUse" })
        : fauxAssistantMessage("no call");
    },
    (context) => {
      declared(context);
      const results = context.messages.filter((message) => message.role === "toolResult");
      return fauxAssistantMessage(JSON.stringify(results.slice(-1)));
    },
  ]);

  let child: Awaited<ReturnType<typeof runAgent>> | undefined;
  try {
    if (!parentContext || !parentApi) throw new Error("Parent extension did not bind");
    child = await runAgent(parentContext, "builtin-probe", "go", { pi: parentApi, isolated: scenario.isolated });
    // A second turn without a tool call: the first ran through turn_end's re-narrow.
    if (!scenario.callsFetch) {
      faux.setResponses([(context) => { declared(context); return fauxAssistantMessage("again"); }]);
      await child.session.prompt("again");
    }

    expect(declaredPerTurn).toHaveLength(2);
    for (const names of declaredPerTurn) {
      for (const name of scenario.declared) expect(names, `declares ${name}`).toContain(name);
      for (const name of scenario.undeclared) expect(names, `does not declare ${name}`).not.toContain(name);
    }
    const registered = child.session.getAllTools().map((tool) => tool.name);
    for (const name of scenario.registered) expect(registered, `registers ${name}`).toContain(name);
    for (const name of scenario.unregistered) expect(registered, `does not register ${name}`).not.toContain(name);
    if (scenario.callsFetch) expect(child.responseText).toContain("fetch-EXECUTED");
  } finally {
    await child?.session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
    child?.session.dispose();
    parent.dispose();
    faux.unregister();
    vi.unstubAllEnvs();
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30_000);
