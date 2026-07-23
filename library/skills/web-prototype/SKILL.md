---
name: Web prototype
description: Single self-contained HTML page — landing, marketing, docs, or SaaS surface. Composed from the bundled seed, not written from scratch.
mode: prototype
entry: index.html
---

# Web Prototype

Produce **one self-contained HTML file** (`index.html`) by copying the seed at `assets/template.html` and composing sections from it. The seed already encodes good defaults — tokens, type scale, spacing, accent budget. Your job is composition and real content, not reinventing CSS.

## Workflow

1. **Read `assets/template.html` end to end** (at minimum the whole `<style>` block and the sample sections). Every class you need is defined there.
2. **Read the active `DESIGN.md`** if one is present at `../DESIGN.md` (relative to this file). Map its tokens onto the `:root` variables in the seed. Do not invent new token names.
3. **Plan the section list first** and state it in one sentence. Default rhythm for a landing page: hero → feature grid → stats or quote → closing CTA. Editorial: centered hero → article list → CTA.
4. **Copy the seed to `index.html`** in the workspace root, replace the `:root` tokens, the `<title>`, and the nav brand, then build your planned sections inside `<main>`.
5. **Fill with real copy** from the brief. No lorem ipsum, no `[placeholder]` strings. If a section has nothing real to say, cut the section.
6. Self-check: single accent used at most twice per viewport; serif display + sans body; placeholder blocks (`.ph-img`) instead of external images; reflows at 920px; `data-vds-id` on every `<section>`.

## Hard rules

- Fully self-contained: inline all CSS/JS. No CDN links, no web fonts, no external images.
- System font stacks only (the seed's stacks are correct).
- `data-vds-id="section-name"` on every top-level `<section>` so inline comments can target them.
- Write the file, then end with a 2–4 sentence summary. Never paste the HTML into chat.
