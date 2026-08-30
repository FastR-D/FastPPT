# FastPPT v1.2.0

FastPPT is a portable AI presentation production and editing system. It runs
locally or as a small multi-user server deployment, keeps page facts and
versions auditable, and exports editable PPTX files through the vendored
`ppt-master` conversion kernel.

FastPPT is an application, not a Codex or Claude Skill. Claude Code and Codex
SDK are interchangeable Agent backends behind the FastPPT Harness; model names,
official endpoints, and compatible HTTPS relays are selected by server-side
configuration.

## v1.2.0 highlights

- Auditable `PromptEnvelope` and role-scoped context assembly with independent
  input, prompt, and output digests, trust labels, redaction, long-context
  reports, inspection, dry-run replay, normalized provider evidence, and
  30-day retention cleanup.
- Exact, ranged, or AI-suggested page counts plus language, audience, purpose,
  optional logic diagnosis, and deterministic Markdown, TXT, and DOCX content
  plan exports.
- Natural-language edit planning with mandatory confirmation when content or
  design changes invalidate downstream work.
- Private StylePack and TemplatePack Bundle validation, atomic import, explicit
  selection, immutable design snapshots, and a strict default `none` mode.
- Versioned forward migration and expanded repository hygiene checks for
  credentials, private packs, Prompt evidence, and raw provider responses.

See [`docs/FastPPT-v1.2.0-spec.md`](docs/FastPPT-v1.2.0-spec.md) for the product
contracts and release acceptance matrix. Real provider, PostgreSQL/S3, and
PowerPoint render evidence remains an environment-dependent release gate and
must not be replaced by deterministic test fixtures.

## Local quick start

Requirements: Python 3.11+, Node.js 18+, and PowerShell on Windows.

```powershell
.\deploy\local\install.ps1
.\deploy\local\start.ps1
```

Open <http://127.0.0.1:43110>. The local profile uses SQLite, private file
artifacts, a persistent local queue, and trusted identity limited to loopback.

```powershell
.\deploy\local\status.ps1
.\deploy\local\stop.ps1
```

Set `FASTPPT_AGENT_BACKEND=codex` or `claude_code`, then configure
`FASTPPT_MODEL` and `FASTPPT_MODEL_API_KEY` to use a real Agent. The default
deterministic backend exists for local smoke tests and is rejected in server
mode.

## Server deployment

The server profile uses one product code path with PostgreSQL, MinIO or another
S3-compatible store, session authentication, a persistent Worker, and Caddy
TLS. See [`deploy/server/README.md`](deploy/server/README.md). A separate Windows
PowerPoint Render Worker provides authoritative PNG validation when available;
otherwise FastPPT reports an explicit degraded state.

## Repository layout

```text
apps/                 shared Web workspace and runtime assembly
packages/             domain, orchestration, preview, Agent, and kernel adapters
services/             API, persistent Worker, and PowerPoint Render Worker
deploy/               local and server deployment profiles
kernel/ppt-master/    isolated upstream kernel, source manifest, and sync tool
tests/                 unit, integration, security, E2E, and Golden Deck gates
```

Product and service code may call the kernel only through
`packages/ppt-master-adapter`. Preview SVG is not authoritative PowerPoint
evidence, and unregistered full-slide raster output is rejected.

## Development

All development occurs on `main` in <https://github.com/FastR-D/FastPPT>.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
.\.venv\Scripts\python.exe tools\check_repo_hygiene.py
.\.venv\Scripts\python.exe kernel\ppt-master\sync.py --check
```

Kernel updates are applied only from an exact upstream commit and require the
adapter, integration, Golden Deck, and hygiene checks before commit. The
upstream MIT license and attribution are preserved in `kernel/ppt-master` and
the repository root.

The release workflow also runs a Linux integration job with real PostgreSQL
and MinIO services. It starts two independent Runtime instances and verifies
cross-instance metadata, S3 artifacts, expired job-lease recovery, asynchronous
document parsing, representative-page confirmation, export, and strict SVG QA.
The v1.0.0 release document remains the historical baseline. v1.1.0 added the
Agent/Image contracts, React workspace, and cross-platform deployment scripts;
v1.2.0 adds governed context assembly, inspectable Prompt evidence, content-plan
controls, confirmed edit planning, and private design packs.
