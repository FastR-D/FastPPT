---
name: fastppt-image-production
description: Produce, review, and safely apply generated or edited raster visuals for a FastPPT Slidev deck. Use when a deck needs a new illustration, photograph, background, texture, visual variation, or an edit based on an existing image; do not use for diagrams, charts, tables, formulas, or slide text that must remain editable.
---

# FastPPT image production

The FastPPT Session Brief, active theme Skill, and requested slide are the
visual contract. Produce one accepted workspace asset, not a standalone image
experiment. Keep facts, labels, numbers, and citations in editable Slidev
content unless the user explicitly requests otherwise.

## Workflow

1. Read the deck and inspect existing assets. Read the active theme Skill to
   obtain palette, visual language, and layout constraints.
2. Select one mode: `generate`, `edit`, or `variation`. For diagrams, charts,
   tables, formulas, and logo reconstructions, stop and use editable Slidev,
   SVG, or native components instead.
3. Call `create_image_run` before generation. Create a visual brief containing: slide claim, subject, intended crop,
   composition, text-safe region, palette relationship, style, negative
   constraints, and source/reference assets when editing.
4. Use the platform-managed image-generation capability available to the
   current Harness. Do not request API keys or bypass FastPPT asset import
   controls. Generate one focused candidate at a time.
5. Inspect the candidate against the brief. Reject visual artifacts, unreadable
   generated text, wrong crop, unsuitable composition, or inconsistent style.
   If a candidate cannot satisfy the brief, revise the prompt and regenerate.
6. Import a candidate with `import_generated_image`, passing the exact deck path
   and `runId`, into a new workspace-relative path under `assets/generated/`.
   Do not overwrite an existing asset. Call `decide_image_candidate` with
   `accepted: true` before it may be used; reject unsuitable candidates instead.
7. Apply only an accepted image to the requested slide with meaningful alt text. Run format,
   deck validation, preview quality, and overflow checks for every affected
   slide. Report the final path and whether the image is decorative or evidence.

## Constraints

- Never generate a full-slide raster as a substitute for editable composition.
- Do not place remote URLs, data URLs, or paths outside the workspace in a deck.
- Treat generated visuals as illustrative unless their factual provenance is
  independently verified.
- Preserve user-provided images; create a versioned sibling for edits or
  variations rather than overwriting the source.
- For a remotely sourced image, record its final source URL and license/rights
  information during import; include the required attribution in editable slide
  content when applicable. Do not represent an unverified web image as evidence.
- Stop and request direction when a requested image would imitate a protected
  living artist, misrepresent a real event, or alter evidence without explicit
  disclosure.

Read [references/prompt-contract.md](references/prompt-contract.md) before a
generation or edit, and [references/review-and-acceptance.md](references/review-and-acceptance.md)
before importing a candidate.
