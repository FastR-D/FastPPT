---
name: fastppt-resources
description: Search FastPPT Slidev composition references and logic diagrams, then adapt them to an active registered theme or create a new composition when no candidate fits.
---

# Composition retrieval

1. Determine the slide job, relationship (process, cycle, comparison, hierarchy,
   matrix, timeline), number of items, evidence type and content density.
2. Call `search_resources` using two or three semantic terms. Chinese and English
   relationship synonyms are expanded locally. Search summaries are bounded;
   never load the whole catalog into the model context.
3. Read 2–3 candidates using `read_resource`. Inspect the source page, description,
   licensing, text slots and warnings. `reconstructed` describes the available
   baseline primitives, **not** visual parity or export QA. `needs-review` carries
   explicit conversion limits. Excluded promotional/blank pages are hidden by
   default. Never turn reference sample data into claims about the user's topic.
4. Choose one approach and explain it briefly:
   - Reuse a fitting structure with the user's actual content.
   - Combine a logic diagram with the active theme's registered layout.
   - Create a new slide-local HTML/CSS composition when retrieval does not fit.
5. Preserve the active theme's palette, typography, density and constraints.
   The library provides geometry and content relationships, not an alternative
   theme. Rebuild unsupported geometry with editable primitives and labels.
   Do not flatten whole slides into screenshots.
6. Copy any necessary assets from the returned absolute local paths into the
   deck's assets directory and rewrite references. Retain provenance/licensing.
   Resource pages intentionally omit template wordmarks, copyright signatures,
   and header logo placeholders. Do not restore them from source references; keep sample company names neutral when adapting a composition.
7. For page edits, use the target source and revision supplied by FastPPT. Preserve
   all other pages byte-for-byte. A region uses top-left normalized coordinates;
   modify intersecting elements and necessary connectors only. A local region
   request does not authorize changing the whole page.
8. Format, validate and inspect the affected page. Report the result, validation
   and any remaining limitation. Do not call a structural conversion a completed
   visual review.

Offline fallback:

```bash
node --experimental-strip-types packages/resources/scripts/search.mjs --query "四步流程" --limit 6
node --experimental-strip-types packages/resources/scripts/search.mjs --id <resource-id>
```

## Source objects and native anchors

Prefer reusable native HTML objects and editable labels. `read_resource` supplies
bounded composition metadata and a `compositionPath` for the complete graph.
Inspect named source objects, their grouping, normalized boxes, replaceable slots
and connectors; use the mapped HTML anchor sets to extract or replace a region.
Text fragments can map many-to-one. Confidence is a rule score, not a probability;
ambiguous/geometry-only candidates and unmapped paint are not proven identity.
Do not invent source-to-paint relationships. A stale composition warning requires
regeneration or direct inspection before relying on its anchors.

Keep unsupported independent SVG paint as a disclosed fallback only where native
conversion is unavailable. For adaptation, rebuild the relevant object using
editable HTML/CSS, text and portable geometry. A native/fallback count is not
visual or export QA. Inspect the adapted slide and never flatten a whole page.
