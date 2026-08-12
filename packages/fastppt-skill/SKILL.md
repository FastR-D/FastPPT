---
name: fastppt
description: Create, edit, validate, preview, and export Slidev presentation decks inside a FastPPT workspace, including generating raster visuals with Codex imagegen, importing them into workspace assets, and referencing them from slides.md. Use for any FastPPT deck task involving slides.md, Markdown structure, workspace assets, generated images, preview checks, overflow checks, or editable PPTX export; always pair it with the theme-specific Skill resolved by FastPPT.
metadata:
  id: fastppt
  version: 0.2.0
---

# FastPPT deck workflow

Use the FastPPT MCP tools for workspace access. Never bypass them with arbitrary
paths, and never infer a theme from prose. FastPPT supplies an immutable theme
snapshot and explicitly invokes the one matching theme Skill for each run.

## Required workflow

1. Call `get_workspace`, then `get_theme_manifest` and `get_theme_skill` for the
   supplied theme ID. Stop if the theme or its managed Skill is unavailable.
2. Read `slides.md` with `read_slides` and inspect existing assets with
   `list_assets` before editing.
3. Follow the simultaneously invoked theme Skill for visual language, layouts,
   components, frontmatter, density, and theme-specific validation.
4. Make the smallest coherent deck change with `write_slides`. Keep image paths
   relative and store images as files; never place large base64 data in Markdown.
   When the deck needs a new raster visual, follow the image workflow below.
5. Run `format_slides`, then `validate_slides`. Fix every syntax, theme, missing
   asset, and unsupported-layout error.
   Slidev frontmatter blocks must have no blank lines immediately inside the
   `---` delimiters; keep metadata directly between the opening and closing
   delimiter.
6. Check `get_preview_status`. When preview is ready, use `inspect_slide` and
   `inspect_overflow` for affected pages and revise visible clipping or crowding.
7. Summarize changed files and validation results. Call `export_editable_pptx`
   only when the user explicitly requests export.

Read [references/workflow.md](references/workflow.md) for creation versus editing
decisions and [references/safety.md](references/safety.md) before any file write or
export. Use [examples/basic-deck.md](examples/basic-deck.md) only as a structural
example; its styling never replaces the active theme Skill.

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

## Failure rules

- Do not guess theme behavior or substitute a different theme Skill.
- Do not treat discovery, installation, or an allowlist as proof that a Skill ran.
- Do not edit `.fastppt/`, `.git/`, provider configuration, lockfiles, or files
  outside the workspace deck/assets unless the user explicitly requests project
  maintenance rather than deck authoring.
- Do not report success while validation, preview, overflow, or export is failed.
- Preserve user content when resolving layout problems; move optional detail to
  backup slides instead of silently deleting it.
