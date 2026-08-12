---
name: fastppt-theme-tahta
description: Create, edit, review, and validate Tahta Slidev decks using its registered layouts, components, visual rules, and FastPPT render-audit workflow.
metadata:
  id: fastppt-theme-tahta
  version: 0.13.3-fastppt.1
---

# FastPPT Tahta theme

Use this Skill when a deck selects `theme: slidev-theme-tahta`.

## Visual contract

必须显式选择与受众匹配的 themeConfig.variant。优先使用语义布局和组件，不在 slides.md 中重造网格或主题 CSS。

Keep one communicative job per slide, write short audience-readable fragments, and
preserve the theme's native typography, spacing, palette, and 16/9 canvas.
Do not add page-local CSS unless the user explicitly requests a custom extension.

## Registered layouts

- `agenda`
- `bigtype`
- `bleed`
- `chart`
- `code-explain`
- `code`
- `columns`
- `compare`
- `cover`
- `default`
- `define`
- `diagram`
- `embed`
- `end`
- `fact`
- `feature`
- `image`
- `lead`
- `logos`
- `metric`
- `panels`
- `quote`
- `reference`
- `section`
- `showcase`
- `statement`
- `stats`
- `steps`
- `timeline`
- `two-cols`
- `vs`

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
theme: slidev-theme-tahta
aspectRatio: '16/9'
---
```

The common FastPPT Skill owns workspace safety, MCP operation, Harness routing, and
export. This Skill owns theme-specific layout selection and visual fidelity.
