---
name: fastppt-editable-visuals
description: Build diagrams, charts, tables, formulas, and SVG-backed visuals for FastPPT Slidev decks while preserving the strongest practical editable-PPTX delivery. Use when a requested visual contains information users may need to edit after export, or when deciding whether an SVG can safely remain a vector asset.
---

# FastPPT editable visuals

Use the strongest native representation that preserves the slide's meaning.
Do not claim an SVG image becomes individually editable PowerPoint shapes: in
the Slidev export path it remains a vector image. Rebuild decision-bearing
content with editable Slidev/HTML structures whenever the user requires
editable PPTX delivery.

## Workflow

1. Classify the visual: diagram, chart, table, formula, decorative SVG, or
   evidence image.
2. For a workspace SVG, call `inspect_svg_asset` before placement. Read
   [references/svg-contract.md](references/svg-contract.md) and follow its
   recommendation.
3. Build charts with native chart/table components where supported; build
   diagrams with semantic HTML, theme components, Mermaid, or simple native SVG
   paired with editable labels. Use MathML/HTML and editable text for formulas.
4. Keep all claims, axes, values, labels, formula terms, and citations as real
   Slidev text. Never replace an information-dense slide with a raster or SVG
   screenshot merely to preserve appearance.
5. Run formatting, validation, preview quality, and overflow checks. For an
   editable PPTX request, run `export_editable_pptx`; treat a quality-gate
   failure as a required redesign, not a warning.

## Constraints

- Use SVG only for portable vector assets; never use remote, absolute, scripted,
  or event-driven SVG content.
- Do not use browser-only SVG features such as `foreignObject` as a delivery
  shortcut. Rebuild them natively.
- A visual vector asset can preserve sharpness without being editable in
  PowerPoint. State that distinction in the delivery summary when it matters.
- Never use whole-slide SVG or bitmap substitution for a requested editable
  deck.
