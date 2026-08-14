# Online research and resource acquisition

## Research sequence

1. Turn each slide claim into a focused query. Search with the Harness-provided
   web or browsing tools; use command-line HTTP only when no search tool exists.
2. Prefer official documentation, original datasets, institutional reports, and
   the asset creator's own page. Cross-check consequential or time-sensitive
   facts with a second independent source.
3. Open the source page and verify the claim, publication date, publisher, and
   stable URL. Never cite a search snippet or an AI-generated summary as proof.
4. Put short citations on-slide and full source URLs in presenter notes. Include
   an access date for mutable web pages.

## Visual-resource selection

- Prefer official press kits, Wikimedia Commons, Unsplash, Pexels, government
  repositories, and other sources with explicit reuse terms.
- Confirm the individual asset's license; a site's general reputation is not a
  substitute. Record creator, source-page URL, and required attribution.
- Prefer `search_icons` for common symbols and native SVG, Mermaid, charts, or
  theme components for exact editable diagrams.
- Use `image_gen` when no suitable reusable visual exists or when the requested
  scene is conceptual rather than evidentiary. Never present generated imagery
  as documentary evidence.

## Download contract

1. Obtain the direct HTTPS URL for a PNG, JPEG, GIF, or WebP image no larger
   than 10 MiB.
2. Call `import_remote_image` with a descriptive destination such as
   `assets/sources/slide-05-satellite-nasa.jpg`. Existing files are never
   overwritten; choose a versioned sibling when needed.
3. If a host blocks direct downloads or the tool rejects the response, choose a
   different authorized source. Do not bypass access controls, hotlink defenses,
   authentication, private networks, or certificate checks.
4. Reference only the imported workspace-relative path from `slides.md`.
5. Run `list_assets`, `validate_slides`, preview inspection, and overflow checks.

Do not download executable files, archives, fonts, scripts, HTML, or SVG from
the network during deck authoring. Do not expose credentials or send private
workspace content to external services.
