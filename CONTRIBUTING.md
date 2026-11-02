# Contributing to pi-subagents

This guide exists to save both sides time.

This repo ([milanglacier/pi-subagents](https://github.com/milanglacier/pi-subagents))
is a maintained fork of [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents).
Issues and PRs for the fork go here; sending a change back upstream follows
[Contributing upstream](#contributing-upstream).

## Philosophy

`pi-subagents` is a [pi](https://pi.dev) extension, and it tries to stay focused:
spawn and orchestrate autonomous sub-agents that feel native to pi, and do that
well. Features that don't serve that goal, or that bolt on unrelated complexity,
are likely to be declined. When in doubt, open an issue and discuss the idea
before writing the code.

The extension deliberately mirrors Claude Code's tool names, calling
conventions, and UI patterns. Changes should respect that compatibility unless
there's a good reason to diverge.

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and
how they interact with the rest of the system, the PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without
understanding it is not.

## Writing Style

Applies to issues, PR descriptions, and comments.

- Technical prose, no emojis, no marketing, no cheerful filler
  ("Thanks @user", not "Thanks so much @user!").
- Keep it concise. If an issue does not fit on one screen, it is too long.
- Write in your own voice. If you used an LLM to draft it, review and shape it
  yourself before posting.
- With `gh`, write the body to a temp file and pass `--body-file`
  (`gh issue create`, `gh pr create`, `gh pr edit`, `gh issue/pr comment`);
  never multi-line markdown via `--body`.

## Filing Issues

- State the bug or request clearly, and explain why it matters.
- For bugs, include a minimal repro: pi version, this extension's version, your
  agent/config, the steps, and the actual vs. expected behavior.
- If you want to implement the change yourself, say so.

For security issues, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Before Submitting a PR

For anything beyond a trivial fix, open an issue first so we can agree on the
approach before you invest the time.

Make sure the full check suite passes locally:

```bash
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # tsc
```

All four must pass. `npm run check` runs the first three in one go (what CI
runs). `npm run lint:fix` will auto-fix most style issues, and
`npm run test:e2e` runs the end-to-end suite if your change touches that surface.

If your change touches a render path or the spawn path, `npm run bench` prints
absolute timings and `npm run bench:ab -- main` compares them against `main`.
Neither is required to pass; both are opt-in, and neither runs in CI.

Other guidelines:

- Keep PRs focused — one logical change per PR. Unrelated refactors make review
  harder and are likely to be split out or declined.
- Self-review the diff before opening the PR; drop unrelated refactors and
  leftover debug code.
- Add or update tests for behavior you change.
- Match the surrounding code style (enforced by biome).
- Do not edit `CHANGELOG.md`. Changelog entries are added by the maintainer.
- Update the README when you add or change user-facing behavior.

## Writing the PR

Title in conventional-commit form (`fix(ui): ...`), imperative, no trailing
period.

Write the description for a reviewer who will not read the whole diff: what
changed, then what it costs.

- Every claim checkable — from the diff, or from a command you actually ran.
  Never quote a benchmark, test count, or "no change in output" you did not
  measure.
- State what the change does *not* do: deliberate omissions, known gaps,
  untested surfaces.

**Relations** — get the verbs right, and note `States as of opening.`

- `Closes #N` only if the PR fully resolves N. Otherwise name the part delivered
  and say N stays open.
- A merge does not auto-close another PR: say **supersedes**, credit the author
  (`thanks @user`), and say what of theirs was left out and why.
- Name PRs touching the same lines; say whether it is a design conflict or just
  a rebase.

**Sections**, in this order. Omit one only when it is genuinely empty, and say
so:

| Section | Content |
|---|---|
| Lead-in (no heading) | What this closes, supersedes, or partly addresses. |
| `## Summary` | The problem and why it matters — not how it is fixed. Enumerate distinct failure modes. |
| `## What changed` | The design: the one idea, then its consequences. Name files/symbols only where they help. |
| `## Related work` | Table: number, title, state, relation to this PR. |
| `## Behavior and compatibility` | Side effects, breaking changes (or an explicit "none", with reasoning), defaults, settings, migration. |
| `## Performance` | Numbers with the method that produced them (e.g. `npm run bench:ab`). "No measurable change" only if measured. |
| `## Testing` | Commands and results, new coverage, and what is **not** covered. |

Add sections a change needs; use fenced `text` blocks or screenshots for UI
changes.

In `## Testing`, paste real results of the check suite above (`npm run lint`,
`npm run typecheck`, `npm run build`, `npm run test` with pass/skip/file
counts), not "tests pass". Mutation-check every new assertion — break the
source line, confirm red, restore — and say what you broke.

## Reviewing PRs

Inspect a PR without moving the worktree to its branch:

- `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against
  fetched refs for metadata, commits, and patches.
- For a file's full contents, `git show <ref>:<path>` or fetch it into a temp
  file.

## Changelog

Maintainer-owned; contributors don't edit it. `CHANGELOG.md` follows pi's
changelog convention, and pi shows its new entries to users after an update.

- All new entries go under `## [Unreleased]`, in `### Breaking Changes` (with
  the migration step), `### Added`, `### Changed`, `### Fixed`, or
  `### Removed`. Read the section first and append to existing subsections;
  never duplicate them.
- One bullet per issue or PR. A PR and the issue it closes are one change.
- Keep entries to one or two plain sentences written for users: what changed
  and anything they must do. Skip docs, tests, CI, refactors, and dependency
  bumps.
- Released version sections (e.g. `## [0.12.0]`) are immutable; never modify
  them. Sections up to 0.20.0 keep the upstream style.
- Link issues and PRs in the repo where they live:
  `Fixed foo ([#123](https://github.com/milanglacier/pi-subagents/issues/123))`.
  Credit external contributions:
  `Added X ([#456](https://github.com/milanglacier/pi-subagents/pull/456) by [@username](https://github.com/username))`.

## Releasing

**Versioning** follows semver from 1.0.0. The fork's 1.x line is separate from
upstream's `0.x` versions; upstream tags are not fetched
(`remote.upstream.tagOpt` is `--no-tags`), so they cannot clash with the
fork's.

- `major` — any breaking change.
- `minor` — a new feature.
- `patch` — bug fixes and smaller additions.

Before a release:

- Update `CHANGELOG.md` — rename `## [Unreleased]` to
  `## [X.Y.Z] - YYYY-MM-DD`. The version must equal `version` in
  `package.json`, because pi matches headings against it.
- Check `README.md` and the matching guide in `docs/` cover every user-facing
  change in the release (features, settings, workflows, the event/RPC surface).
- Run the full check suite plus the e2e tests, and fix anything that fails:
  ```bash
  npm run check                    # lint + typecheck + test
  npm run test:e2e                 # faux/scripted e2e — no network, no keys
  npm run build
  ```
- For a real pre-publish smoke test, run the **live** e2e against an actual
  model:
  ```bash
  PI_E2E_LIVE=1 npm run test:e2e   # uses your local `pi` login; optional PI_PROVIDER / PI_MODEL
  ```
  `PI_E2E_LIVE=1` swaps the scripted faux suite for the live one (the faux
  suite is `skipIf(LIVE)`). `prepublishOnly` runs lint + typecheck + test +
  build; the live e2e is the smoke test to run by hand before publishing.

## Contributing upstream

Upstream is `tintinweb/pi-subagents` (git remote `upstream`, default branch
`master`). Its own rules are in its `CONTRIBUTING.md`
(`git show upstream/master:CONTRIBUTING.md`); follow them where they differ
from this file.

The fork's `main` carries fork-only files that must not reach upstream. Never
open an upstream PR from `main`; prepare a feature branch that carries only the
material change:

1. `git fetch upstream`, then branch from upstream:
   `git switch -c <topic> upstream/master`.
2. Cherry-pick only the commits that carry the change (`git cherry-pick <sha>`).
   When a commit also touches fork-only files, use `git cherry-pick -n <sha>`,
   drop those paths from the index and worktree, and commit the rest.
3. Leave out fork-only files: `AGENTS.md`, `CONTRIBUTING.md`, `CLAUDE.md`,
   `.github/`, glossary and other misc/housekeeping files, and `CHANGELOG.md`
   (upstream's maintainer writes its entries). Code, tests, `README.md`, and
   `docs/` changes that belong to the change go along with it.
4. Check `git diff upstream/master --stat` lists only material files, run the
   check suite on the branch, push it to `origin`, and open the PR against
   `tintinweb/pi-subagents:master`.

## Questions?

Open an [issue](https://github.com/milanglacier/pi-subagents/issues) — questions
and discussion are welcome.
