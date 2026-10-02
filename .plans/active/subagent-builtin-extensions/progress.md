# Progress: load Pi 1.0 built-in extensions in subagents

Status: done. Implemented, passing `npm run check`, checked by the user in live
pi, and committed as `fix: load pi's built-in extensions in subagents` with
this plan.

## Done

### 1. Built-in extension factories
- New `src/builtin-extensions.ts`: `builtinExtensions()` returns codemode,
  tool-search and mcp in the CLI's shape (`builtin: true, replaceable: true`),
  built fresh on each call.
- Checked: Pi 0.99.0 (the supported minimum) also exports
  `createCodemodeExtension` / `createToolSearchExtension` / `createMcpExtension`
  and uses the same `builtin` mechanism, so the peer range stays as it is.

### 2. Wired into `runAgent`'s loader
- `extensionFactories: noExtensions ? [] : [...builtinExtensions(), toolScope]`.
- `extensionCanonicalNames()` returns early for synthetic paths (`builtin:*`,
  `<inline:*>`), so it no longer reads the cwd's `package.json` for them. Built-ins
  match by `builtin:<name>` in `extensions:`, `exclude_extensions:` and `ext:`
  with no other changes.

### 3. Narrow-only scoping
- `installExtensionToolScope`: `renarrow` now only removes out-of-scope tools
  from the active set. The one-time widening at install adds only requested
  built-ins (grep/find/ls) and injected tools (nested delegation,
  StructuredOutput).
- Updated the stale comments ("pi activates only its four default built-ins").

### 4. Lifecycle and side effects (step 4 checks)
- **MCP shutdown:** `shutdownChildSession` (agent-manager.ts) sends
  `session_shutdown` on eviction and on quit, and MCP disconnects there. A
  finished agent's MCP connections stay open until its record is evicted
  (about 10 min), because the session is kept for resume. This matches every
  other extension's lifecycle.
- **OAuth:** `McpOAuthCredentialStore` takes a `proper-lockfile` file lock per
  server around refresh, so refreshes from the parent and subagents in the same
  process and across processes are serialized. No change needed.
- **Trust (fixed):** subagents used to call `SettingsManager.create(cwd,
  agentDir)`, which defaults to `projectTrusted: true`. In a project the parent
  had not trusted, a child would still load the project's settings, extensions
  and `mcp.json` (which can start stdio commands). There is now one
  `SettingsManager` created with `projectTrusted: ctx.isProjectTrusted()`,
  shared by the loader and the session as the CLI does.
- **llama.cpp:** confirmed by reading the code: `pi.registerProvider` →
  `ModelRegistry.registerProvider` → `this.runtime`, which is the parent's
  `ModelRuntime`, and subagents share it through `parentModelRuntime`. Not
  tested end to end.
- **`/mcp` command in child runners:** registered but unreachable (no UI
  bound to the child). No conflict found. Accepted per Decision 2.
- **Explore/Plan via codemode:** `edit`/`write` are left out of the registry by
  `excludeTools`, so `ctx.executeTool()` can't resolve them, and the `tool_call`
  guard blocks anything out of scope. The existing `nested-tool-scope` e2e test
  covers that `ctx.executeTool()` path. No separate codemode-script test.

### 5. Tests
- `test/agent-runner.test.ts`:
  - The mock session now emulates Pi 1.0 activation: tools activate on
    registration, except `defaultActive: false` and non-declarable exposures.
    Previously the widening `renarrow` did this job.
  - New `describe("agent-runner pi built-in extensions")` with 6 tests: factory
    shape and order; none for `isolated` / `extensions: false`; inactive and
    deferred tools stay inactive; tools pi activates during the run are kept
    while in scope; requested built-ins activated; `builtin:<name>`
    select/exclude.
  - Trust inheritance test; synthetic canonical name test.
- New `test/e2e/builtin-extensions.e2e.test.ts` (real SDK, faux model) with a
  real stdio MCP server, `test/fixtures/mcp-stdio-server.mjs`. Six scenarios:
  - `+codemode`
  - no `defaultTools`
  - `-builtin:codemode`
  - `exclude_extensions: builtin:mcp`
  - `ext:builtin:mcp/<tool>`
  - `isolated`
  
  Each scenario checks two turns of declared tools, registered tools, and that
  an MCP call returns its result. Added to `tsconfig.sdk-tests.json`.
- Checked that the tests catch regressions by temporarily reverting each fix:
  - No built-ins in the loader → 5/6 e2e fail (`isolated` passes either way).
  - Old widening `renarrow` → 3 e2e and 1 unit test fail.
- Added `isProjectTrusted: () => true` to the hand-built parent contexts in
  `agent-runner-e2e`, `ext-templates-e2e` and `tool-veto-reachability`.

### 6. Docs
- README: added a built-ins bullet and a trust bullet under "Tool & extension
  scoping", an `exclude_extensions: builtin:mcp` example, a mention of
  built-ins in the `extensions` row, and an Architecture entry. No MCP cost or
  latency notes (Decision 3).
- CHANGELOG: one `### Fixed` entry under `[Unreleased]`.

## Verification
- `npm run check`: lint clean, typecheck clean, 107 files / 2153 tests pass
  (7 skipped).
- Run with commit signing disabled through the environment:
  `GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false
  GIT_CONFIG_KEY_1=tag.gpgsign GIT_CONFIG_VALUE_1=false`.
  - The global git config has `commit.gpgsign=true`. Five existing test files
    run real `git commit` in temp repos (`worktree-isolation-e2e`, `worktree`,
    `workflow-gate-worktree`, `env`, `workflow-progress`), which calls gpg and
    can hang on pinentry. Without the override, `worktree-isolation-e2e` fails
    (no branch is created).
  - This was already the case before this change. Making those tests set
    `commit.gpgsign=false` in their temp repos would remove the need for the
    override. That fix is not done; it is outside this plan's scope.

- Manual (step 7): the user tested in live pi; `general-purpose` now sees the
  MCP tools and codemode.

## Remaining
- Bump the pi-subagents gitlink in the pi-extensions monorepo.
- Optional: make the git-committing tests set `commit.gpgsign=false` in their
  temp repos, so the suite doesn't depend on the user's signing config.
