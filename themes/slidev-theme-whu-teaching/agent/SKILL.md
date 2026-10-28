---
name: fastppt-theme-whu-teaching
description: Create, edit, review, and validate WHU Teaching Slidev decks with the source course's campus cover, forest-green headings, teal markers, white two-column pages, teaching diagrams, worked examples, and discussion questions.
metadata:
  id: fastppt-theme-whu-teaching
  version: 0.2.0
---

# FastPPT WHU Teaching theme

Apply with `theme: slidev-theme-whu-teaching`. Read [theme-rules.md](theme-rules.md) for palette, spacing, slot contracts and density. See [../example.md](../example.md) for all twelve layouts.

## Workflow

1. Use the common FastPPT workflow for workspace access, content, validation and preview. For a theme package maintenance task, edit the package and use repository build/registry checks.
2. Choose a registered layout: `cover`, `agenda`, `default`, `two-cols`, `diagram`, `example`, `exercise`, `section`, `end`, `content`, `split`, `toc`.
3. Preserve the white canvas, dark green #00523A headings, teal #00A98F markers, thin #C8D7D1 dividers, #F2F7F4 table alternation and a dark green course footer with lower-right page numbers.
4. Use Microsoft YaHei with bundled Noto Sans SC fallback. Body-page titles 42px, body 24px; cover 56px. Topic titles and classroom questions are appropriate.
5. For split layouts, put only the title/brief lead in the default slot. Place substantive content into the named slots documented in theme-rules.md.
6. Use real Markdown/HTML text and tables. `WhuCallout` highlights definitions/questions; `WhuStep` supports a worked derivation. Follow fastppt-editable-visuals for diagrams and formulas.
7. Review every affected slide for wrapping, clipping, internal collisions and footer clearance. Split crowded teaching content instead of shrinking it.
8. Export PPTX only when explicitly requested; a successful Slidev build does not establish editable-PPTX fidelity.

## Minimal setup

```yaml
---
theme: slidev-theme-whu-teaching
layout: cover
---
```

The source asset attribution is in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The campus image and institute mark can be replaced using cover frontmatter. Do not fabricate a new institution logo.

## Academy-inspired additions (0.2)

The theme now uses Academy-style academic hierarchy while retaining the WHU palette and campus cover. Read the 0.2 section in theme-rules.md. Use `section` layouts or `sectionStart: true` plus `sectionLabel` to drive the clickable navigation and `toc`. Keep chapter labels short (normally 2–6 chapters).

Use `density: normal | compact | dense`, `lineHeight`, and `flowGap` to control body rhythm. Choose the largest readable density; split crowded slides first. `split` / `two-cols` accept `ratio: '3:2'` and `gap: sm | md | lg`. Keep `WhuBlock` for definitions, `WhuNote` for lightweight explanations, `WhuTakeaway` for one conclusion, `WhuFigure` / `WhuTable` for explicitly numbered visuals, and `WhuCitation` for in-flow attribution. These components do not implement Academy's auto-numbering, Typst or Plotly APIs.
