---
name: Slide deck
description: Paged HTML presentation — pitch, review, teaching deck. Keyboard-navigable in preview, one slide per PDF page on export.
mode: deck
entry: deck.html
---

# Slide Deck

Produce **one self-contained HTML file** (`deck.html`) from the seed at `assets/deck.html`. Each slide is a `<section class="slide">` sized to the viewport; the seed ships keyboard navigation (←/→, Home/End), a slide counter, and `@page` print CSS so PDF export gets one slide per page.

## Workflow

1. **Read `assets/deck.html` end to end** — style block, nav script, and the sample slides.
2. **Read the active `DESIGN.md`** if present at `../DESIGN.md` and map its tokens onto the `:root` variables.
3. **Plan the slide arc before writing** and state it in one sentence. Default 10-slide pitch arc: cover → problem → vision → product (2–3) → traction/stats → how it works → team → ask → contact. Teaching deck: cover → agenda → concept slides → recap.
4. **Copy the seed to `deck.html`**, replace tokens/title, then write slides. Alternate layout rhythms — full-bleed statement slides between dense ones. Every number, name, and claim comes from the brief.
5. Self-check: readable at a glance (max ~5 lines of body text per slide); one accent; consistent margins; `data-uio-id` on every slide; counter shows correct total.

## Hard rules

- Fully self-contained: inline CSS/JS, no external assets. `.ph-img` blocks for imagery.
- 1280×800 design canvas; type must be legible from the back of a room.
- `data-uio-id="slide-01"` (zero-padded) on every `<section class="slide">`.
- Write the file, then end with a 2–4 sentence summary. Never paste the HTML into chat.
