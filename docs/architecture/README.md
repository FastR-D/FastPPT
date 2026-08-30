# FastPPT Architecture

FastPPT uses one application service and domain contract in both deployment
modes:

```text
Web -> /api/v1 -> ApplicationService -> Core / Orchestrator
                                      -> Agent Harness (Claude Code | Codex)
                                      -> persistent queue -> Worker
                                      -> ppt-master Adapter -> isolated kernel
Metadata Store (SQLite | PostgreSQL)
Artifact Store (filesystem | S3)
PowerPoint Render Worker (Windows, optional but authoritative)
```

Runtime configuration selects concrete stores, Agent, model, official or relay
endpoint, and render capability at startup. Server mode rejects local or test
fallbacks. All artifacts use opaque logical keys and SHA-256; browsers receive
only authenticated artifact endpoints.

Preview truth has three states: quick SVG, approved visual preview, and
PowerPoint-authoritative PNG. Only the last may be called authoritative. Every
export locks ordered page/version pairs and the Render Worker consumes that
exact lock.

The upstream kernel is an unmodified snapshot in `kernel/ppt-master/upstream`.
Only `fastppt_ppt_master` knows its scripts, temporary project contract, or CLI
reports. `UPSTREAM.json` and `sync.py` provide reproducible updates.
