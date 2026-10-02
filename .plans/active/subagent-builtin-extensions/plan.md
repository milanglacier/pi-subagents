# Load Pi 1.0 built-in extensions in subagents

## Problem

Subagents never see `codemode`, `tool_search`, or MCP tools, even when the
agent allows all tools (`general-purpose`: `extensions: true`, no `tools:`)
and the user enables them (`defaultTools: ["+codemode"]`, `~/.pi/agent/mcp.json`).

## Root cause

- Pi 1.0 ships codemode, tool-search, MCP, and llama.cpp as built-in
  extensions (`dist/extensions/index.js` → `builtInExtensions`).
- Only the CLI's `main()` adds them, at `dist/main.js:451`:
  `extensionFactories = [...builtInExtensions, ...]`. `DefaultResourceLoader`
  creates `builtin:<name>` extension paths only for built-ins named in its
  `extensionFactories` (`core/resource-loader.js:245-251`,
  `core/package-manager.js:739`).
- `docs/sdk.md:116`: "SDK sessions do not [load them]; add
  `createCodemodeExtension()`, `createToolSearchExtension()`, and
  `createMcpExtension()` to the `extensionFactories` of `DefaultResourceLoader`."
- Subagents run in-process as SDK sessions. `runAgent` builds its own loader
  (`src/agent-runner.ts:759`), and its only factory is the
  `pi-subagents-tool-scope` guard.

Verified: a loader built the way `runAgent` builds it returns only the
`~/.pi/agent/extensions/*` entries. When `builtInExtensions` is added, it also
returns `builtin:codemode`, `builtin:tool-search`, `builtin:mcp`, and
`builtin:llama.cpp`.

## Second bug that loading them would expose

`installExtensionToolScope`'s `renarrow()` (`src/agent-runner.ts:285`) makes
**every** in-scope registered tool active: `getAllTools() ∩ inScope()`. That
made sense before Pi 1.0. In Pi 1.0 it overrides pi's activation rules:

- `codemode` and `tool_search` are registered with `defaultActive: false`
  (`extensions/codemode/index.js:26`, `extensions/tool-search/index.js:11`).
  `renarrow` would activate them even when `defaultTools` doesn't name them.
- MCP tools with `codemode`/`deferred` exposure are meant to stay out of the
  model's tool list. `_applyToolLoadout` only skips `hidden` tools, so
  `renarrow` would expose every such MCP tool directly. That defeats
  codemode/tool_search and bloats the context.
- It also ignores `defaultActive: false` on tools from ordinary extensions.
  This is already a bug today.

Pi 1.0 handles activation itself:

- At construction it runs `_refreshToolRegistry({ activeToolNames: initial,
  includeAllExtensionTools: true })` (`core/agent-session.js:198`). The initial
  set comes from `defaultTools`, or `DEFAULT_TOOL_NAMES` when that is unset,
  minus `excludeTools` (`core/sdk.js:148`). Every extension or custom tool
  registered at load time with `direct`/`model-only` exposure and
  `defaultActive !== false` is activated.
- Tools registered later (MCP on `session_start`) are activated on
  registration under the same rule (`_refreshToolRegistry`, the
  no-`activeToolNames` branch).

So the subagent only needs to narrow. The one place where widening is still
needed is the built-ins the agent asks for that pi doesn't activate by default
(`grep`/`find`/`ls` are not in `DEFAULT_TOOL_NAMES`).

## Goals

- `extensions: true` agents (all three defaults and most custom ones) load
  pi's built-in codemode, tool-search, and MCP extensions, the same way the
  CLI does.
- The user's pi settings work the same as in the parent session:
  - `extensions: ["-builtin:mcp"]` disables a built-in.
  - `defaultTools: ["+codemode"]` activates codemode.
  - MCP `exposure` and `toolExposure` are respected.
  - A third-party extension that registers `/mcp`/`codemode` replaces the
    built-in (`replaceable`).
- Existing scoping stays intact: `tools:`, `disallowed_tools:`, `ext:`
  narrowing, `extensions:` lists, `exclude_extensions:`, `isolated`, and the
  `tool_call` / `beforeToolCall` guards (codemode's `ctx.executeTool()` calls
  go through the `tool_call` guard).

## Non-goals

- `llama.cpp`. Its factory isn't exported from the package root. It is a model
  provider, and subagents already share the parent's `ModelRuntime`
  (`parentModelRuntime`), so its models should already resolve. Step 6 checks
  this.
- `mention-clone.ts`. It uses `noExtensions: true` on purpose. The clone only
  needs its own `Agent` tool.
- Running subagents as subprocesses.

## Design

### 1. Built-in extension factories — new `src/builtin-extensions.ts`

```ts
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

/**
 * Pi's CLI-only built-in extensions, in the shape and order `main()` passes
 * them (`dist/extensions/index.js`). ...
 */
export function builtinExtensions(): InlineExtension[] {
  return [
    { name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
    { name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
    { name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
  ];
}
```

- Names must match the CLI's exactly. The package manager turns them into
  `builtin:<name>`, which is how `-builtin:mcp` in settings and `pi config`
  refer to them.
- Use `builtin: true`, not a bare factory as in `examples/sdk/14-codemode-mcp.ts`.
  A bare factory loads as `<inline:…>` and ignores both the `extensions`
  setting and `replaceable`.
- New factories are built for each run. `createMcpExtension()` keeps its
  server and connection state in the factory closure, so concurrent subagents
  must not share one.
- Check that `InlineExtension` is exported from the package root. It is listed
  in `index.d.ts:8`.

### 2. Wire into `runAgent`'s loader (`src/agent-runner.ts:765`)

```ts
extensionFactories: noExtensions ? [] : [
  ...builtinExtensions(),
  { name: TOOL_SCOPE_EXTENSION_NAME, hidden: true, factory: ... },
],
```

- `isolated` / `extensions: false` → no built-ins. This matches pi's own
  `--no-extensions`.
- `extensionsOverride` filtering: built-ins appear in `base.extensions` with
  `path: "builtin:<name>"`. `extensionCanonicalName("builtin:mcp")` returns
  `"builtin:mcp"` (no slash, no `.ts`), which is the name the user's settings
  use. With no code change:
  - `extensions: [builtin:mcp, foo]` keeps it. `parseExtensionsSpec` treats
    the entry as a name because it has no `/` or `~`.
  - `exclude_extensions: [builtin:mcp]` drops it.
  - `ext:builtin:mcp/mcp__exa__web_search_exa` narrows it. The split is on the
    first `/`.
  - An agent with `extensions: [foo]` doesn't load built-ins unless it lists
    them. This is consistent with how lists already behave. Document it.
  - Confirm `extensionPackageName("builtin:mcp")` returns undefined cleanly. It
    climbs from `dirname("builtin:mcp")` = `"."`, which is the cwd. Make
    `extensionCanonicalNames` return early for synthetic paths (the
    `builtin:` prefix) so it never reads the cwd's `package.json`.
- The orphan and typo warnings (`discoveredNames`, `survivingNames`) already
  work by canonical name and need no change.

### 3. Make `renarrow` narrow-only (`installExtensionToolScope`)

Replace the widening with:

```ts
// Pi 1.0 activates tools itself: `defaultTools` at construction, `direct`
// tools on registration, `tool_search` loads on demand. Only remove what is
// out of scope; never add, or `defaultActive: false` and `codemode`/`deferred`
// exposure would be bypassed.
const renarrow = () => {
  const allowed = inScope();
  const current = session.getActiveToolNames();
  const next = current.filter((n) => allowed.has(n));
  if (next.length !== current.length) session.setActiveToolsByName(next);
};
```

Initial activation, one time only, in place of the first `renarrow()` call:

```ts
// Built-ins the agent asked for that pi's default set leaves inactive
// (grep/find/ls), and injected tools (nested delegation, StructuredOutput).
const allowed = inScope();
const registered = new Set(session.getAllTools().map((t) => t.name));
const initial = [
  ...session.getActiveToolNames(),
  ...toolNames.filter((n) => registered.has(n)),
  ...readmitToolNames,
].filter((n) => allowed.has(n));
session.setActiveToolsByName([...new Set(initial)]);
```

Things to check while implementing:

- Custom tools (nested tools, `StructuredOutput`) are `direct`, so pi
  activates them at construction through `includeAllExtensionTools`. Adding
  them from `readmitToolNames` is a safety net; drop it if a test shows it is
  never needed.
- `tool_search` loads deferred tools by calling `setActiveTools`. They are in
  scope, so the narrow keeps them across turns.
- Existing comment at line 296 ("pi would otherwise leave only its four
  default built-ins active at turn 1") is obsolete; rewrite it.
- A user who sets `defaultTools` to drop a built-in still gets every built-in
  the agent requests. This matches today's behavior, because the agent
  definition decides its own tools.

### 4. Lifecycle and side effects to confirm

- MCP connects on each subagent's `session_start` and disconnects on
  `session_shutdown` (`extensions/mcp/index.js:976`). `agent-manager.ts:338-354`
  already sends `session_shutdown` to child runners on dispose, so check that
  this happens on completion and eviction as well as quit. Otherwise stdio MCP
  server processes leak.
- Cost: each subagent opens its own MCP connections. For stdio servers that
  means one process per subagent. Accepted; not documented in the README.
- MCP waits up to `startupWaitMs` (10s) for `direct` servers before the first
  prompt. That adds latency to subagent startup when servers are slow.
  Accepted; not documented in the README.
- OAuth: subagents share `mcp-auth.json` on disk with the parent. Check that
  concurrent token refreshes from parent and subagent can't corrupt it (read
  `extensions/mcp/oauth.js`).
- Project `mcp.json` loads only for trusted projects. Check that the
  subagent's settings and trust resolution (`configCwd`) gives the same answer
  as the parent's.
- The `/mcp` command and MCP UI register in the child runner. Check there's no
  UI or keybinding conflict with the parent. Child sessions have no UI context
  bound.
- For Explore/Plan, check that codemode can't reach `edit`/`write`. Excluded
  built-ins never register, and `ctx.executeTool()` goes through the
  `tool_call` guard.

### 5. Tests

Unit (`test/agent-runner.test.ts`, mocked SDK):

- The loader receives the three built-in entries (names, `builtin: true`,
  `replaceable: true`) when extensions are on. It receives none under
  `isolated` and `extensions: false`.
- `renarrow` never adds a tool. A `defaultActive: false` tool that is
  registered but not active stays inactive across `turn_end`.
- Initial activation adds requested built-ins (`grep`/`find`/`ls`) and
  injected tools, and nothing else.
- Update existing expectations around lines 1532-1699 that assume widening
  (`mcp_search`, `foo_late` cases). Late `direct` tools are now activated by
  pi, not by `renarrow`, so the mock has to emulate activation on
  registration, or those cases move to e2e.
- `extensionCanonicalNames("builtin:mcp")` → `["builtin:mcp"]` and doesn't
  touch the filesystem.

E2E against the real SDK (pattern: `test/e2e/nested-tool-scope.e2e.test.ts`):

- With `defaultTools: ["+codemode"]`, a `general-purpose` child has `codemode`
  active. Without it, `codemode` is registered but inactive.
- MCP through `createMcpExtension({ loadConfig, createTransport })` with an
  in-memory fake server. This needs a test-only override path: either
  `builtinExtensions(options?)` takes factory options, or the test swaps the
  module. Decide while implementing, and keep production code free of test
  hooks if possible.
  - A `direct` tool becomes active after `session_start`.
  - A `deferred` tool isn't active, but `tool_search` can load it.
  - `codemode` exposure → callable from codemode, not declared.
- `exclude_extensions: [builtin:mcp]` → no MCP tools. `ext:builtin:mcp/<tool>`
  narrows to that tool.
- `extensions: ["-builtin:codemode"]` in the user's pi settings → no codemode.
- Explore: codemode script calling `write` is blocked.

### 6. Docs

- `README.md`:
  - Extensions section: built-ins load for `extensions: true` agents.
  - Their names (`builtin:mcp`, `builtin:codemode`, `builtin:tool-search`) for
    `extensions:`/`exclude_extensions:`/`ext:`.
  - `isolated` disables them.
- `CHANGELOG.md` entry (follow `CONTRIBUTING.md` changelog rules).
- Check whether llama.cpp models resolve in a subagent through the shared
  `ModelRuntime`. If they don't, note it as a known limitation.

### 7. Verify

- `npm run check`.
- Manual: in pi with the current `~/.pi/agent/settings.json` / `mcp.json`,
  spawn `general-purpose` and ask it to list its tools. Expect `codemode`,
  `web_search_exa`, and `web_fetch_exa`. Spawn `Explore` with
  `isolated: true` and expect none of them.

## Decisions

1. Agents with an `extensions: [list]` do not load built-ins unless the list
   names them (`builtin:mcp`, ...). They are treated like any other
   extension, matching pi's `-ne -e` behavior.
2. Each subagent registers its own `/mcp` command and MCP UI hooks, since pi
   has no option to load MCP without them. Revisit only if step 4 finds a
   conflict with the parent.
3. The README does not mention per-subagent MCP cost or startup latency.
