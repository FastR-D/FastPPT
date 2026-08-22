---
name: fastppt
description: Create, edit, validate, preview, and export Slidev presentation decks inside a FastPPT workspace, including creative page composition with advanced HTML/CSS, researching current facts online, finding reusable visual resources, safely downloading remote images, generating raster visuals with Codex imagegen, and citing sources. Use for any FastPPT deck task involving slides.md, custom visual design, complex CSS, research, web search, workspace assets, remote or generated images, preview checks, overflow checks, or editable PPTX export; always pair it with the theme-specific Skill resolved by FastPPT.
---

# FastPPT deck workflow

Use the FastPPT MCP tools for workspace access. Never bypass them with arbitrary
paths, and never infer a theme from prose. FastPPT supplies an immutable theme
snapshot and explicitly invokes the one matching theme Skill for each run.
The tagged FastPPT Session Brief is authoritative for audience, intent,
narrative mode, language, duration, review policy, artifact route, and theme.
Do not ask for these fields again unless the user explicitly changes the task.

## Required workflow

1. Call `get_workspace`, then `get_theme_manifest` and `get_theme_skill` for the
   supplied theme ID. Stop if the theme or its managed Skill is unavailable.
2. Translate the Session Brief into a lightweight `deck-plan.json` containing
   the communication goal, argument spine, slide jobs, evidence needs, and
   chosen narrative mode. Read [references/modes.md](references/modes.md).
3. Read `slides.md` with `read_slides` and inspect existing assets with
   `list_assets` before editing.
4. Follow the simultaneously invoked theme Skill for visual language, layouts,
   components, frontmatter, density, and theme-specific validation.
   The theme is a design system, not a creativity ceiling: use slide-local HTML
   and CSS when a registered layout alone cannot express the intended page.
5. Make the smallest coherent deck change with `write_slides`. Keep image paths
   relative and store images as files; never place large base64 data in Markdown.
   When the deck needs a sourced or generated raster visual, follow the asset
   workflow below.
6. Run `format_slides`, then `validate_slides`. Fix every syntax, theme, missing
   asset, and unsupported-layout error.
   Slidev frontmatter blocks must have no blank lines immediately inside the
   `---` delimiters; keep metadata directly between the opening and closing
   delimiter.
7. Check `get_preview_status`. Inspect the first representative page early with
   `inspect_quality`, then inspect every affected page after the final edit.
   Use `inspect_slide` and `inspect_overflow` for focused diagnosis.
   Treat line wrapping, internal collisions, clipped descendants, and text that
   exceeds its intended line count as failures even when the outer slide itself
   reports no overflow.
8. Apply the active review policy and quality gates in
   [references/quality.md](references/quality.md). Summarize changed files and
   validation results. Call `export_editable_pptx`
   only when the user explicitly requests export.

Read [references/workflow.md](references/workflow.md) for creation versus editing
decisions, [references/content.md](references/content.md) for slide-content
standards, [references/modes.md](references/modes.md) for narrative movement,
[references/quality.md](references/quality.md) for review layers, and
[references/safety.md](references/safety.md) before any file write
or export. Use [examples/basic-deck.md](examples/basic-deck.md) only as a
structural example; its styling never replaces the active theme Skill.

## Creative HTML and CSS

Use sophisticated slide-local HTML/CSS when it materially improves the visual
argument. Complex composition is explicitly allowed: CSS Grid and Flexbox,
absolute positioning, layered images, gradients, clipping, masks, filters,
blend modes, pseudo-elements, typographic treatments, data-driven sizing, and
responsive `clamp()`/`min()`/`max()` expressions. Combine these tools into
distinct page compositions instead of repeating generic card grids.

Keep creative CSS subordinate to the active theme: reuse its tokens, fonts,
palette, spacing character, and component language. Scope every custom rule to
a unique slide class and place it in `slides.md`; never edit the theme package
during deck authoring. Prefer semantic HTML and editable text over flattening a
whole slide into an image. Read [references/creative-css.md](references/creative-css.md)
before authoring custom HTML or CSS.

## Text fit is a hard gate

Design line breaks before reducing font size. Titles must fit their intended
line count at preview scale: normally one line for short claims and no more than
two lines for long claims. For mixed Chinese/Latin text, model names, numbers,
and units, insert semantic line groups with block spans or an intentional `<br>`;
do not rely on browser-selected wrap points. Keep values and units together,
such as `21000 rpm`, `673 PS`, `33.3 m`, and `2026 Q3`.

Never solve text overflow with `overflow: hidden`, clipping, extreme tracking,
or unreadably small type. First shorten the wording, widen or restructure the
container, choose a controlled break, and only then make a modest size change.
Apply the text-fit checklist in [references/creative-css.md](references/creative-css.md)
to every affected slide before reporting completion.

## Content standards

Write slides a confident analyst would sign, in the user's deck language. Each
title states a claim, ideally with a number and an outcome; each slide carries
one claim and its body proves it. Avoid AI phrasing: filler, slogans, triple
stacking, "not X, but Y" contrast, vague attribution, and hollow optimism. Cite
verified sources on-slide and never invent them. Apply the checklist in
[references/content.md](references/content.md) before reporting the deck ready.
The active theme Skill owns visual rules; this section owns what the words say.

## Image generation workflow

FastPPT invokes the Codex `imagegen` Skill together with this Skill. For a new
photo, illustration, texture, mockup, or other generated bitmap:

1. Use the platform-managed `image_gen` tool. Do not request or configure an API
   token, and do not use the CLI fallback unless the user explicitly asks for it.
2. Generate for the intended slide crop. Prefer `1536x1024` for landscape slide
   figures, `1024x1024` for square cards, and `1024x1536` for portrait panels.
   Keep important content away from edges and avoid generated text unless the
   user explicitly requires it.
3. Inspect the result. If accepted, call `import_generated_image` with the
   returned file under Codex `generated_images` and an exact workspace-relative
   destination such as `assets/generated/slide-04-mechanism.png`. Never reference
   the Codex home path directly from a deck.
4. Add the imported relative path to `slides.md` using Markdown image syntax,
   layout frontmatter, or the active theme's image component. Write meaningful
   alt text. Paths are relative to the slide Markdown file.
5. Run `format_slides`, `validate_slides`, preview inspection, and overflow
   inspection for every affected slide. A generated file without a Markdown
   reference, or a Markdown reference without a validated asset, is incomplete.

Read [references/images.md](references/images.md) for prompt, naming, placement,
replacement, and failure rules.

## Online research and sourced assets

Use the Harness's available web-search or browsing tools whenever the deck needs
current facts, citations, photographs, illustrations, maps, logos, or other
external evidence. Search autonomously; do not ask the user to collect ordinary
public resources. Prefer primary sources and official media libraries. Verify
the exact page supporting each factual claim rather than citing a search-result
snippet.

Before using a remote visual, confirm its source page, creator or publisher, and
reuse terms. Prefer public-domain, Creative Commons, or explicitly reusable
assets. Then call `import_remote_image` with the direct HTTPS image URL and an
exact path under `assets/sources/`; never leave remote URLs in the final deck.
Add a concise on-slide credit and retain the source-page URL in presenter notes.

Read [references/research.md](references/research.md) before online research or
remote download. Read [references/images.md](references/images.md) for choosing
between sourced images, generated images, icons, and editable diagrams.

## Failure rules

- Do not guess theme behavior or substitute a different theme Skill.
- Do not treat discovery, installation, or an allowlist as proof that a Skill ran.
- Do not edit `.fastppt/`, `.git/`, provider configuration, lockfiles, or files
  outside the workspace deck/assets unless the user explicitly requests project
  maintenance rather than deck authoring.
- Do not report success while validation, preview, overflow, or export is failed.
- Preserve user content when resolving layout problems; move optional detail to
  backup slides instead of silently deleting it.
