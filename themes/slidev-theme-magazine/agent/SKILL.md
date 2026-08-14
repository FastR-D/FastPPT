---
name: fastppt-theme-magazine
description: Create, edit, review, and validate Magazine Slidev decks — an austere luxury editorial design language (cool white, deep black, desaturated photography, narrow copper-brown and warm-gold accents). For brand-campaign decks that select the slidev-theme-magazine theme.
metadata:
  id: fastppt-theme-magazine
  version: 0.1.0-fastppt.1
---

# FastPPT Magazine theme

Use this Skill when a deck selects `theme: slidev-theme-magazine`.

## Visual contract

Austere luxury editorial: narrative pages are full-bleed desaturated documentary
photography (architecture, materials, craft, people, on-site) with mist-white
horizontal bands for conclusions; data pages are pure white with hairline top and
bottom rules and the title below the top rule. Copper-brown (`#9D5A37`) is the
primary accent for the main series and one conclusion, never covering more than
~15% of a slide; warm-gold (`#CC9900`) marks small highlights. Serif for titles and
big numbers, sans for body and data. One big idea per slide — the title states the
chapter message and every module serves it.

## Registered layouts

- `cover` (full-bleed photo + proposition/date centered lower)
- `default` (data page: hairline rules, title below top rule)
- `narrative` (full-bleed photo + mist-white bands, `band-1/2/3` slots)
- `section` (divider: full-bleed image + one short judgment)
- `statement`
- `two-cols` (evidence + interpretation)
- `quote`
- `image-right`
- `end`

## Signature components

- `<MistBand />…</MistBand>` — mist-white horizontal band over imagery, max 4 per slide
- `<GoldBadge value="+18%" />` — warm-gold oval number badge, max 3 per slide, above financial charts

## Prohibited

- No cards as the default grouping tool; lines, whitespace, and type weight instead.
- No blue-purple gradients, glass cards, glowing borders, or rainbow charts.
- Do not flood a slide with copper-brown or warm-gold.
- Photography is real documentary imagery — never illustration, gradients, or fabricated scenes; never carry photography into data areas.

## Authoring workflow

1. Fix the single proposition/chapter message the deck advances.
2. Map each slide to one registered layout; use `narrative` for story pages and
   `default` for data pages with direct chart labels.
3. Source real photography; keep every image relevant to the page's claim.
4. Run FastPPT preview and overflow checks; visually review every changed layout.

## Minimal setup

```yaml
---
theme: slidev-theme-magazine
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns Magazine layout selection and visual fidelity.
