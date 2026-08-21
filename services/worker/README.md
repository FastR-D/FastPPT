# Worker Service

`fastppt-worker` claims persisted jobs with a lease, heartbeats its health,
and executes document parsing, confirmed operations, and version-locked PPTX
exports. Idempotency keys prevent duplicate submission; bounded attempts and
expired leases support recovery after process failure. Render jobs are left to
the independent Windows worker.
