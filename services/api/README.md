# API Service

The dependency-light `/api/v1` service exposes projects, immutable source
snapshots, sessions, confirmed plans, page versions, scoped operations,
rollback, exports, authenticated artifact downloads, and replayable events.
Local trusted identity is limited to loopback mode. Server mode uses HttpOnly
SameSite session cookies, strict origin checks, and project ownership checks.
