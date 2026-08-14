# Generated image workflow

## Asset contract

- Use `import_remote_image` for licensed external raster visuals, `image_gen`
  for generated raster visuals, and FastPPT `search_icons` for
  deterministic icons. Prefer native SVG, HTML, Mermaid, charts, or theme
  components for diagrams that must remain exact and editable.
- Save sourced images under `assets/sources/` and accepted generated images
  under `assets/generated/` unless the user names
  another workspace-relative directory.
- Use stable descriptive filenames such as `slide-04-evidence-flow.png`. If the
  destination exists, choose a versioned sibling; do not overwrite it silently.
- Import through `import_generated_image`. It accepts only files produced under
  Codex's managed `generated_images` directory and refuses paths outside the
  workspace or existing destinations.

## Prompt contract

Include the slide's communication goal, subject, visual style, composition,
aspect ratio, palette relationship, negative constraints, and whether empty
space is needed for overlaid slide text. Avoid asking the image model to render
labels that should instead remain editable Markdown text.

## Markdown placement

Use a path relative to the deck file:

```markdown
![Evidence channels remain isolated before posterior fusion](assets/generated/slide-04-evidence-flow.png)
```

For layout or component props, use the same relative path and the active theme's
documented syntax. Do not use absolute filesystem paths, `file://` URLs, Codex
home paths, data URLs, or remote URLs for a final generated project asset.

For native HTML, prefix the same relative path with `./`:

```html
<img src="./assets/generated/slide-04-evidence-flow.png" alt="Evidence flow" />
```

Do not write `<img src="assets/...">`; Vue/Vite interprets it as a bare package
import instead of a file relative to `slides.md`.

## Completion checks

1. `list_assets` includes the imported destination.
2. `slides.md` references that exact relative path.
3. `validate_slides` reports no missing asset.
4. Preview shows the intended crop without distortion or overflow.
5. Editable PPTX export is checked only when the user requested export.

If `image_gen` is unavailable, report that platform-managed generation is
unavailable. Do not silently switch to a token-based API or create a placeholder
image.
