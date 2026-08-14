---
name: fastppt-theme-ledger
description: Create, edit, review, and validate Ledger Slidev decks — an institutional finance design language (white ground, black skeleton, teal-green current data, terracotta conclusions) with serif assertions and sans numerals. For finance decks that select the slidev-theme-ledger theme.
metadata:
  id: fastppt-theme-ledger
  version: 0.1.0-fastppt.1
---

# FastPPT Ledger theme

Use this Skill when a deck selects `theme: slidev-theme-ledger`.

## Visual contract

Restrained, institutional, compliance-clean. Every body-page title is a complete
investment assertion (not a topic label), with a one-line scope subtitle. White
ground with a black top rule and skeleton; teal-green (`#4C9F8B`) carries current
values / the main scenario (never more than one-third of a chart); terracotta
(`#A95228`) is reserved for conclusion multipliers and arrows — it never means
"negative"; gray (`#CACED7`) marks historical values. Serif for titles and
conclusion numerals, sans for body, labels, and every numeral. Keep 1–4 charts and
3–5 evidence modules per page; label key values directly.

## Registered layouts

- `cover` (serif two-level title + terracotta key-point ticks)
- `default` (assertion + main chart)
- `section`
- `statement`
- `two-cols` (48:48)
- `quote`
- `image-right`
- `end`

## Signature components

- `<ChartHead no="3" title="…" basis="…" />` — three-layer chart head
- `<Multiplier value="+42%" />` — terracotta conclusion multiplier, at most once per chart

## Prohibited

- No dark full-bleed pages or large teal-green backgrounds.
- Do not replace teal-green with navy or bright blue.
- No heavy sans-serif page titles.
- Terracotta is never a negative-warning color.
- No colored blocks without data meaning; at most four series colors per page.

## Authoring workflow

1. Read the materials and fix the deck's decision/stance the ending must land on.
2. Map each slide to one registered layout; write each title as an assertion.
3. Use `ChartHead` for every chart; label current values in teal, historical in gray.
4. Cite sources, units, and time ranges where evidence appears.
5. Run FastPPT preview and overflow checks; visually review every changed layout.

## Minimal setup

```yaml
---
theme: slidev-theme-ledger
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns Ledger layout selection and visual fidelity.
