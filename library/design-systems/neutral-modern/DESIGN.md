---
name: Neutral Modern
description: Quiet, precise, software-native. Near-greyscale palette with a single cobalt accent — Linear/Vercel lineage.
swatches: #fafafa, #ffffff, #18181b, #71717a, #e4e4e7, #2563eb
font: System sans · mono details
---

# Neutral Modern

Quiet, precise, software-native. The chrome disappears so content is the only
thing that registers. Think Linear, Vercel, Stripe docs.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fafafa` | page background |
| `--surface` | `#ffffff` | cards, panels |
| `--ink` | `#18181b` | primary text |
| `--muted` | `#71717a` | secondary text |
| `--line` | `#e4e4e7` | hairlines |
| `--accent` | `#2563eb` | ONE saturated accent |

## Typography

- Display AND body: system sans (`-apple-system, "Segoe UI", sans-serif`). No serif in this system.
- Mono (`"SF Mono", ui-monospace, Menlo`) for numerics, eyebrows, keyboard hints.
- Headline weight 600, tight letter-spacing (−0.02em). Body 15–16px.

## Rules

1. Near-greyscale everywhere; the accent appears only on the primary action and live/selected states.
2. Radii small (6–8px). Shadows barely-there (`0 1px 2px rgb(0 0 0 / 4%)`) or none.
3. Hairline borders over shadows for separation.
4. Density is welcome — tables, keyboard hints, status dots — but always aligned to an 8px grid.
5. No gradients, no illustration, no decoration that isn't information.
