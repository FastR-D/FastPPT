# FastPPT composition library

The catalog contains one independent Slidev Markdown page per static-layout source slide.
The dedicated animation source is owned by `packages/animations`; its effects are
retrieved through `search_animations` / `read_animation` for creative object composition.
The source reference files are never changed. `scan-report.json` records the
source SHA-256, original slide order, coverage, exclusions and warnings.

- `pages/<id>.md`: native HTML text, CSS geometry, local images and bounded SVG fallbacks;
  a page can be composed into an existing deck using its active theme.
- `manifest.csv`: concise title, style, scenario, tags, density, status and source.
- `index.json`: generated local search index; full text is excluded from search responses.
- `evidence/<id>.json`: source XML digest, text-slot anchors and normalized geometry.
- `render-audit.json`: per-page DOM measurements, bound to the index digest; search prefers pages without measured defects.
- `visual-comparison/`: source PDFs and historical measurement metadata. Generated
  screenshots, thumbnails, contact sheets and the image-pair viewer are removed.
- `assets/`: content-addressed images extracted from local references. Large binary
  assets follow the repository's existing Git ignore policy; regenerate them with
  the scanner when installing the reference pack on a new machine.
- `src/index.ts`: deterministic multilingual retrieval, paging and protected reads.
- `SKILL.md`: LLM composition/reuse contract.

## Rebuild and search

Python 3 with `python-pptx`, `lxml`, `pymupdf`, `Pillow`, `fonttools`, `numpy`,
LibreOffice, Fontconfig, system Chrome and the repository's Playwright dependency:

```bash
python3 packages/resources/scripts/scan.py
python3 packages/resources/scripts/render-originals.py
python3 packages/resources/scripts/pdf-rebuild.py
python3 packages/resources/scripts/restore-source-text.py --ids-file packages/resources/visual-comparison/source-text-restored-ids.json
python3 packages/resources/scripts/restore-source-fonts.py --ids-file packages/resources/visual-comparison/source-font-restored-ids.json
python3 packages/resources/scripts/refine-compositing.py
python3 packages/resources/scripts/clean-branding.py --apply
python3 packages/resources/scripts/reset-native.py --source-root /path/to/original-svg-baseline --report packages/resources/native-html-report.json
python3 packages/resources/scripts/composition-map.py --publish
node --experimental-strip-types packages/resources/scripts/audit.mjs
node --experimental-strip-types packages/resources/scripts/search.mjs --query "时间轴 里程碑" --limit 6
```

Native reconstruction must read a fixed, original SVG baseline tree containing
the original `packages/resources/pages` and `packages/animations/reference/pages`
paths. Preserve that baseline before conversion; do not use the converted pages
or their remaining fallback SVGs as the reconstruction source. Running against
the current converted pages is byte-idempotent, but would replace the provenance
report with hashes and counts for that already-converted input. `--resume` reuses
checkpoint entries only when both baseline and current output hashes still match.

The default scanner recursively visits every PPTX in
`references/GordenPPTSkill` and `references/pptset` in presentation order. It
uses Gorden's page role, use case and slot metadata where available. Stable IDs
are derived from relative source paths and one-based slide numbers. Re-running
does not create duplicate rows. Once visual reconstruction exists, an unchanged
pack is preserved. `--rebuild-baseline` explicitly discards repaired pages; use a
separate output directory when experimenting. Publish `manifest.csv`, `index.json`
and QA together. The default `audit.mjs` checks real DOM geometry and asset loading
without retaining screenshots; the historical image-comparison pipeline is opt-in
with `--save-screenshots` (including `render-originals.py --save-screenshots`).
Run `python3 packages/resources/scripts/clean-screenshots.py` after an opt-in audit
to remove generated screenshots from both libraries.

`FASTPPT_RESOURCES_ROOT` selects an external/private pack. Development resolves
this package automatically. The CLI can optionally bundle a local reference pack
with `FASTPPT_BUNDLE_REFERENCE_RESOURCES=1`; by default its code build does not
copy the 1 GB third-party image pack. Set `FASTPPT_RESOURCES_ROOT` when running a
packaged CLI against a separately installed pack.

## API / MCP

- `GET /api/v1/resources?query=流程&kind=diagram&density=balanced&limit=24&offset=0`
- `GET /api/v1/resources/:id` — source Markdown + metadata
- `GET /api/v1/resources/preview/:id` — script-free CSP-sandboxed HTML preview
- `search_resources` — bounded ranked candidates for LLMs
- `read_resource` — exact source and resolved local image paths

Ranking weights titles, semantic tags and scenarios above sample text. It expands
Chinese/English relationship synonyms and Chinese word/bigram tokens. It works
without a model service, embedding download or API key. Theme compatibility is a
composition decision made after retrieval, not a claim that palettes should be
copied. Excluded promotional/blank pages remain auditable via `status=excluded`.

## Fidelity and provenance

Original PPTX files are independently exported by LibreOffice, including hidden
slides enabled only in temporary copies. The historical reconstruction retained
the PDF's paint as independent SVG objects. The current conversion reconstructs
supported paint as HTML/CSS shapes and native geometry metadata, while keeping
unsupported independent paint in bounded, explicitly marked SVG fallbacks. Text
remains HTML with source origins, font sizes, rotation, paint order and
transparency. Opacity groups retain their compositing boundaries. No whole-slide
screenshot replaces the editable page.

The historical image audit compared browser-rendered pages with source PDF rasters using
RGB error and 8×8-block SSIM. Those scores describe their recorded Markdown hashes,
not the current HTML conversion. Current DOM audits check layout and assets against
the current index digest. Historical canvas glyph measurements checked text against source
bounds; intentional source bleed (such as cropped section numerals) is recorded
separately. Font spacing and small baseline/position differences were corrected
without clipping text or deleting content. Automated comparison is not a claim
that a person manually accepted every page. The gallery renders source HTML on
demand in script-free sandboxes, with a full-size live preview. No screenshot
endpoint or thumbnail cache is used; only cards near the viewport mount renderers.

LibreOffice output can differ from Microsoft PowerPoint when source fonts or
Office-specific effects are unavailable. Animations are represented by their
static exported state. Chart datasets remain attached as `data-fastppt-chart`
metadata; labels and table text remain HTML. Supported geometry uses CSS primitives
and native editable freeform metadata; unsupported SVG fallbacks remain disclosed.
Native PowerPoint chart/table objects and independently editable fallback SVG
subpaths are not guaranteed by this resource reconstruction. Reuse through the active theme
still requires the deck's export and visual QA.

`source-text-restored-ids.json` records the visually identified WordArt and
multi-paint text pages that need character-origin reconstruction during a rebuild.
Those pages retain named source-run groups and editable HTML characters, rather
than flattening decorative wording into a raster image.

## Clean composition references

`clean-branding.py` deletes reviewed template logo image/mask pairs, copyright
signatures, header logo placeholders, and the animation pack's side/footer
wordmarks as independent objects. Sample company names become neutral placeholders.
It does not add white covers or crop page corners. Original PPTX files, source
PDFs and provenance fields remain unchanged. Generated comparison images were
removed to keep the libraries compact; their numeric records remain historical.

`visual-comparison/branding-cleanup.json` records every object, exact normalized
bounds, before/after text, and page hashes. DOM checks use the remaining text
slots. Historical image QA compared the unchanged design outside those exact edit bounds;
`rawComparison` also records the unmasked source difference. The regular audit
reapplies cleanup, so a reconstruction cannot silently restore the known logos.

Some source PDFs contain embedded Type1/TrueType subsets whose glyphs differ from system
fallbacks. The identified pages use Unicode WOFF2 fonts rebuilt from those exact
outlines and source ToUnicode maps. `source-fonts.json` records each font xref,
asset, Unicode coverage and glyph bounds. Font CSS is a normal Slidev style block;
the sandbox permits local fonts, and MCP returns CSS URL assets for portable reuse.


## Native reuse and source object compositions

The offline converter uses Python 3.10+ with the tested dependencies in
`scripts/requirements-native.txt` (`python3 -m pip install -r packages/resources/scripts/requirements-native.txt`).
Previewing and reusing already generated pages does not require these Python packages.

Native HTML paint, editable text and local images are the reusable page baseline.
`compositions/<id>.json` retains the real PPTX object names, IDs, hierarchy,
normalized geometry, text/table/image/data slots and connector endpoints. Its
`htmlAnchors` and `mapping` connect source objects to page anchors with an explicit
method, confidence score and ambiguity. A PDF paint fragment is not automatically
a source object: geometry-only matches remain candidates, and unmatched objects
remain visible in the report. Group coordinates are transformed to slide space;
rotated boxes and inherited master decorations carry stated limitations.

`read_resource` returns a bounded semantic sample and `compositionPath`; read the
local JSON for the complete object graph. `ResourceLibrary.read()` exposes the
full current composition. Page SHA-256 protects against stale anchor mappings.
Use the source slots and mapped anchor sets when replacing content or extracting
one structure. Native/fallback counts describe implementation, not visual parity.
Fallback SVG is retained only for unsupported independent paint; rebuild that
object with native editable primitives when adapting it. Never replace a page
with a screenshot or a whole-slide SVG.

After all page conversions finish, rebuild compositions and optionally publish
index, CSV manifest, evidence references and revisions from actual Markdown hashes:

```bash
python3 packages/resources/scripts/composition-map.py
python3 packages/resources/scripts/composition-map.py --publish
python3 -m unittest discover -s packages/resources/tests -p test_composition_map.py
```

The script visits all 3,497 static pages plus the 211 animation reference pages,
including excluded pages, and records all 32 source hashes in the two
`composition-report.json` reports. It leaves Markdown, animation motion files and
source PPTX files untouched.

Publishing compositions after a native conversion synchronizes each page revision to its actual Markdown SHA-256 prefix. Previous render scores remain under `historicalRenderQa` / `historicalVisualQa` and historical CSV columns; they do not certify the current HTML. Evidence preserves the source slots and original reconstruction baseline, while `nativeHtml` and `currentPageSha256` identify the current representation awaiting its own render audit.
