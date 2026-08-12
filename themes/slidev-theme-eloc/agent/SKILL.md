---
name: fastppt-theme-eloc
description: Create, edit, review, and validate Eloc Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-eloc
  version: 1.1.0-fastppt.1
---

# FastPPT Eloc theme

Use this Skill when a deck selects `theme: slidev-theme-eloc`.

## Visual contract

使用短标题、少量要点和清晰代码层级。由于只有 default 布局，应通过 Markdown、代码块和有限列布局组织内容，避免无意义卡片化。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/9 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `default`

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
theme: slidev-theme-eloc
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
