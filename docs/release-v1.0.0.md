# FastPPT v1.0.0 release verification

This record describes the reproducible release gates. Generated screenshots,
PPTX files, PowerPoint PNGs, runtime databases, and logs remain under the
ignored `output/verification-v100` directory and are not product source.

## Automated gates

- Python compilation and the complete `unittest` suite.
- Structured-plan fail-closed validation and execution of text, layout,
  hierarchy, color, image, and fact-preservation changes.
- Fact extraction, conflict resolution, locking, and page-specific binding.
- Usage reservation, submission, settlement, release, unknown submission, and
  retry transitions.
- Representative-page confirmation before editable reconstruction.
- SVG QA report schema, per-file hashes, aggregate fingerprint, PPTX static QA,
  and full-slide-raster rejection.
- Local SQLite/filesystem recovery and server PostgreSQL/S3 multi-instance
  integration through GitHub Actions.
- Repository hygiene, portable paths, JavaScript syntax, YAML parsing, and
  pinned kernel inventory verification.

## Browser gate

A clean browser session covers project creation, page entry, generation-plan
confirmation, representative-page review, final reconstruction, edit version
creation, version comparison, export completion before download, task/export/
usage visibility, refresh recovery, and the 390 by 844 details drawer. The
clean verification session must report zero console errors and warnings.

## PowerPoint gate

The exported PPTX is opened and rendered by installed Microsoft PowerPoint
16.0 at 1600 by 900. Verification requires matching slide count, nonblank PNG
pixels, stable PPTX and PNG SHA-256 hashes, readable Chinese text, and visual
inspection for clipping, overlap, wrapping, font, and layout defects.

Server instances without a connected Windows Render Worker remain explicitly
`degraded`; they never label SVG or browser output as authoritative evidence.

## Release sequence

1. Run all local automated, browser, kernel, and PowerPoint gates.
2. Commit the complete repository migration and FastPPT implementation on
   `main`.
3. Push `main` to `origin` and require both CI jobs to pass.
4. Create and push the annotated `v1.0.0` tag at that exact commit.

The `upstream` remote is fetch-only and must never receive FastPPT commits or
tags.
