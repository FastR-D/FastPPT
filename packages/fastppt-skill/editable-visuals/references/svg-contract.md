# SVG delivery contract

Run `inspect_svg_asset` on every workspace SVG before using it in an editable
delivery. Its result has three meanings:

- `embed-vector`: a portable SVG may remain an SVG asset, but it is still an
  image in the PPTX export, not a collection of editable PowerPoint shapes.
- `rebuild-natively`: recreate the visible information with semantic HTML,
  Mermaid, a native table, a native chart, or theme components. Keep the SVG
  only as a preview/reference asset when useful.
- `blocked`: remove unsafe scripts, absolute or remote dependencies, then
  inspect again. Never place such an SVG in the deck.

An SVG is appropriate for decorative or fidelity-first vector artwork. Values,
labels, formulas, citations, data series, and decision-bearing diagrams require
native Slidev content when the exported PPTX must remain editable.
