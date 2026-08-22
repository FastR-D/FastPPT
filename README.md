# FastPPT v1.1.0

FastPPT is a portable AI presentation production and editing system. It runs
locally or as a small multi-user server deployment, keeps page facts and
versions auditable, and exports editable PPTX files through the vendored
`ppt-master` conversion kernel.

FastPPT is an application, not a Codex or Claude Skill. Claude Code and Codex
SDK are interchangeable Agent backends behind the FastPPT Harness; model names,
official endpoints, and compatible HTTPS relays are selected by server-side
configuration.

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
The v1.0.0 release document remains the historical baseline; v1.1.0 adds the
Agent/Image contracts, React workspace, and cross-platform deployment scripts
described in the product specification.
