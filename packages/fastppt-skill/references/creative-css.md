# Creative HTML and CSS

Use this reference when a slide needs a composition beyond the active theme's
registered layouts. The goal is the expressive freedom of a self-contained
PPTD page while retaining Slidev text editability, theme consistency, and
FastPPT preview validation.

## Design process

1. Choose one visual idea for the slide: hero image with anchored typography,
   editorial split, radial system, layered timeline, metric field, annotated
   product close-up, comparison plane, or another structure justified by the
   content.
2. Sketch the hierarchy in percentages before styling: dominant object, title,
   proof, annotation, source. Give one element unmistakable visual priority.
3. Build semantic HTML inside a unique slide wrapper such as
   `<div class="s07-product-orbit">`. Use CSS Grid for major regions, Flexbox
   for one-dimensional alignment, and absolute positioning for intentional
   overlays or annotations.
4. Style with the active theme's CSS variables and documented components.
   Derive translucent or lighter variants with `color-mix()` when supported;
   do not introduce an unrelated palette.
5. Preview at the fixed slide canvas, inspect overflow, and revise at full-slide
   scale. A composition is unfinished until every affected page is rendered.

Use visual variety deliberately. A deck may combine restrained default pages
with a few high-impact custom pages; it should not apply every available effect
to every slide. Repeat alignment logic, type hierarchy, and color behavior so
different compositions still read as one system.

## Allowed techniques

- Multi-track Grid, subgrid-style alignment through shared track definitions,
  asymmetric columns, intentional negative space, and controlled overlap.
- Absolute layers with explicit `inset`, `z-index`, and bounded containers.
- `linear-gradient`, `radial-gradient`, `conic-gradient`, multiple backgrounds,
  and pseudo-elements for atmosphere or hierarchy.
- `clip-path`, CSS masks, `object-fit`, `object-position`, filters, and blend
  modes for image treatment. Preserve the subject and never distort images.
- Vertical or oversized typography, outlined text, tight tracking, variable
  font weights, numeric tabular alignment, and controlled line breaking.
- CSS custom properties, `calc()`, `clamp()`, `min()`, `max()`, aspect ratios,
  and container-relative percentages for internally coherent geometry.
- Native HTML tables, SVG, Mermaid, and theme components embedded within the
  composition when they remain readable and editable.

## Authoring pattern

Put page markup in the slide body and custom rules in a deck-level `<style>`
block. Prefix selectors with a unique slide class so rules cannot leak:

```html
<div class="s07-product-orbit">
  <div class="s07-copy">
    <p class="s07-kicker">PRODUCT SYSTEM</p>
    <h1>One platform supports three product tiers</h1>
  </div>
  <img class="s07-hero" src="./assets/sources/product.png" alt="Product" />
  <div class="s07-proof"><strong>42%</strong><span>lower setup time</span></div>
</div>

<style>
.s07-product-orbit {
  --accent: var(--ext-primary, #ff6900);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.s07-product-orbit .s07-hero {
  width: 100%;
  height: 100%;
  object-fit: cover;
  clip-path: polygon(16% 0, 100% 0, 100% 100%, 0 100%);
}
.s07-product-orbit .s07-proof {
  position: absolute;
  right: 6%;
  bottom: 8%;
  display: grid;
  padding: 1rem 1.25rem;
  background: color-mix(in srgb, black 72%, transparent);
  color: white;
  backdrop-filter: blur(12px);
}
</style>
```

## Guardrails

- In Markdown image syntax, use `assets/...`. In native HTML `<img>`, use
  `src="./assets/..."`; without the leading `./`, Vue/Vite treats `assets` as a
  package import and preview fails with `Failed to resolve import`.
- Never use remote CSS, external scripts, iframes, runtime DOM mutation, or
  network-loaded fonts. Do not add Vue/JavaScript inside deck Markdown.
- Avoid global selectors such as `.slidev-layout h1`, `img`, `*`, or `:root` in
  deck-local CSS. Do not override theme variables globally.
- Do not hide overflow merely to conceal clipped content. A wrapper may use
  `overflow: hidden` only as an intentional visual crop after inspection.
- Do not trust automatic wrapping for display titles. Chinese punctuation,
  Latin model names, numeric values, and units create unstable wrap points.
  Group semantic lines with block spans or `<br>`, apply `word-break: keep-all`
  where appropriate, and use `white-space: nowrap` only after confirming each
  group fits its measured container.
- Avoid browser-fragile experimental features when a stable equivalent exists.
  Always provide a readable fallback for masks, blends, or translucent effects.
- CSS animations, transitions, and hover interactions are not substitutes for
  a static slide state. Use Slidev click steps only when requested.
- Do not encode factual text in pseudo-elements or background images; keep
  claims, labels, values, and citations as real selectable text.
- Editable PPTX export may approximate advanced filters, masks, blend modes,
  shadows, and clipped layers. When export is requested, inspect representative
  exported pages and simplify only the effects that fail materially. Keep the
  information hierarchy correct even when an effect is flattened or omitted.

## Visual QA

For every custom-composed slide:

1. Run `format_slides` and `validate_slides`.
2. Use `inspect_slide` to verify image paths and content structure.
3. Use `inspect_overflow`; fix both page overflow and internal text collisions.
4. Review contrast, image crop, z-order, alignment, repeated spacing, and source
   visibility in preview.
5. Check neighboring slides so creative pages vary rhythm without appearing to
   belong to a different deck.

### Text-fit checklist

- Titles use their intended one- or two-line structure; no accidental third
  line, punctuation orphan, or single trailing word remains.
- Numbers stay attached to units and model/version names remain intact.
- Every Grid/Flex child that may shrink has `min-width: 0`; long text does not
  force its track beyond the canvas.
- Text inside absolute layers, cards, callouts, captions, and citations remains
  within its own container, not merely within the slide boundary.
- `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight` for critical
  text containers when browser inspection evidence is available.
- Body text is shortened or split before dropping below the active theme's
  readable minimum size.
