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

## GPT-image relay evidence

After configuring a real GPT-image-2 relay, collect the two required redacted
ImageAttempt records with the repository virtual environment. For a local
one-off check, put only the image settings and release-proof key below in the
ignored repository-root file `.env.local` and pass it explicitly with
`--env-file`; the tool never loads that file implicitly:

```text
FASTPPT_IMAGE_ENDPOINT_MODE=relay
FASTPPT_IMAGE_BASE_URL=https://relay.example.com
FASTPPT_IMAGE_API_KEY=<temporary-secret>
FASTPPT_IMAGE_PROTOCOL=openai_images
FASTPPT_IMAGE_MODEL=gpt-image-2
FASTPPT_RELEASE_EVIDENCE_HMAC_KEY=<separate-high-entropy-release-secret>
```

The command uses synthetic content in a temporary runtime and writes only the
evidence contract to `output/provider-evidence`; it never reads a user
document or prints the API key:

```powershell
$env:FASTPPT_IMAGE_ENDPOINT_MODE = "relay"
$env:FASTPPT_IMAGE_BASE_URL = "https://relay.example.com"
..\.venv\Scripts\python.exe tools\collect_image_provider_evidence.py generation --env-file .env.local
..\.venv\Scripts\python.exe tools\collect_image_provider_evidence.py edit --env-file .env.local
```

The tool fails without a relay endpoint, API key, or `gpt-image-2`, and it
does not create an evidence file when the provider request or evidence
contract fails. Each evidence record additionally carries an HMAC runtime
proof. Store the same release-proof key in CI as a secret and provide a
separate ignored file containing only that key when running the gate:

```powershell
..\.venv\Scripts\python.exe tools\check_release_gates.py --env-file .env.release-proof.local
```

## Codex relay evidence

Use a separate ignored file containing only the Codex relay settings and the
same release-proof key. The collector forces the Codex backend and relay mode,
executes a strict `source_analyst` run over synthetic text in a temporary
runtime, and writes nothing when the Provider call, contract validation, or
proof validation fails. It does not load `.env.local` implicitly and never
uses project documents:

```text
FASTPPT_MODEL=<supported-codex-model>
FASTPPT_MODEL_BASE_URL=https://relay.example.com/v1
FASTPPT_MODEL_API_KEY=<temporary-secret>
FASTPPT_MODEL_REASONING_EFFORT=medium
FASTPPT_RELEASE_EVIDENCE_HMAC_KEY=<same-high-entropy-release-secret>
```

```powershell
..\.venv\Scripts\python.exe tools\collect_agent_provider_evidence.py --env-file .env.codex-relay-evidence.local
```
