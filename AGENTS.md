# Development Rules

This repo is a fork of
[tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) . For
anything related to contributing to upstream, read `CONTRIBUTING.md` first —
especially `## Contributing upstream`, which says how to prepare an upstream
branch that carries only the material change.

## Conversational Style

- Keep answers short and concise
- No emojis in code or answers
- No fluff or cheerful filler text
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check `node_modules` for external API types (`@earendil-works/pi-*`, `@sinclair/typebox`, etc.); don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Match the surrounding code style — it is enforced by biome (`biome.json`).
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- This is a pi extension. Respect the Claude Code-compatible tool names, calling conventions, and UI patterns the extension deliberately mirrors; don't diverge from them without a stated reason.
- When reviewing a diff, favor solutions that are elegant, not overengineered — flag needless abstraction, layering, or defensive code that the change doesn't warrant.

## Documentation

Read the file that covers a surface before changing its behavior; update it in the same change.

| File | Covers |
|---|---|
| `README.md` | User-facing reference: features, install, tool parameter tables, commands, settings and defaults, the event table, the RPC channel list, and the `src/` file map (`## Architecture`). Source of truth for defaults and setting names. |
| `docs/workflows.md` | `SubagentWorkflow` in depth — how the model writes a script, editing and re-running it, saving a named workflow, `agent()` options, recipes, troubleshooting. Examples in `examples/workflows/`. |
| `docs/rpc.md` | Calling this extension from another pi extension — `pi.events` lifecycle events (`subagents:completed`, `subagents:ready`, …), the `subagents:rpc:*` channels (`ping`, `spawn`, `stop`, `consume`), spawn options, error strings, and the `Symbol.for("pi-subagents:manager")` registry. Source: `src/cross-extension-rpc.ts`. |
| `CONTRIBUTING.md` | Process: writing style for GitHub posts, filing issues, the pre-PR checklist, PR format, reviewing PRs, changelog rules, releasing, and contributing upstream. |
| `SECURITY.md` | Vulnerability reporting. |

`README.md` holds the reference tables and links out; `docs/` holds the long-form guides. Each guide states its audience in its first three lines — read that before deciding it is the wrong file. Renaming an event, an RPC channel, a reply-envelope field, or a workflow global is a docs change too.

## Commands

- After code changes (not docs), run the full check suite and fix all errors and warnings:
  ```bash
  npm run check       # lint + typecheck + test (what CI runs)
  ```
  The steps individually, when you need to isolate a failure:
  ```bash
  npm run lint        # biome
  npm run typecheck   # tsc --noEmit
  npm run test        # vitest run
  ```
- `npm run lint:fix` auto-fixes most style issues.
- `npm run test` runs the whole suite, including `*-e2e.test.ts` files. To iterate on a single file, run it directly: `npx vitest run test/<file>.test.ts`.
- If you create or modify a test file, run it and iterate on the test or implementation until it passes.
- `npm run build` compiles with `tsc`; run it only when verifying the build output or when requested.
- `npm run bench` runs the benchmarks in `test/perf/*.bench.ts` (absolute timings, ~1 min). Opt-in: it is not part of the check suite, and `npm run test` never picks bench files up. `npm run bench:ab -- <ref>` benchmarks the working tree against another commit and prints the delta — use it for a PR's `## Performance` section. The `*.perf.test.ts` guards beside them assert operation counts, not time, and DO run in the normal suite.
- For ad-hoc scripts, write them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.

## Git

- **Never push**, tag, or create branches unless the user explicitly asks.
- Never run history- or worktree-destroying commands: `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`, or any force push.
- Leave the working tree as the user left it — don't stage, stash, or revert files you didn't change, and don't switch branches (e.g. `gh pr checkout` to review a PR) unless the user asks.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
