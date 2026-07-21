---
name: Mono Terminal
description: Dark, monospaced, phosphor-green accent — a love letter to the terminal. For dev tools, CLIs, and hacker-culture brands.
swatches: #0c0e0c, #141714, #e6ede6, #7d877d, #232823, #33d17a
font: Mono everywhere
---

# Mono Terminal

Dark, monospaced, quietly glowing. A love letter to the terminal for developer
tools and hacker-culture brands. Restraint keeps it classy — this is a
terminal, not a gamer peripheral.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0e0c` | near-black green-tinted background |
| `--surface` | `#141714` | panels |
| `--ink` | `#e6ede6` | phosphor-white text |
| `--muted` | `#7d877d` | dim text |
| `--line` | `#232823` | borders |
| `--accent` | `#33d17a` | phosphor green |

## Typography

- Everything mono (`"SF Mono", ui-monospace, Menlo, monospace`). Hierarchy comes from size, weight, and dimming — not typeface changes.
- Headlines 40–64px, weight 500. Body 15px/1.7.
- ASCII affordances welcome: `$` prompts, `▮` cursors, box-drawing rules (`─`), bracketed labels `[LIKE THIS]`.

## Rules

1. Accent green for interactive/live elements and the primary CTA only. Errors may use `#e05561`; nothing else gets color.
2. No pure white: text is `--ink` at most. Glow effects at most one subtle `text-shadow` on the hero.
3. Borders are 1px solid `--line`; radii 4–6px max — terminals aren't round.
4. Tables and aligned columns beat cards. Pad with monospace discipline.
5. Scanline/CRT gimmicks: at most one, on the hero, at 3% opacity.
