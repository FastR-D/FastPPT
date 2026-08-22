# Deck workflow reference

## New deck

1. Read the confirmed Session Brief; do not re-ask its required fields.
2. Write `deck-plan.json` with one argument spine and a short slide outline.
3. Create a valid global frontmatter block with the registered theme package.
   Keep every Slidev frontmatter block compact: do not leave blank lines after
   the opening `---` or before the closing `---`.
4. Draft one job per slide and select layouts only from the theme manifest.
5. Add assets as portable workspace files and cite external material on-slide.
6. Format, validate, render, inspect, and revise.

## Existing deck

1. Read the complete deck and preserve its narrative unless redesign is requested.
2. Inspect only affected slides first, then check neighboring transitions.
3. Keep stable IDs, presenter notes, citations, and asset paths intact.
4. Prefer focused edits over wholesale rewrites.
5. Revalidate the full deck because frontmatter or shared assets can affect every page.

## Layout and density

- Use the active theme Skill's layout decision rules.
- Treat registered layouts as reliable defaults, not the only allowed visual
  structures. Use scoped slide-local HTML/CSS for justified custom composition;
  follow [creative-css.md](creative-css.md).
- Split a slide when it has multiple independent claims.
- Replace paragraphs with short, parallel fragments.
- Use figures and diagrams only when they communicate information, not decoration.
- Inspect rendered output; Markdown length alone cannot establish visual fit.
- Write to the content standards in [content.md](content.md): claim-first
  titles, concrete numbers, one claim per slide, and no AI phrasing patterns.

## Completion report

Report the deck path, active theme ID and Skill version, files changed, validation
result, preview/overflow result, and export artifact only when export was requested.
