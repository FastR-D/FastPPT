---
name: fastppt-theme-narrative
description: Create, edit, review, and validate Narrative Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-narrative
  version: 0.1.2-fastppt.1
---

# FastPPT Narrative theme

Use this Skill when a deck selects `theme: @ricoapon/slidev-theme-narrative`.

## Visual contract

每页只保留一个叙事动作；有照片时优先 image-left/image-right，纯观点使用 statement。避免加入第二套高饱和品牌色。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/9 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `center`
- `cover`
- `default`
- `image-left`
- `image-right`
- `statement`

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
theme: '@ricoapon/slidev-theme-narrative'
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
