---
name: fastppt-theme-strategy
description: Create, edit, review, and validate Strategy Slidev decks — a consulting design language (deep forest green structure, bright green evidence, mint breathing room) with assertion-first pages and fine-line evidence. For consulting decks that select the slidev-theme-strategy theme.
metadata:
  id: fastppt-theme-strategy
  version: 0.1.0-fastppt.1
---

# FastPPT Strategy theme

Use this Skill when a deck selects `theme: slidev-theme-strategy`.

## Visual contract

Consulting density: high-information pages, assertion titles, fine green lines —
never cards as the default grouping. Deep forest green (`#03522C`) carries
structure (titles, skeleton lines, chapter codes); bright green (`#29B974`) marks
key evidence; mint zones give breathing room; magenta (`#E71C56`) means risk, only
at data level. Every body-page title must be a complete assertion sentence, with a
one-line scope subtitle. Prefer `two-cols` for paired evidence, `statement` for a
full-width claim, and the `ChapterBar` / `SoWhatBar` components for navigation and
bottom-line synthesis.

## Registered layouts

- `cover` (mint overlay + deep-green divider + optional header photo)
- `default`
- `section` (chapter page: left vertical photo + mint overlay)
- `statement`
- `two-cols` (2:1 evidence + explanation column)
- `quote`
- `image-right`
- `end`

## Signature components

- `<ChapterBar code="01" section="…" />` — chapter code + vertical rule + section name
- `<SoWhatBar label="结论" />…</SoWhatBar>` — one-line bottom synthesis

Use `cover` for the opening, `section` for genuine structural transitions, and a
`default` or `two-cols` body page otherwise. Keep 2–4 evidence modules per page and
one main chart plus a sidebar explanation; numbers carry units and time ranges.

## Prohibited

- No rounded-rectangle cards as the default grouping tool; use lines, whitespace,
  and type weight.
- No default equal-split (thirds/quarters/2×2) composition without a content reason.
- No blue-purple gradients, cyan-purple neon, rainbow flares, or glass cards.
- No photography spread across body pages or body copy on top of a photo.
- No empty solid regions in the body area.

## Authoring workflow

1. State the deck's single argument spine before writing pages.
2. Map each slide to one registered layout; write the title as an assertion.
3. Use only shipped components; cite sources and units where evidence appears.
4. Run FastPPT preview and overflow checks after meaningful edits; visually review
   every changed layout for clipping, weak contrast, and sparse pages.

## Minimal setup

```yaml
---
theme: slidev-theme-strategy
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns Strategy layout selection and visual fidelity.
