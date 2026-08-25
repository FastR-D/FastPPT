# HTTP and WebSocket API

The frontend (both the Vercel deployment and the local Vite dev server) talks to the Gateway at `http://127.0.0.1:4317` / `ws://127.0.0.1:4317`. The API has no FastPPT session-token exchange. Errors use `{ error: { code, message, details?, retryable, requestId } }` and never expose a full stack by default.

## Health and workspace

| Method | Path                                    | Purpose                                                                      |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/health`                               | Process liveness                                                             |
| GET    | `/ready`                                | SQLite, workspace, Harness, Slidev, theme, Skill/MCP and Slidewave readiness |
| GET    | `/api/v1/application-state`             | Recent Harness/session/theme and currently actionable pending approvals      |
| GET    | `/api/v1/workspace`                     | Fixed canonical workspace identity                                           |
| GET    | `/api/v1/workspace/files`               | Contained file tree                                                          |
| GET    | `/api/v1/workspace/files/content?path=` | Text file and revision                                                       |
| PUT    | `/api/v1/workspace/files/content`       | Atomic revision-aware write                                                  |
| POST   | `/api/v1/workspace/assets/images`       | Validate and atomically store a workspace image attachment                   |
| GET    | `/api/v1/icons`                         | Installed icon collections (prefix, name, total)                             |
| GET    | `/api/v1/icons/search?q=&limit=`        | Search icons across the installed collections, returning inline SVG          |

`/ready` probes SQLite, workspace read/write access, both Harness adapters, the installed Slidev CLI, registered themes, managed Skills, MCP configuration and the Slidewave server runtime independently. It returns HTTP 200 with top-level status `ok` only when every component is healthy. A missing or failed Harness produces `degraded` with that component marked `unavailable`; other local editing and preview capabilities remain usable.

Image upload input is `{ name, mediaType, base64 }`. Supported types are PNG, JPEG, GIF and WebP up to 10 MiB. The response contains the managed `assets/...` relative path used in message attachments; arbitrary client filesystem paths are never accepted by a Harness.

## Harnesses, sessions and approvals

| Method | Path                                               |
| ------ | -------------------------------------------------- |
| GET    | `/api/v1/harnesses`                                |
| GET    | `/api/v1/harnesses/:harness/status`                |
| GET    | `/api/v1/sessions?harness=claude&cursor=&limit=`   |
| GET    | `/api/v1/sessions/:harness/:sessionId`             |
| GET    | `/api/v1/sessions/:harness/:sessionId/runs/latest` |
| PUT    | `/api/v1/sessions/:harness/:sessionId/alias`       |
| POST   | `/api/v1/sessions`                                 |
| POST   | `/api/v1/sessions/:harness/:sessionId/resume`      |
| POST   | `/api/v1/sessions/:harness/:sessionId/fork`        |
| POST   | `/api/v1/sessions/:harness/:sessionId/messages`    |
| POST   | `/api/v1/sessions/:harness/:sessionId/cancel`      |
| POST   | `/api/v1/approvals/:approvalId/resolve`            |
| GET    | `/api/v1/runs/:runId/audit`                        |

Message input is `{ content, attachments, themeId }`. `themeId` is mandatory and is the only theme/Skill selector accepted from the client.

Session discovery is provider-backed and cursor-paginated. `harness` is `claude` or `codex`, `cursor` is the opaque `nextCursor` returned by the previous page, and `limit` is 1–100. Gateway overlays locally persisted user aliases on provider summaries and details without copying provider history into SQLite.

Alias input is `{ alias }` with 1–120 characters. It changes only FastPPT's local display name and never mutates provider-owned history.

The latest-run endpoint returns the persisted run audit for the session, or HTTP 204 when no run has been recorded. The record includes `themeId`, `themeSkillId`, `themeSkillVersion`, resolution status, invocation status, documented Harness mechanism, and observation evidence. A missing stable provider observation is represented as `unknown`, never inferred as completion.

The Gateway limits active runs independently for Claude and Codex. The fixed default is one active run per Harness. A request beyond the limit returns HTTP 429 with `HARNESS_RUN_LIMIT_REACHED`, `retryable: true`, and `{ harness, limit }` details. The slot remains owned until the provider event stream terminates, including cancellation or failure.

## Themes, managed Skills and MCP

| Method | Path                                            |
| ------ | ----------------------------------------------- |
| GET    | `/api/v1/themes`                                |
| GET    | `/api/v1/themes/:themeId`                       |
| POST   | `/api/v1/themes/rescan`                         |
| GET    | `/api/v1/themes/:themeId/skill-status?harness=` |
| GET    | `/api/v1/managed/status`                        |
| POST   | `/api/v1/imports/pptx-theme`                    |
| GET    | `/api/v1/imports/pptx-theme/:themeId`           |

PPTX theme import runs as a staged pipeline: deterministic extraction, harness
layout/component design, managed Skill synchronization, then structural theme
validation. The status endpoint returns `stage` (`extracting`, `designing`,
`syncing`, `validating`, `ready`, or `failed`), materialized layouts/components,
a user-facing message, and an optional error. Consumers must wait for `ready`;
`designing: false` alone does not indicate success.

## Deck and preview

| Method | Path                                          |
| ------ | --------------------------------------------- |
| GET    | `/api/v1/decks`                               |
| POST   | `/api/v1/decks`                               |
| GET    | `/api/v1/decks/:deckId`                       |
| PUT    | `/api/v1/decks/:deckId/markdown`              |
| POST   | `/api/v1/decks/:deckId/format`                |
| POST   | `/api/v1/decks/:deckId/validate`              |
| POST   | `/api/v1/decks/:deckId/preview/start`         |
| POST   | `/api/v1/decks/:deckId/preview/restart`       |
| POST   | `/api/v1/decks/:deckId/preview/stop`          |
| GET    | `/api/v1/decks/:deckId/preview/status`        |
| GET    | `/api/v1/decks/:deckId/image-runs`            |
| POST   | `/api/v1/decks/:deckId/image-runs`            |
| GET    | `/api/v1/decks/:deckId/image-assets`          |
| POST   | `/api/v1/decks/:deckId/image-assets`          |
| GET    | `/api/v1/image-runs/:imageRunId`              |
| POST   | `/api/v1/image-assets/:imageAssetId/decision` |

Create input is `{ name, themeId }`. Markdown update accepts `{ content, expectedRevision? }`. Format accepts `{ expectedRevision?, dryRun? }` and returns `{ path, content, revision, changed, dryRun, written }`; dry-run never writes the deck. The shared formatter parses Slidev Markdown both before and after formatting, and writes only after both validations succeed. Invalid Slidev/YAML syntax returns `INVALID_REQUEST` with one-based `{ line, column }` details when available.

Image production is a candidate workflow. Create a run with `{ slide, purpose,
prompt, inputAssetIds? }`, then register a validated workspace image with
`{ path, runId?, source, sourceUrl?, license?, attribution? }`. `source` is
`generated`, `manual`, or `remote`; remote assets require their final HTTPS
source URL and rights/license information, with an optional attribution string.
Candidates are unaccepted until `POST /api/v1/image-assets/:imageAssetId/decision`
receives `{ accepted: true }`; only then does the associated run become
`accepted`. A rejected candidate is terminal, but its run remains open for a
new candidate. Image paths are workspace-relative, signature-checked PNG, JPEG,
GIF, or WebP files, and every record binds the deck revision and a SHA-256 hash.
Deck validation rejects remote/data image URLs, any registered image candidate
that is not accepted, and accepted image files whose content no longer matches
their registered SHA-256.

The FastPPT MCP also exposes `inspect_svg_asset` for local SVG delivery. It
reports `embed-vector`, `rebuild-natively`, or `blocked`: portable SVG remains
a vector image in PPTX, while decision-bearing labels, data, tables, charts,
and formulas must be rebuilt with native Slidev content for editability.
`validate_slides` rejects referenced SVG files containing active content or
remote/absolute dependencies.

## Editable PPTX exports

| Method | Path                                 |
| ------ | ------------------------------------ |
| POST   | `/api/v1/decks/:deckId/exports`      |
| POST   | `/api/v1/exports/:exportId/snapshot` |
| GET    | `/api/v1/exports/:exportId`          |
| POST   | `/api/v1/exports/:exportId/cancel`   |
| GET    | `/api/v1/exports/:exportId/download` |

Create input is `{ "format": "editable-pptx", "outputName": "presentation.pptx" }`. The browser's hidden Slidev `/print` iframe submits a fully validated Slidewave snapshot to the snapshot endpoint; external clients should not synthesize it. Status is `queued`, `running`, `completed`, `failed`, or `cancelled`. Jobs include phase/progress, warnings, optional element count, bounded error logs and a download URL on success.

Resource lookup failures use stable public codes such as `SESSION_NOT_FOUND`, `APPROVAL_NOT_FOUND`, `RUN_NOT_FOUND`, `INSPECTION_NOT_FOUND`, and `EXPORT_NOT_FOUND` with HTTP 404. Submitting a result to a non-queued inspection or accessing an unfinished export uses `INSPECTION_NOT_READY` or `EXPORT_NOT_READY` with HTTP 409.

Harness adapter errors are normalized at the Gateway boundary. An unavailable process returns `HARNESS_UNAVAILABLE` with HTTP 503, a malformed or incompatible protocol response returns `HARNESS_PROTOCOL_ERROR` with HTTP 502, and an already active session returns `SESSION_BUSY` with HTTP 409. Theme Skill failures use `THEME_SKILL_NOT_FOUND`, `THEME_SKILL_MAPPING_INVALID`, `THEME_SKILL_VERSION_MISMATCH`, `THEME_SKILL_INSTALL_CONFLICT`, or `THEME_SKILL_INVOCATION_FAILED`. Slidev startup and early process failures use `SLIDEV_START_FAILED` or `SLIDEV_BUILD_FAILED`, both with HTTP 502.

When useful for local diagnosis, a normalized response may include the adapter or subsystem code in `details.internalCode` and bounded structured context in `details.cause`. Responses never include a stack trace, raw Slidev output, or the complete process state. Unexpected production errors return only `INTERNAL_ERROR` and a request ID; full diagnostics stay in local logs.

An export that fails or is cancelled after it has been accepted remains a successful HTTP lookup whose job has terminal status `failed` or `cancelled`. Its bounded job error uses `EXPORT_FAILED` or `EXPORT_CANCELLED`; it is not converted into an unrelated synchronous HTTP error.

## WebSocket

Connect to `ws://127.0.0.1:4317/api/v1/events` and send:

```json
{
  "type": "subscribe",
  "topics": [
    "workspace",
    "sessions",
    "preview",
    "deck:<deckId>",
    "run:<runId>",
    "export:<exportId>"
  ]
}
```

Each event contains `id`, monotonic process-local `sequence`, ISO `timestamp`, `topic`, `type`, and validated `data`. `sessions` and `preview` are aggregate topics; every run event is also published to `run:<runId>`, while preview and export updates are also published to their `deck:<deckId>`. Sending a new subscription replaces the current topic set.

After reconnecting, the SPA restores its subscription and treats the acknowledgement sequence as a synchronization boundary. It then reloads authoritative workspace, session, preview, approval, run-audit, and pending browser-delegation state over HTTP. This covers events missed while disconnected and Gateway restarts where the process-local sequence returns to zero; the protocol does not claim durable WebSocket replay.
