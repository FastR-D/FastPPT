# Project Studio Stage

Start the local Project Studio after a project has an authoring workspace and
the selected route permits interactive review. The service is a presentation
surface for existing route contracts: it does not choose a top-level route,
skip confirmation, checker, or exporter gates.

Messages create auditable conversations and structured jobs. Every job carries
page targets and base revisions. The owning route validates those revisions,
runs its checker in staging, and commits atomically before export. A stale
revision is a conflict requiring user re-selection. Create Template remains a
progress/review surface until a later stage explicitly enables page editing.

For Default Generate, initialize Studio state with editing disabled while Step
6 or Step 7 is active. Studio may collect requests, but it keeps them in the
workflow wait state and must not run an Agent. After the route's Step 7 export
succeeds, call Studio's edits-ready handoff once; queued jobs then return to
their normal approval or execution state. Quick and post-export projects may
start with editing enabled. Edit Native PPTX keeps `page_plan.json` as the
page-mode authority.

When the Confirm UI is live, Studio may display and submit its active stage
through the loopback proxy documented in `scripts/docs/project-studio.md`.
The proxy delegates validation and receipt writing to the Confirm UI server;
Studio never authors `result.json`, `template_selection.json`, or
`template_handoff.json`.
