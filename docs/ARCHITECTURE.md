# UIO Architecture

UIO copies the proven topology of Claude Design / Open Design, collapsed into
the smallest honest shape for a macOS-only first iteration. Where Open Design
runs a Next.js web app + Express daemon + Electron shell as three processes,
UIO runs two: an Electron **main process that plays the daemon role**, and a
React renderer. Every boundary is kept so the daemon can be split out later
without rewrites.

## 1. Process topology

```
Electron renderer (React 18 + Vite)
    │  typed IPC — the UioBridge contract in shared/types.ts
Electron main (the "daemon")
    │  spawn per turn, cwd = project workspace
Agent CLI (claude / codex / …)
    │  JSONL stream on stdout · file writes in the workspace
Filesystem (~/UIO Projects, ~/UIO Library)
```

- `shared/types.ts` is the single contract file (DTOs, engine events, bridge
  interface) — the equivalent of Open Design's `packages/contracts`.
- `electron/preload.ts` exposes the bridge as `window.uio` under context
  isolation. `src/bridge.ts` falls back to an in-browser mock so the renderer
  can be developed and demoed without Electron (`npm run dev:web`).

## 2. Generation data flow (filesystem execution profile)

1. Renderer calls `startTurn({projectId, prompt, runtimeId, model, comments})`.
2. Main resolves project → skill → design system, refreshes `.uio/skill/` and
   `.uio/DESIGN.md` copies in the workspace, and composes the turn prompt
   (`electron/core/prompt.ts`): core contract + skill pointer + design-system
   pointer + fidelity clause + first-turn/follow-up clause + request + pinned
   element comments.
3. `electron/core/engine.ts` spawns the runtime def's argv inside the
   workspace (prompt over stdin), parses its stream into normalized
   `EngineEvent`s, and main forwards them over IPC while appending them to the
   project transcript (`.uio/chat.jsonl`).
4. The agent reads `.uio/skill/SKILL.md` + seed assets with its own file
   tools and writes the deliverable (`index.html` / `deck.html`) in the
   workspace root.
5. `fs.watch` (recursive, FSEvents) emits file-change IPC; the renderer
   re-reads the entry file and refreshes the sandboxed preview.

Prompts stay small because the filesystem is the interface: big resources are
files the agent reads, not text we inline. This is also why engines without
session resume still work — the workspace is the shared memory.

### Text-artifact execution profile (direct-API / hosted)

Engines without file tools use a second profile, implemented in
`electron/core/providers.ts`. `handleStartTurn` in `main.ts` dispatches on the
configured **engine source**:

- `local-cli` → spawn a CLI (above).
- `byok` → call Anthropic `…/v1/messages` or an OpenAI-compatible
  `…/v1/chat/completions` directly with the user's key.
- `hosted` → call the owner's proxy at `…/v1/design/stream` with only a
  per-user usage token; the proxy injects the real key server-side.

All three share the streaming client and `electron/core/artifact.ts`: the model
returns prose plus one `<artifact>…</artifact>` HTML document (falling back to a
fenced ```html block or a raw `<!doctype html>`). Prose streams to chat live;
the document is held back, extracted, and written to the workspace entry file so
preview/export behave exactly like a CLI run. The prompt is composed by
`composeProviderPrompt` (seed + design tokens inlined, since there are no file
tools). Secrets live encrypted via `electron/core/secrets.ts` (macOS Keychain
through Electron `safeStorage`); the renderer only ever learns whether a secret
is set, never its value. `validateHttpUrl` refuses non-`https` endpoints
(except `localhost`) before any key is sent.

### Hosted proxy (`proxy/`)

The one server-side component, and the only thing that leaves the user's Mac in
hosted mode. A zero-dependency Node server that holds the owner's commercial API
key, authenticates per-user usage tokens with monthly USD caps, relays the
provider's SSE verbatim, and meters spend from the stream's token-usage events.
It exists so users **without any plan of their own** can design on the owner's
subscription. See `proxy/README.md` — including why it must be backed by a
commercial API key, not a personal Pro/Max seat.

## 3. Runtime registry (`electron/core/runtimes.ts`)

One `RuntimeDef` per CLI: binary, version probe, argv builder, prompt
delivery, stream format, resume support. Detection resolves the user's login
shell `PATH` first (GUI apps on macOS inherit a minimal PATH), probes
concurrently with `which` + `--version`, and caches until refresh.

Implemented parsers (`engine.ts`):

- `claude-json` — Claude Code `-p --output-format stream-json --verbose`.
  System `init` captures the session id (we mint one with `--session-id` on
  first turn, `--resume` after); assistant blocks become text events;
  `TodoWrite` inputs become todo events; `Write`/`Edit` become tool + file
  events; `tool_result` closes tool chips; `result` carries summary, duration
  and cost. `--permission-mode bypassPermissions` is used deliberately: the
  project workspace is the sandbox and the whole point is unattended runs.
- `codex-json` — `codex exec --json --skip-git-repo-check --sandbox
  workspace-write`, tolerant of both the `item.*` and legacy `msg.*` event
  shapes; `thread.started` id enables `codex exec resume`.
- `text` — raw fallback for experimental engines.

## 4. Content registries

- **Bundled**: `library/skills/*`, `library/design-systems/*` (shipped in the
  app bundle; `library/` is packaged by electron-builder).
- **User**: `~/UIO Library/{skills,design-systems}` — scanned second, so a
  user entry with the same id shadows a bundled one (Open Design's shadowing
  rule).
- `SKILL.md` frontmatter: `name`, `description`, `mode: prototype|deck`,
  `entry`. `DESIGN.md` frontmatter: `name`, `description`, `swatches`, `font`.
  Bodies are agent-facing markdown. The parser is deliberately a flat
  `key: value` subset so contributions stay simple.

## 5. Projects (`electron/core/projects.ts`)

`~/UIO Projects/<slug>/` with `project.json` (id, skill, design system,
fidelity, per-runtime session ids), the deliverable files, and `.uio/`
(installed skill copy, `DESIGN.md`, `chat.jsonl` transcript). No database.
Deleting a project moves the folder to the macOS Trash. All file reads resolve
against the workspace root and refuse path traversal.

## 6. Preview and comment mode

Previews render in `<iframe sandbox="allow-scripts" srcDoc=…>` — no
same-origin access, so generated code can't touch the app. A small bridge
script is injected before `</body>`: the host posts `uio-comment-mode`
toggles; element clicks post back `{selector, label, x, y}` where the selector
prefers the nearest `data-uio-id` ancestor (the skills mandate those
attributes). The host validates `event.source` against the frame before
trusting a message, then shows the pin-note popover; pinned comments travel
with the next turn as a structured block in the prompt.

## 7. Export (`electron/core/exporter.ts`)

- **HTML**: the deliverable is already one self-contained file; export is a
  copy via the native save dialog.
- **PDF**: hidden `BrowserWindow` + `printToPDF({preferCSSPageSize: true})`.
  The deck seed carries `@page { size: 1280px 800px }` + print rules, so one
  slide = one page.

## 8. Security posture

- Renderer: context isolation on, node integration off; external links go
  through `shell.openExternal` with an http(s) allowlist.
- Preview iframes: sandboxed, no same-origin, message source validated.
- Workspace file APIs: canonicalized and bounded to the project root.
- Agent runs: full tool access *inside the workspace cwd* — that's the
  product's contract with you. Review agents' output like you'd review a
  collaborator's.
- No telemetry, no network calls of UIO's own. Engines talk to their own
  providers under their own auth.

## 9. Source map

| Concern | File |
|---|---|
| Shared contracts (DTOs, events, bridge) | `shared/types.ts` |
| Daemon composition, IPC, watchers | `electron/main.ts` |
| Runtime defs + detection + spawn | `electron/core/runtimes.ts` |
| Run lifecycle + stream parsers | `electron/core/engine.ts` |
| Direct-API / hosted streaming client | `electron/core/providers.ts` |
| HTML artifact extraction | `electron/core/artifact.ts` |
| Encrypted secret storage (Keychain) | `electron/core/secrets.ts` |
| Prompt composer (both profiles) | `electron/core/prompt.ts` |
| Hosted proxy (owner's subscription) | `proxy/server.mjs` |
| Project store + transcripts | `electron/core/projects.ts` |
| Library registries + workspace install | `electron/core/library.ts` |
| HTML/PDF export | `electron/core/exporter.ts` |
| Screens | `src/screens/Home.tsx`, `src/screens/Studio.tsx` |
| Chat blocks + composer | `src/components/ChatPane.tsx` |
| Preview canvas + comment mode | `src/components/CanvasPane.tsx` |
| Engine smoke test (no UI) | `electron/testing/smoke.ts` |
