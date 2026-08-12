---
name: fastppt-theme-nmt
description: Create, edit, review, and validate NMT Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-nmt
  version: 0.9.10-fastppt.1
---

# FastPPT NMT theme

Use this Skill when a deck selects `theme: slidev-theme-nmt`.

## Visual contract

不要擅自改成 16:9。图片主导页用 figure/figure-side，人物介绍用 about-me；Announcement 只承载真正的状态或提示。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/10 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `about-me`
- `center`
- `cover`
- `default`
- `end`
- `figure-side`
- `figure`
- `grid`
- `section`
- `two-cols-2-1`
- `two-cols`

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
theme: slidev-theme-nmt
aspectRatio: '16/10'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
