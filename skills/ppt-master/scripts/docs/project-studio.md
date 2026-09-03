# Project Studio

Project Studio is a loopback-only control surface for an existing PPT Master
project. It stores auditable JSONL state under `interaction/`; SVG files remain
the authoring authority.

## Start

```bash
pnpm studio projects/<project> 6070
```

Install the TypeScript service and Agent SDK dependencies with `pnpm`:

```bash
pnpm install
pnpm studio projects/<project> 6070
```

The TypeScript/Fastify service exposes project and slide queries, JSONL
conversations, structured modification job intake, and replayable SSE events.
`GET /api/events` stays open as an event stream; browsers reconnect with the
standard `Last-Event-ID` sequence. `GET /api/events?since=<sequence>&stream=0`
returns a bounded JSON replay for diagnostics.

`GET /healthz` is a lightweight liveness endpoint.

Additional control endpoints include `POST /api/jobs/impact` for approval
planning, `POST /api/jobs/{job_id}/approve` and `/cancel` for guarded actions,
`POST /api/jobs/{job_id}/run-agent` for the configured Agent SDK, and
`POST /api/jobs/{job_id}/poll` for status recovery,
`POST /api/validate` for the authoritative SVG checker, and
`POST /api/export/result` for revision-checked exporter receipts.
Historical page snapshots are listed at
`GET /api/slides/{slide_id}/revisions` and restored explicitly through its
`/restore` action.

## Agent SDKs

The TypeScript/Fastify service is the primary runtime. An explicitly requested
`claude` or `codex` provider can be run through
`POST /api/jobs/{job_id}/run-agent`. The adapters use the official SDK default
credential discovery; credentials are never copied into the project. Agents
receive only the job contract, accepted project memories, and the isolated
staging project.

Hosts without a direct SDK adapter use the file fallback. Calling
`POST /api/jobs/{job_id}/file-handoff` creates a bounded
`inbox/request.json`, an isolated staging root, and the exact
`outbox/response.json` path. The external Host edits only staging and writes a
completed or failed response. `POST /api/jobs/{job_id}/file-response` consumes
it through the same scope guard, checker, transaction, exporter, and memory
pipeline as direct SDK jobs.

Modification jobs must include `scope`, `targets`, `baseRevisions`, `intent`,
`mode`, and `exportAfter`. Job intake does not execute an Agent or bypass route
confirmation gates. Default Generate jobs created before Step 7 completes use
`waiting_workflow`; the owning route calls `POST /api/workflow/edits-ready`
after its successful export to release them.

## Confirm UI Proxy

Studio reads the current project's `.confirm_ui.lock`, accepts only an integer
loopback port, and verifies `/api/health` reports the same canonical project
root and the `confirm_ui` service identity. It then exposes only:

- `GET /api/workflow/confirm/session`
- `GET /api/workflow/confirm/recommendations`
- `POST /api/workflow/confirm`

The final endpoint forwards the user's payload to the Confirm UI server. That
server remains the sole validator and writer of user confirmation receipts.
Studio does not proxy shutdown, files, arbitrary paths, hosts, or ports.

## Recovery and Memory

Every commit journal records original page snapshots and applied-page progress.
Startup rolls back an interrupted multi-page commit as one transaction. Failed
Agent or checker work remains under the job's `staging/` directory and can be
retried or canceled.

Memory candidates support editing, acceptance, rejection, and withdrawal.
`GET /api/memory/search` returns only the latest accepted decision in the
requested project or page scope. Rejected and withdrawn entries are excluded
from retrieval and Agent context.

Machine-readable contracts live in `scripts/studio/schemas/`; the Fastify
runtime validates the same required fields and enum values with Zod.
