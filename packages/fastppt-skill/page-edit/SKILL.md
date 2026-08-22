---
name: fastppt-page-edit
description: Safely modify exactly one Slidev page while preserving every other page byte-for-byte. Use when FastPPT supplies an edit-page session target with a Markdown path, slide number, and the current target-page source.
---

# FastPPT single-page edit

The Session Brief and `<fastppt-target-page>` block are authoritative. The
request is a surgical edit, not a deck rewrite.

## Required workflow

1. Read the complete target Markdown with `read_slides` and verify that the
   supplied page source still matches the requested slide number. Stop and
   report a stale target if it no longer matches.
2. Preserve the global headmatter, slide delimiters, and every non-target page
   byte-for-byte. Do not reorder, add, remove, or silently normalize pages.
3. Change only the target page and only as required by the user's instruction.
   Retain its citations, notes, IDs, asset paths, and semantic content unless
   the instruction explicitly changes them.
4. Write the complete Markdown with `write_slides` using the current revision.
5. Run `format_slides`. If formatting changes any non-target page, restore those
   pages before continuing.
6. Run `validate_slides`, then `inspect_quality` for the target page. Use
   `inspect_overflow` when the request concerns wrapping, clipping, or density.
7. Report the target page, exact change, validation result, and quality result.

## Hard failures

- Never modify another page as a cleanup or consistency improvement.
- Never change page count or page order.
- Never accept a page number without comparing the supplied source block to the
  current document.
- Never claim completion when formatting, validation, or target-page quality
  inspection fails.
