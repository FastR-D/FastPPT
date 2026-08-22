# Layered quality review

Quality review is evidence, not a single aesthetic score.

1. Schema: Markdown, frontmatter, theme, layout, and asset validation.
2. Pretext: deterministic natural-width, grapheme, tracking, and font preflight.
3. Geometry: rendered lines, clipping, overflow, and canvas bounds in the DOM.
4. Visual: hierarchy, crop, balance, contrast, and narrative emphasis; human or
   vision review remains necessary for these judgments.
5. PPTX: exported slide count, editability, substitutions, and fidelity.

`fast` requires schema plus deterministic text/geometry checks on affected
pages. `standard` requires a current full quality report with no errors and a
visual confirmation. `strict` additionally requires representative exported
PPTX inspection and treats unresolved human-review items as blocking.

Run `inspect_quality` on the first representative slide before scaling a layout,
then on every affected slide after final edits. A report is stale when the deck
revision, theme digest, or session-profile digest changes. Pretext is the first
layer only: it does not prove image crops, visual hierarchy, or aesthetics.
