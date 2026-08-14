---
name: fastppt-theme-xiaomi
description: Create, edit, review, and validate Xiaomi-style Slidev product decks using MiSans, Xiaomi orange, strong product imagery, large numeric proof, restrained cool grays, and generous whitespace. Use for decks that select slidev-theme-xiaomi, especially product launches, automotive presentations, feature narratives, and premium technology storytelling.
metadata:
  id: fastppt-theme-xiaomi
  version: 0.1.0-extracted.1
---

# FastPPT xiaomi theme

Use this Skill when a deck selects `theme: slidev-theme-xiaomi`.

## Visual contract

Use Xiaomi orange `#FF6900` only for decisive emphasis, with `#11161A` text,
white canvas, `#F3F5F6` surfaces, and cool-gray dividers. Use MiSans throughout.
The visual language is product-led and editorial: one large product image or
one dominant claim, asymmetric whitespace, very few borders, and no generic
blue corporate styling. Prefer dark metric pages as deliberate rhythm breaks.

## Registered layouts

- `cover`
- `default`
- `section`
- `end`
- `ending`: centered close or call to action.
- `two-col`: restrained 45/55 comparison or text/evidence split.
- `metrics`: dark proof page for one to three decisive numbers.

## Registered components

- `<XiaomiStat>`: one prominent number with a short label.
- `<XiaomiCallout>`: a compact evidence or feature note.
- `<XiaomiPill>`: a short category or status label; never a decorative cloud.

## Authoring workflow

1. State the deck's single argument spine.
2. Map each slide to a registered layout.
3. Use `#FF6900` sparingly, keep titles under two lines, and avoid dense card grids.
4. Source or generate a high-quality product visual when the subject benefits
   from one; do not substitute decorative gradients for product evidence.
5. Verify sources and units on-slide, then run preview and overflow checks.

## Minimal setup

```yaml
---
theme: slidev-theme-xiaomi
---
```

The common FastPPT Skill owns workspace safety, MCP, Harness, and export.
