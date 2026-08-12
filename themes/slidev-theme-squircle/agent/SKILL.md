---
name: fastppt-theme-squircle
description: Create, edit, review, and validate Squircle Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-squircle
  version: 0.1.0-fastppt.1
---

# FastPPT Squircle theme

Use this Skill when a deck selects `theme: slidev-theme-squircle`.

## Visual contract

先设定一个 color palette 并保持一致。卡片适合并列信息，流程用 process-flow/steps-layout，避免把每页都放进多层面板。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/9 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `default`
- `agenda`
- `cards`
- `closing`
- `cols`
- `comparison`
- `cover`
- `frame-panel`
- `image-full`
- `image-left`
- `image-right`
- `intro`
- `panel`
- `process-flow`
- `profile`
- `quote`
- `section-frame`
- `section-index-center`
- `section-index`
- `section-subtitle`
- `section`
- `stats`
- `steps-layout`
- `table`
- `team-border`
- `team`
- `timeline`
- `title-center`
- `title-sandwich`
- `title`
- `toc`

Choose the narrowest layout that matches the content. Use `cover` only for the
opening when available, `section` for genuine structural transitions, and a
`default` body page when no specialized layout improves the argument.

## Authoring workflow

1. Read the user's materials and state the deck's single through-line.
2. Map each slide to one registered layout before writing detailed content.
3. Use only components shipped in this theme; inspect `components/` names when the
   deck needs a richer primitive.
4. Keep citations, image credits, units, and institutional claims on the slide where
   they appear. Never invent missing sources or brand authorization.
5. Use FastPPT preview status and overflow inspection after meaningful edits.
6. Visually review the live preview for clipping, weak contrast, broken assets,
   accidental sparse pages, and repetitive composition.
7. Preserve removed but useful material in backup slides or user notes rather than
   silently deleting it.

## Minimal setup

```yaml
---
theme: slidev-theme-squircle
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
