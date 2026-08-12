# Slidewave workspace package

This package is FastPPT's maintained Slidewave implementation, not an adapter around an external checkout. Upstream integration notes are retained in `SLIDEV_EDITABLE_PPT.md`; the package manifest records the MIT license inherited from the fork, and `THIRD_PARTY_NOTICES.md` records the Pretext integration.

## Runtime boundaries

- `slidewave` preserves the fork's presentation-building core. It deliberately does not re-export DOM capture, snapshot rendering, or the old browser-to-file shortcut.
- `slidewave/browser` exposes the versioned iframe protocol. Its workspace browser runtime owns all DOM reads and is injected into Slidev.
- `slidewave/snapshot` owns the runtime schema and transport-safe snapshot types shared by browser and server consumers. FastPPT re-exports this contract instead of maintaining a duplicate application copy.
- `slidewave/server` exposes the fork's snapshot-to-editable-PPTX conversion. It knows nothing about FastPPT jobs, progress phases, cancellation, health probes, browser launchers, or preview URLs.
- Each workspace theme imports `slidewave/browser/runtime` from its Slidev `setup/main.ts`, so development consumes workspace source directly and production consumes the package build.

The package participates in the repository build graph through composite TypeScript project references. The snapshot contract, browser runtime, and server runtime inherit the repository's strict defaults as separate projects and emit incremental declarations only under `.tsbuild/`; tests are checked by a separate no-emit project. Browser code is compiled with DOM libraries and no Node globals; server code is compiled with Node globals and no DOM library. `tsconfig.core.json` is an explicitly scoped compatibility project for the migrated upstream presentation-building core; its relaxed legacy options cannot apply to FastPPT's integration boundaries.

All public entries expose workspace-owned source for development and type resolution, so repository consumers do not depend on a pre-existing `dist` directory. The server entry uses the fork's single HTML-to-editable-object conversion algorithm with a minimal Node-only PptxGenJS presentation backend; it does not duplicate or replace the conversion rules. FastPPT validates transport data and owns export job orchestration, cancellation, progress, readiness, and error mapping at the Gateway boundary; Slidewave stays usable without importing or modeling any `@fastppt/*` application concept. Package tests enforce that dependency direction, keep Node and Chromium runtimes out of browser code, and keep DOM capture modules out of server code.

The migration intentionally retains fork conversion modules under `src/slidev`, core presentation primitives under `src/`, and their tests. Monorepo adaptation is limited to package exports, shared dependency/catalog ownership, project references, the transport snapshot contract, the iframe browser runtime, and the Node server backend. FastPPT application DTOs and job lifecycle code must stay outside this package.

## Export flow

```text
FastPPT SPA
  -> hidden Slidev /print iframe
  -> slidewave/browser/runtime DOM capture and inspection
  -> versioned postMessage snapshot
  -> authenticated Gateway upload
  -> Gateway-owned export queue
  -> slidewave/server snapshot conversion
  -> editable PPTX
```

The server never starts Chromium. MCP uses FastPPT's workspace-scoped Gateway/browser delegate; without an active SPA it reports rendered export and inspection as unavailable.

The upstream standalone `exportSlidevOverviewToPptx` API is intentionally not part of this workspace package's public surface. It coupled DOM capture, conversion, and file output in one browser call, bypassing FastPPT's authenticated iframe protocol and Gateway-owned job lifecycle.

## Text measurement

Browser capture combines `@chenglou/pretext` with DOM `Range` geometry. Pretext supplies Unicode grapheme segmentation and font-aware advance measurement for CJK, combining marks, emoji, mixed-direction text, and CSS letter spacing; DOM ranges remain the source of truth for rendered line breaks and positions. The snapshot carries optional text advance metadata, and the server renderer uses it only to widen undersized PowerPoint text boxes without changing their measured alignment anchor. This avoids splitting shaped graphemes and reduces clipping when PowerPoint resolves the same named font differently from Chromium.
