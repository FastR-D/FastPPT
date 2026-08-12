# Editable Slidev to PowerPoint

Slidewave converts rendered Slidev pages into native PowerPoint objects instead of taking full-slide screenshots. Text remains text, simple CSS boxes remain shapes, borders remain lines, and images remain individually movable image objects.

## FastPPT integration

This document describes the migrated conversion implementation. In the FastPPT monorepo it is not exposed as a standalone browser export API. Themes load `slidewave/browser/runtime`; the FastPPT SPA requests capture inside a hidden Slidev `/print` iframe and uploads the resulting `slidewave/snapshot` payload. The Gateway then calls `slidewave/server` to write the editable file.

Keeping capture and file output on opposite sides of the iframe protocol is an architectural requirement. It ensures that Gateway and MCP never launch Chromium and that browser capture cannot bypass authentication, cancellation, progress, or export status handling.

## Capture extension architecture

The package separates generic browser conversion from theme-specific component corrections:

- `capture.ts` orchestrates deterministic DOM traversal and emits the snapshot IR.
- `dom.ts`, `geometry.ts`, and `transform.ts` contain reusable visibility, coordinate, text-box, and CSS-transform logic.
- `capture-style.ts`, `css.ts`, and `svg.ts` normalize reusable CSS, borders, shadows, gradients, masks, and assets.
- `render.ts` maps the IR to PowerPoint objects, while `render-svg.ts` owns vector gradient and exact-radius construction.
- `themes/types.ts` defines the capture-theme extension point. `themes/landing/` contains only Landing selectors and component-level corrections for Mark, Hint, paper-summary, and page numbers.

Theme handling defaults to `auto`. A caller can make the policy explicit or disable all component-specific corrections:

```ts
await captureSlidevOverview({ theme: 'landing' })
await captureHtmlSlide(root, { theme: 'none' })
```

Custom themes can implement `SlidevCaptureTheme` and pass the extension directly through the same `theme` option. Theme extensions adjust captured fragments and component effects; they do not alter the serialized snapshot schema or the generic PowerPoint renderer.

`captureHtmlSlide(root)` captures one arbitrary HTML canvas. `captureSlidevDeck()` captures all visible roots matching `.slidev-page`. `captureSlidevOverview()` targets the overview thumbnails used by Slidev 52 and excludes the duplicate active viewer page.

## Deterministic model

The conversion has two explicit stages:

1. Browser capture reads final boxes and computed styles after fonts, images, caller readiness, and two animation frames have settled.
2. A pure renderer maps the versioned JSON snapshot to Slidewave and pptxgenjs objects.

All geometry is stored in the intrinsic Slidev canvas coordinate system. For the Landing theme this is `980 × 552`, even when the viewer or overview scales the page. A standard `LAYOUT_WIDE` PowerPoint uses `13.333 × 7.5` inches, so the renderer uses:

```text
x(in) = x(px) × 13.333 / 980
y(in) = y(px) × 7.5 / 552
font(pt) = font(px) × 72 × sqrt((13.333 / 980) × (7.5 / 552))
```

The resulting typography scale is approximately `0.979 pt/px`. A computed 20px heading therefore becomes about 19.58pt. Applying the generic web conversion of 0.75pt/px would make the whole deck visibly too small.

Browser line wrapping is not delegated to PowerPoint. The capture combines Pretext grapheme/font measurement with DOM `Range` rectangles and emits each rendered line fragment as an independent editable text box with `margin: 0`, `fit: none`, and wrapping disabled. DOM geometry preserves the browser's actual line breaks; Pretext keeps combining marks, ZWJ emoji, CJK, and shaped scripts intact and records a font-aware advance used to prevent PowerPoint clipping.

## Landing theme audit

The Landing reference theme in `themes/slidev-theme-landing` uses an intrinsic `980 × 552` canvas, UnoCSS Wind3, `Source Han Sans` for sans text, and `JetBrains Mono` for monospace text.

### Typography

| Theme usage     | Computed size | PowerPoint size on `LAYOUT_WIDE` | Notes                               |
| --------------- | ------------: | -------------------------------: | ----------------------------------- |
| `text-sm`       |          14px |                         ~13.71pt | Card details, child TOC items       |
| `text-base`     |          16px |                         ~15.66pt | Body, hints, page number            |
| `text-lg`       |          18px |                         ~17.62pt | Large hints and column titles       |
| `text-xl`       |          20px |                         ~19.58pt | Chapter and section headers         |
| `text-2xl`      |          24px |                         ~23.49pt | Icons, cover subtitle, TOC number   |
| `text-3xl`      |          30px |                         ~29.37pt | TOC headings                        |
| `text-4xl`      |          36px |                         ~35.24pt | Cover title                         |
| Citation footer |           7px |                          ~6.85pt | Must not be rounded up or discarded |

The page number is a distinct 16px bold italic `Times New Roman` run with wide tracking. Inline citations can be 0.72em superscripts. Their vertical placement comes from measured `Range` boxes, so they stay separate from surrounding baseline text while remaining editable.

Fonts are referenced by family name and are not embedded in the PPTX. Install the required families on every machine that opens or regenerates the deck. The local Landing export maps the theme's `Source Han Sans` name to `Source Han Sans SC`.

### Components

| Component  | Render behavior                                                                     | Editable mapping                                                                                   |
| ---------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Block`    | Centered column, 14/16/18px content, 24px icon, rounded gradient card               | Rounded shape, editable text, SVG icon image; gradient becomes a solid-color approximation warning |
| `Chevron`  | 48px high clipped step, 14/16px title, optional 20px icon                           | Native PowerPoint chevron, editable title, SVG icon image                                          |
| `ColBlock` | 18px bold title band over a 14px body, rounded border and shadow                    | Separate title/body shapes, text boxes, border lines, editable shadow                              |
| `Hint`     | Inline or full-width flex row, 14/16/18px content, bold title and divider           | Measured container shape, divider line, independently styled text fragments and icon               |
| `Mark`     | Bold inline text with a pink lower highlight                                        | Editable text over a clean 6px-class translucent rounded band positioned in the lower text region  |
| `MyCard`   | 24px icon plus 16px bold title and 14px body in a rounded translucent gradient card | SVG gradient background plus independently editable rounded border, shadow, icon, title, and body  |
| `MyText`   | Inherited font inside a padded translucent blue inline/full-width box               | Measured rounded shape with its browser-composited light fill and editable inherited text          |
| `Tag`      | Empty component                                                                     | No output                                                                                          |

### Layouts and hierarchy

`base` is a fixed-height column: a 56px header, a flexible main region, and a footer ending in a 24px blue bar. With no references the measured main region is 464px and the total footer is 32px. Two 48px-high logos are absolutely positioned at the upper right. The converter measures these boxes instead of reconstructing the flex algorithm.

`content-flex`, `content-grid`, and `my-image` use a 150px minimum chapter cell and a flexible section cell, both at 20px bold. `cover` centers a 300px blue title band. `paper-summary` uses a 12-column grid with a 4/8 split. `toc` layers a `z-index: 10` blue square over a darker square and uses 30px headings. `default` delegates to `content-flex`.

Layer order is flattened from computed z-index plus stable DOM paint order. Parent backgrounds and borders are emitted before pseudo-elements and descendants. This preserves the Landing header bands, card content, TOC overlap, highlight layers, logos, list markers, and footer bar as separate PowerPoint objects.

## CSS support and fallbacks

| Browser rendering                    | PowerPoint output                                                     |
| ------------------------------------ | --------------------------------------------------------------------- |
| Text and inline text                 | Native text boxes                                                     |
| Solid backgrounds                    | Native shapes                                                         |
| Rounded boxes, circles, Landing chevrons | Native shapes                                                         |
| Uniform solid/dashed/dotted borders  | Native shape strokes; non-uniform borders remain native lines         |
| `<img>`                              | Native image objects                                                  |
| Inline SVG and SVG-backed CSS masks  | Individual SVG image objects                                          |
| Canvas                               | Individual PNG image objects                                          |
| CSS linear gradients                 | Separate SVG gradient layer; text, border, and shadow remain editable |
| Backdrop filters                     | Omitted plus warning                                                  |
| Generic clip paths                   | Editable rectangle approximation plus warning                         |
| Video, audio, iframe, embed, object  | Skipped plus warning                                                  |

CSS-generated unordered-list circles and check marks are captured through `::before` and `::after`. Ordered-list counters are captured as zero-padded editable text. Slidev click states and tab panes are exported exactly as currently rendered; open the desired state before capture. Asynchronous DOI references or other application data should be awaited with the `ready` callback.

Thin solid CSS rectangles, such as the `Hint` divider, are emitted as exact horizontal or vertical PowerPoint lines. List markers are centered against the first rendered text line. Slidev overview page numbers are corrected from the viewer's global current-page value to each captured slide id, with the text box widened for two-digit page numbers while preserving its right edge.

For translucent fills combined with `backdrop-filter`, the converter precomposites the color against the captured ancestor backdrop. This avoids PowerPoint-specific alpha blending from making `MyText` and `Hint` visibly darker than their Slidev rendering.

Text inside a centered `Hint` flex container uses a font-safe text box centered on the browser's actual flex line, plus PowerPoint middle alignment. The box deliberately does not start at the background's top edge. Large 18px Hints also receive a small font-relative downward optical correction to compensate for Source Han Sans appearing above PowerPoint's geometric center.

Zero-height inline wrappers with visible text descendants are retained. This is required for CSS superscripts such as `paper-summary` citation markers, whose wrapper can report a zero-height box even though its text range is visible. The paper abbreviation is centered within its title band while the citation remains an independent, raised editable text box.

Tall `overflow-hidden` containers use an exact CSS-pixel SVG outline for their border radius, because PowerPoint's built-in rounded rectangle scales its corner curvature with the entire shape. Full-width header bands retain an editable rounded fill. This keeps `paper-summary` at its measured 8px corner radius instead of producing square top corners and oversized bottom corners.

For portable files, keep `embedImages` enabled. When it is disabled, the snapshot records asset paths and the renderer assumes those paths remain reachable when PowerPoint is generated.
