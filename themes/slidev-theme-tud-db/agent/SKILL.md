---
name: fastppt-theme-tud-db
description: Create, edit, review, and validate TU Dresden DB Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-tud-db
  version: 0.0.4-fastppt.1
---

# FastPPT TU Dresden DB theme

Use this Skill when a deck selects `theme: slidev-theme-tud-db`.

## Visual contract

仅在有权使用 TU Dresden 品牌资产的场景采用。保留品牌留白和页脚；研究对比用 two-cols-grid，章节采用 section 或 section-num。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/9 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `cover`
- `default`
- `section-num`
- `section`
- `two-cols-grid`
- `two-cols-header`

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
theme: slidev-theme-tud-db
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
