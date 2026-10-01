import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, type ExtensionAPI, type ExtensionContext, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { resumeAgent, runAgent, type ToolActivity } from "../../src/agent-runner.js";
import { registerAgents } from "../../src/agent-types.js";
import { fauxModelBackend } from "../helpers/faux-model-backend.js";
import { registerFauxProvider } from "../helpers/pi-ai.js";

it.each(["allowlist", "extension denylist", "tool denylist", "extensions disabled", "isolated"])(
  "keeps late nested calls scoped across resume: %s",
  async (mode) => {
    const cwd = mkdtempSync(join(tmpdir(), "nested-scope-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", cwd);
    const faux = registerFauxProvider({ provider: "scope-faux", models: [{ id: "scope" }] });
    const { modelRuntime } = await fauxModelBackend(faux.getModel());
    let parentContext: ExtensionContext | undefined;
    let parentApi: ExtensionAPI | undefined;
    const loader = new DefaultResourceLoader({
      cwd, agentDir: cwd, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi) => {
        parentApi = pi;
        pi.on("session_start", (_event, ctx) => { parentContext = ctx; });
      }],
    });
    await loader.reload();
    const { session: parent } = await createAgentSession({
      cwd, agentDir: cwd, modelRuntime, model: faux.getModel(), resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
    });
    await parent.bindExtensions({});
    const fixture = fileURLToPath(new URL("../fixtures/scope-probe.ts", import.meta.url));
    const internalPath = "<inline:pi-subagents-tool-scope>";
    const extensionsDisabled = mode === "extensions disabled" || mode === "isolated";
    registerAgents(new Map([["scope-probe", {
      name: "scope-probe", description: "scope", builtinToolNames: [],
      extensions: mode === "extensions disabled" ? false : mode === "extension denylist" ? ["*", fixture] : [fixture],
      // Even explicitly naming the internal extension cannot select or exclude it.
      excludeExtensions: mode === "extension denylist" ? [internalPath] : undefined,
      extSelectors: ["ext:scope-probe/allowed", "ext:scope-probe/permitted-1", "ext:scope-probe/permitted-2", `ext:${internalPath}`],
      disallowedTools: mode === "tool denylist" ? ["denied-1", "denied-2"] : undefined,
      skills: false, systemPrompt: "Probe nested tools", promptMode: "replace",
      inheritContext: false, runInBackground: false, isolated: false, persistSession: false,
    }]]));
    const warnings: ToolActivity[] = [];
    let child: Awaited<ReturnType<typeof runAgent>> | undefined;
    try {
      if (!parentContext || !parentApi) throw new Error("Parent extension did not bind");
      for (const generation of [1, 2]) {
        faux.setResponses(extensionsDisabled ? [
          (context) => {
            expect(getCurrentTools(context.messages)).toEqual([]);
            return fauxAssistantMessage("no tools");
          },
        ] : [
          (context) => {
            const names = getCurrentTools(context.messages)?.map(tool => tool.name) ?? [];
            expect(names).toContain("allowed");
            expect(names.some(name => name.startsWith("denied"))).toBe(false);
            return fauxAssistantMessage(fauxToolCall("allowed", {}), { stopReason: "toolUse" });
          },
          (context) => fauxAssistantMessage(JSON.stringify(context.messages.filter(message => message.role === "toolResult").slice(-1))),
        ]);
        let text: string;
        if (!child) {
          child = await runAgent(parentContext, "scope-probe", "go", {
            pi: parentApi, isolated: mode === "isolated", onToolActivity: event => warnings.push(event),
          });
          text = child.responseText;
        } else {
          text = (await resumeAgent(child.session, "again")).text;
        }
        const internal = child.session.resourceLoader.getExtensions().extensions.find(extension => extension.path === internalPath);
        if (extensionsDisabled) {
          expect(internal).toBeUndefined();
          expect(text).toBe("no tools");
        } else {
          expect(internal?.hidden).toBe(true);
          expect(internal?.tools.size).toBe(0);
          expect(warnings.some(event => event.toolName.includes(`ext:${internalPath}`) && event.toolName.includes("not loaded"))).toBe(true);
          expect(text).toContain(`permitted-${generation}-EXECUTED`);
          expect(text).not.toContain(`denied-${generation}-EXECUTED`);
          expect(text).toContain(mode === "tool denylist" ? "not found" : "not available to this subagent");
        }
      }
    } finally {
      child?.session.dispose();
      parent.dispose();
      faux.unregister();
      vi.unstubAllEnvs();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000,
);
