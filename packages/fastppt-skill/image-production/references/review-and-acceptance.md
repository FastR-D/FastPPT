# Review and acceptance

Accept a candidate only when it supports the page claim, matches the active
theme, preserves the required crop, leaves the declared text-safe region clear,
and contains no unintended text, logos, artifacts, or misleading factual detail.

Use a stable descriptive destination such as
`assets/generated/slide-04-mechanism-v1.png`. Keep the source asset and each
accepted variation as separate files. Register the imported candidate with its
`runId`, then call `decide_image_candidate` before placing it in `slides.md`.
After placement, verify that the exact
relative path appears in `list_assets`, `validate_slides`, and the rendered
preview.

For remotely sourced images, use `import_remote_image` with the source's final
HTTPS URL and its license or rights statement. Preserve required attribution as
editable Slidev text near the image or in the slide notes; the asset record is
the provenance ledger, not a substitute for visible attribution.
