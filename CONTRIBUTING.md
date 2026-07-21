# Contributing to UIO

Thanks for helping build the open design studio. The codebase is intentionally
small — read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first (10 minutes),
then pick a lane:

## Easiest: content

- **Design systems** — add a folder under `library/design-systems/<id>/` with a
  `DESIGN.md`: frontmatter (`name`, `description`, `swatches` as comma-separated
  hexes, `font`) + agent-facing rules (tokens table, typography, hard rules).
  Test by creating a project with it and reading what the agent produces.
- **Skills** — `library/skills/<id>/SKILL.md` (frontmatter: `name`,
  `description`, `mode: prototype|deck`, `entry`) plus `assets/` seed HTML.
  Good skills are seeds + composition rules, not essays: encode taste in the
  seed file, keep instructions short and imperative.

## Engines

Add a `RuntimeDef` in `electron/core/runtimes.ts` (binary, version probe, argv
builder, prompt delivery, stream format) and — if the CLI emits structured
output — a parser in `electron/core/engine.ts` that maps its stream to
`EngineEvent`s. Please test against a real install and paste a session log in
the PR. Defs you cannot test stay `experimental: true`.

## App

- `npm run dev` — full app with hot reload.
- `npm run dev:web` — renderer only, in a browser, against the mock engine
  (`src/bridge.ts`) — fastest loop for UI work.
- `npm run typecheck` before pushing; `npm run test:engine [runtimeId]` runs
  the real generation pipeline headless.

Conventions: TypeScript strict, no new runtime dependencies without a strong
reason, comments explain *why* not *what*, and every IPC change goes through
`shared/types.ts` so main and renderer can't drift.

## Scope guardrails for v0.x

macOS only until the core loop is excellent. BYOK/API engines, PPTX export,
and multi-window are roadmap items — open an issue before large PRs.
