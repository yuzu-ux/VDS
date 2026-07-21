# UIO

**UI, Open — the open-source design studio where your coding agents become the design engine.**

UIO is an open, local-first alternative to [Claude Design](https://claude.com/product/design), in the spirit of [Open Design](https://github.com/nexu-io/open-design). Describe what you want; the coding-agent CLI already on your Mac (`claude`, `codex`, …) designs it as **real files in a plain folder** — previewed live, iterated in chat, exported to HTML or PDF.

> **Status: v0.1 — macOS only, by design.** Small, readable, and meant for the coding & UI communities to build on.

## Why

Claude Design went viral — and stayed closed-source, cloud-only, subscription-only, single-model. The design-agent workflow deserves an open implementation that is:

- **Agent-native** — no bundled model, no API markup. The agents on your `PATH` are the engine.
- **Local-first** — projects are portable folders. `project.json` + your files. Git them, zip them, own them.
- **Open formats** — skills are `SKILL.md` packages, brand contracts are `DESIGN.md`, deliberately compatible with the Open Design ecosystem so content flows between tools.

## Three ways to power it (Settings → Engine)

| Source | What runs where | For whom |
|---|---|---|
| **Local CLI** *(default)* | An agent CLI (`claude`, `codex`, …) on your Mac writes the files. 100% local. | You have an agent CLI / a plan. |
| **Your API key** | UIO calls Anthropic or an OpenAI-compatible API directly with *your* key. Local except the model call; the key is encrypted in your Keychain. | You have an API key but no CLI. |
| **Hosted** | UIO calls a small proxy the app owner runs; a per-user **usage token** meters you against the owner's account. Only the model call leaves your Mac. | **You have no plan at all** — design on the owner's subscription. |

The hosted option is the answer to *"if they don't have a Claude plan, they can use my app subscription to design."* You deploy [`proxy/`](proxy/README.md) once (backed by a commercial API key), mint each user a token, and they paste it into Settings. Projects, preview, comments, and export stay entirely on the user's machine — the token is the only thing that ever leaves.

## What works today

| Capability | Status |
|---|---|
| Web prototype + slide deck skills (seed-based, self-contained HTML) | ✅ |
| Design systems (3 bundled; drop your own in `~/UIO Library/design-systems/`) | ✅ |
| Claude Code engine with session resume, streamed TODOs and tool activity | ✅ |
| Codex CLI engine (JSONL events) | ✅ |
| cursor-agent · gemini · opencode · qwen | ⚠️ experimental, raw-stream |
| Direct-API engine (your key): Anthropic + OpenAI-compatible, artifact profile | ✅ |
| Hosted engine: owner's subscription via metered usage tokens (`proxy/`) | ✅ |
| Encrypted secret storage (macOS Keychain via safeStorage) | ✅ |
| Live sandboxed preview, zoom, source view | ✅ |
| Comment mode — pin notes to elements, sent with your next message | ✅ |
| Export standalone HTML / PDF (decks: one slide per page) | ✅ |
| Wireframe / high-fidelity modes | ✅ |

## Run it

Requirements: macOS, Node 20+, and at least one agent CLI installed and authenticated (`claude` recommended).

```bash
npm install
npm start        # build + launch the app
npm run dev      # hot-reload development (Vite + Electron)
npm run dist     # package a .dmg (electron-builder)
```

Useful checks:

```bash
npm run typecheck
npm run test:engine   # full pipeline against your real claude CLI, no UI
npm run dev:web       # renderer alone in a browser, with a mock engine
```

## How it works

```
┌────────────────────────── Electron renderer (React) ──────────────────────────┐
│  Home: create card · designs grid · design systems      Studio: chat ⇄ canvas │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ typed IPC (window.uio)
┌──────────────────────────────▼────────────────────────────────────────────────┐
│  Main process — the "daemon": project store · library registry · runtime      │
│  detection · prompt composer · run engine · exporter                          │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ spawn, cwd = project workspace
                    claude / codex / … CLI
                               │ stream-json events + real file writes
                    ~/UIO Projects/<name>/  ← watched, previewed, exported
```

Each turn, UIO composes a prompt from the project's **skill** (`.uio/skill/SKILL.md`, with seed HTML assets), the active **design system** (`.uio/DESIGN.md`), fidelity, and your message — then spawns the chosen CLI inside the project workspace. The agent reads the skill with its own file tools, writes the deliverable (`index.html` / `deck.html`), and the preview follows the file. Claude Code sessions are resumed across turns (`--resume`), so the agent keeps its working memory; for engines without resume, the workspace files *are* the memory.

Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Extend it

- **Design system**: folder with a `DESIGN.md` (frontmatter: `name`, `description`, `swatches`, `font`) in `~/UIO Library/design-systems/`. Same id shadows a bundled one.
- **Skill**: folder with `SKILL.md` (frontmatter: `name`, `description`, `mode: prototype|deck`, `entry`) plus `assets/` seeds in `~/UIO Library/skills/`.
- **Engine**: add a `RuntimeDef` in [electron/core/runtimes.ts](electron/core/runtimes.ts) — launch args, prompt delivery, stream format. Parsers live in [electron/core/engine.ts](electron/core/engine.ts).

## Roadmap

- Streaming token/quota readout in the app for hosted users (spend so far this month)
- Structured direction picker and clarifying-question forms as inline chat cards
- Adjustment knobs (spacing / color / radius) that patch tokens live
- Image placeholder → generation hooks, PPTX export, share bundles
- Windows/Linux once macOS is solid

## License

[Apache-2.0](LICENSE). UIO is an independent project, not affiliated with Anthropic or the Open Design project; it interoperates with Open Design's open content formats and gratefully credits both for the interaction model.
