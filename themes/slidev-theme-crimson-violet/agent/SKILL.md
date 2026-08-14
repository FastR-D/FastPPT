---
name: fastppt-theme-crimson-violet
description: Create, edit, review, and validate crimson-violet Slidev decks — a theme extracted from an existing PPTX with its dominant palette (primary #A9B1EE), actual fonts (Noto Sans SC), and title/body type scale. For decks that select the slidev-theme-crimson-violet theme.
metadata:
  id: fastppt-theme-crimson-violet
  version: 0.1.0-extracted.1
---

# FastPPT crimson-violet theme

Use this Skill when a deck selects `theme: slidev-theme-crimson-violet`.

## Visual contract

Use the extracted palette. Primary #A9B1EE, secondary #871C23, canvas #FFFFFF with #000000 text. Titles Inter at ~24px, body Noto Sans SC at ~14px. Keep one claim per slide and the extracted color hierarchy; do not introduce unrelated hues.

## Registered layouts

- `cover`
- `default`
- `section`
- `end`

## Authoring workflow

1. State the deck's single argument spine.
2. Map each slide to a registered layout.
3. Keep to the extracted palette and type scale; verify sources and units on-slide.
4. Run FastPPT preview and overflow checks; visually review every layout.

## Minimal setup

```yaml
---
theme: slidev-theme-crimson-violet
---
```

The common FastPPT Skill owns workspace safety, MCP, Harness, and export.
