import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, type ExtensionContext, SessionManager, SettingsManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMentionClone } from "../../src/mention-clone.js";
import { fauxModelBackend } from "../helpers/faux-model-backend.js";
import { registerFauxProvider } from "../helpers/pi-ai.js";

describe("mention clone against real Pi", () => {
  let cwd: string;
  let faux: ReturnType<typeof registerFauxProvider>;
  let parent: Awaited<ReturnType<typeof createAgentSession>>["session"];
  let ctx: ExtensionContext;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-mention-clone-"));
    faux = registerFauxProvider({ provider: "mention-custom", models: [{ id: "clone-model", contextWindow: 200_000 }] });
    const { modelRuntime } = await fauxModelBackend(faux.getModel());
    const loader = new DefaultResourceLoader({
      cwd, agentDir: cwd, noExtensions: true, noSkills: true,
      noThemes: true, noPromptTemplates: true, noContextFiles: true,
      systemPromptOverride: () => "LIVE-PARENT-PROMPT",
      appendSystemPromptOverride: () => [],
      extensionFactories: [(pi) => {
        pi.on("session_start", (_event, context) => { ctx = context; });
      }],
    });
    await loader.reload();
    ({ session: parent } = await createAgentSession({
      cwd, agentDir: cwd, model: faux.getModel(), modelRuntime,
      resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      tools: [],
    }));
    await parent.bindExtensions({});
  });

  afterEach(() => {
    parent?.dispose();
    faux.unregister();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("restores only the active branch, including compaction and edits, without changing its parent", async () => {
    const manager = parent.sessionManager;
    manager.appendMessage({ role: "user", content: "SUMMARIZED-ORIGINAL", timestamp: 1 });
    const kept = manager.appendMessage({ role: "user", content: "REPLACED-ORIGINAL", timestamp: 2 });
    manager.appendCompaction("COMPACTION-SUMMARY", kept, 1000);
    manager.appendContextEdit(kept, { content: "EDITED-CONTENT" });
    const omitted = manager.appendMessage({ role: "user", content: "OMITTED-CONTENT", timestamp: 3 });
    const activeLeaf = manager.appendContextEdit(omitted, null);
    manager.appendMessage({ role: "user", content: "INACTIVE-BRANCH", timestamp: 4 });
    manager.branch(activeLeaf);
    const before = structuredClone(manager.getEntries());
    const parentId = manager.getSessionId();
    let request: TranscriptContext | undefined;
    let nestedCallIsError: boolean | undefined;
    const execute = vi.fn<ToolDefinition["execute"]>(async (_id, _params, _signal, _update, toolCtx) => {
      const denied = await toolCtx.executeTool("bash", { command: "false" });
      nestedCallIsError = denied.isError;
      return { content: [{ type: "text", text: "Started" }], details: {} };
    });
    const agentTool: ToolDefinition = {
      name: "Agent", label: "Agent", description: "Spawn one agent",
      parameters: Type.Object({ prompt: Type.String(), run_in_background: Type.Boolean() }),
      execute,
    };
    faux.setResponses([
      (context, options) => {
        expect(options?.sessionId).toBeTypeOf("string");
        expect(options?.sessionId).not.toBe(parentId);
        request = context;
        return fauxAssistantMessage([
          fauxToolCall("Agent", { prompt: "go", run_in_background: false }, { id: "clone-1" }),
          fauxToolCall("Agent", { prompt: "duplicate", run_in_background: false }, { id: "clone-2" }),
        ], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("done"),
    ]);
    const result = await runMentionClone({ ctx, type: "Explore", message: "MENTION-MESSAGE", agentTool });
    expect(result).toEqual({ spawned: true });
    expect(execute).toHaveBeenCalledTimes(1);
    const [id, params, , , toolCtx] = execute.mock.calls[0];
    expect(id).toBeUndefined();
    expect(params).toMatchObject({ run_in_background: true });
    expect(toolCtx.sessionManager).toBe(ctx.sessionManager);
    expect(toolCtx.sessionManager.getSessionId()).toBe(parentId);
    expect(toolCtx.cwd).toBe(cwd);
    expect(toolCtx.modelRegistry).toBe(ctx.modelRegistry);
    expect(toolCtx.tools.map(tool => tool.name)).toEqual(["Agent"]);
    expect(nestedCallIsError).toBe(true);
    if (!request) throw new Error("Custom provider was not invoked");
    expect(getCurrentSystemPrompt(request.messages)).toContain("LIVE-PARENT-PROMPT");
    expect(getCurrentTools(request.messages).map(tool => tool.name)).toEqual(["Agent"]);
    const history = JSON.stringify(request.messages);
    for (const marker of ["COMPACTION-SUMMARY", "EDITED-CONTENT", "MENTION-MESSAGE"]) expect(history).toContain(marker);
    for (const marker of ["SUMMARIZED-ORIGINAL", "REPLACED-ORIGINAL", "OMITTED-CONTENT", "INACTIVE-BRANCH"]) expect(history).not.toContain(marker);
    expect(manager.getEntries()).toEqual(before);
    expect(manager.getLeafId()).toBe(activeLeaf);
    expect(manager.getSessionId()).toBe(parentId);
  }, 30_000);
});
