# Server Deployment

Copy `.env.server.example` to an untracked environment file and replace every
placeholder. Start with `docker compose --env-file <path> -f compose.yml up -d
--build`. The stack uses Caddy/TLS, session authentication, PostgreSQL, MinIO,
and a separate persistent Worker. It fails startup when production database,
object storage, authentication, CORS, or Agent/model settings are missing.

PowerPoint rendering is an independent Windows service. Keep
`FASTPPT_RENDER_BACKEND=unavailable` until that worker is installed and its
heartbeat is visible; degraded SVG preview and PPTX download remain honest in
the meantime.

## Integration gate

The `server-integration` GitHub Actions job provisions PostgreSQL 17 and MinIO,
then starts two Runtime instances against the same services. It exercises
cross-instance metadata and artifacts, expired Worker lease recovery,
asynchronous parsing, representative-page confirmation, asynchronous export,
and strict SVG QA. Run the same test against prepared services by setting
`FASTPPT_SERVER_INTEGRATION=1` and the `FASTPPT_TEST_DATABASE_URL` and
`FASTPPT_TEST_S3_*` variables before invoking:

```text
python -m unittest tests.integration.test_server_backends -v
```

The test is explicitly skipped when those integration services are not
enabled; a skip is not server-deployment evidence.
