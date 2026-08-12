# FastPPT

FastPPT is a local-first presentation Agent workspace. It unifies Claude Code and OpenAI Codex sessions behind a localhost Gateway, lets agents and users edit Slidev decks in one workspace, previews changes through Slidev HMR, and exports editable PPTX files through the existing Slidewave fork.

## Architecture

```text
Vue 3 SPA (Vercel)
        │ HTTP + WebSocket over local loopback
        ▼
Fastify Gateway (http://127.0.0.1:4317)
   ├── safe workspace files + SQLite audit state
   ├── Claude Agent SDK adapter
   ├── supervised Codex app-server adapter
   ├── validated theme registry + managed Skills/MCP
   ├── supervised Slidev preview processes
   └── serial export queue → Slidewave server runtime → editable PPTX
```

Provider-specific protocols stay in their Harness packages. Browser DTOs and events come from `@fastppt/protocol`; theme selection is resolved and snapshotted by the Gateway before a run enters either provider.

## Requirements

- Node.js 22 or newer
- pnpm 10.33.0
- A modern browser for the FastPPT UI and iframe capture
- Claude Code and Codex only when their respective real Harness is needed; tests use deterministic fakes and require no API keys

## Install and run

For normal local use, install the backend CLI once and run it inside the deck
workspace. This starts the Gateway and all supervised backend capabilities, but
does not start a frontend development server:

```bash
pnpm add --global @fastppt/cli
cd /path/to/deck-workspace
fastppt

# Or keep the CLI local to a project:
pnpm add --save-dev @fastppt/cli
pnpm exec fastppt
```

Then open `https://fastppt.vercel.app`. Use `fastppt --dir /path/to/deck` when
starting outside the target workspace. The `--workspace` option remains an
alias for `--dir`.

Repository development remains a separate command. It starts both the Gateway
and the Vite frontend with source watching:

```bash
pnpm install
pnpm dev --dir ./examples/demo-deck   # --workspace works as an alias
```

Open `https://fastppt.vercel.app` (or `http://127.0.0.1:4318` for the local dev server). The Gateway runs on the loopback at `http://127.0.0.1:4317` with plain HTTP; browsers allow the secure deployed page to reach loopback addresses, so no hosts entry, certificate, or `sudo` is required. FastPPT runtime configuration does not require an `.env` file or session token. The deployed and development SPAs use fixed API locations; there is no endpoint environment variable.

The frontend deploys from `vercel.json`. Link the Vercel project whose production domain is `fastppt.vercel.app`, then configure the repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; pushes to `main` run the production deployment workflow.

Publishing a GitHub Release, or manually running the `Publish npm packages` workflow from `main`, verifies, packs, and publishes `@fastppt/slidewave` followed by `@fastppt/cli`. The workflow uses npm trusted publishing with provenance and skips package versions that already exist. Configure both packages on npm with this repository and `.github/workflows/publish-npm.yml` as their trusted publisher; no long-lived npm token is required.

For the initial local npm publication, sign in with `npm login`, run `pnpm npm:publish:dry-run`, then run `pnpm npm:publish`. The root command publishes Slidewave first and the CLI second with public access and the `latest` distribution tag.

For a local production deployment, run `pnpm dlx vercel@latest build --prod` followed by `pnpm dlx vercel@latest deploy --prebuilt --prod --archive=tgz`. Archiving avoids Vercel's per-file upload request limit for this monorepo.

The desktop workspace uses three resizable columns and persists their widths locally. Narrow screens expose explicit workspace, editor and preview panel switches rather than dropping the preview. Chat image attachments are validated, atomically copied to the workspace `assets/` directory, and passed to Claude/Codex through their native image input formats.

The Gateway binds to loopback and accepts browser requests only from the fixed production and local development origins. Its health endpoints are:

- `GET http://127.0.0.1:4317/health`
- `GET http://127.0.0.1:4317/ready`

`/health` reports process liveness. `/ready` actively probes SQLite, a workspace write/read/delete cycle, Claude, Codex, the Slidev CLI, freshly parsed themes, installed Skill files, MCP configuration files and an in-memory Slidewave PPTX conversion. A single unavailable Harness keeps the endpoint responsive with `status: "degraded"` and component-level diagnostics.

Installed icon collections (`mdi`, `ant-design`) are searchable through `GET /api/v1/icons/search` and the `search_icons` MCP tool, returning canonical identifiers plus inline SVG so Harnesses can pick renderable icons for slides.

## Repository structure

```text
apps/gateway                 Fastify orchestration daemon
apps/cli                     Installable backend-only `fastppt` command
apps/web                     Vue/Pinia/CodeMirror SPA
packages/config              Startup and workspace configuration
packages/database            SQLite/Drizzle migrations and audit state
packages/fastppt-mcp         Shared official-SDK MCP server and stdio CLI
packages/fastppt-skill       Common Skill, installer, provider config merge
packages/harness-core        Provider-neutral Harness contract
packages/harness-claude      Claude Agent SDK adapter
packages/harness-codex       Codex app-server JSONL/RPC adapter
packages/markdown            Slidev-aware Prettier integration
packages/protocol            Browser-safe Zod DTOs and events
packages/slidev-host         Supervised local Slidev processes
packages/slidewave           Native core, browser capture and server runtimes
packages/theme-registry      Validated immutable theme registry
packages/workspace           Contained file I/O and watcher
themes/slidev-theme-*           Built-in forks, manifests, rules and theme Skills
tests/e2e                    Playwright browser workflow with fake Harnesses
examples/demo-deck           Minimal two-theme workspace
```

## Claude Code and Codex

FastPPT auto-installs the common and registered theme Skills into the selected workspace and safely merges MCP configuration:

- Claude: `.claude/skills/*` and `.mcp.json`
- Codex: `.agents/skills/*` and `.codex/config.toml`

Existing user configuration is preserved and backed up before a managed change. Modified managed files become `conflict`; FastPPT does not overwrite them. Provider trust/approval remains a provider action and is reported as `pending-trust` rather than falsely marked complete.

Verified provider ranges:

- Claude Agent SDK `0.3.220`, bundled Claude Code `2.1.220`; supported Claude Code range `>=2.1.215 <2.2.0`
- Codex CLI/app-server `>=0.144.0 <0.147.0` (including `0.146.x`)

Claude loads project settings, limits each run to its resolved Skills and requests them with documented `/skill-name` syntax. Codex uses `skills/list`, typed Skill inputs and `$skill-name`. If discovery or documented per-run invocation is unavailable, the Gateway rejects the run. If a provider exposes no stable execution observation, the audit status remains `unknown`—never fabricated as completed.

## Skills and themes

The common `fastppt` Skill owns theme-independent workflow, workspace safety, MCP usage, preview validation and export. Visual rules live only in the corresponding theme Skill:

- `slidev-theme-academy` → `fastppt-theme-academy`
- `slidev-theme-eloc` → `fastppt-theme-eloc`
- `slidev-theme-landing` → `fastppt-theme-landing`
- `slidev-theme-mumbo` → `fastppt-theme-mumbo`
- `slidev-theme-narrative` → `fastppt-theme-narrative`
- `slidev-theme-nicodevs` → `fastppt-theme-nicodevs`
- `slidev-theme-nmt` → `fastppt-theme-nmt`
- `slidev-theme-nord` → `fastppt-theme-nord`
- `slidev-theme-practicum` → `fastppt-theme-practicum`
- `slidev-theme-raft` → `fastppt-theme-raft`
- `slidev-theme-sketchdeck` → `fastppt-theme-sketchdeck`
- `slidev-theme-squircle` → `fastppt-theme-squircle`
- `slidev-theme-tahta` → `fastppt-theme-tahta`
- `slidev-theme-the-unnamed` → `fastppt-theme-the-unnamed`
- `slidev-theme-touying` → `fastppt-theme-touying`
- `slidev-theme-tud-db` → `fastppt-theme-tud-db`

Adding a theme requires a workspace package with `package.json`, source notice/license, layouts, examples, `agent/theme-manifest.json`, `agent/theme-rules.md`, and a provider-valid `agent/SKILL.md`. The manifest is the canonical theme/Skill ID and version mapping. Registry loading rejects duplicate IDs, missing Skills, version/name mismatches, absolute or escaping paths, symlink escape and cross-theme ownership.

Every message supplies only a validated `themeId`; clients cannot provide a Skill path, Skill ID or prompt fragment. The Gateway resolves the common Skill plus exactly one theme Skill, snapshots that mapping for the run, verifies installation/capabilities, and persists the resolution status, invocation mechanism and observation evidence. The latest persisted audit for a restored session is loaded into the workspace UI; a provider without stable observation remains explicitly `unknown`.

## Slidewave editable PPTX export

Slidewave is maintained directly as the `@fastppt/slidewave` workspace package, with dependencies owned by the root catalog and composite TypeScript references participating in the Turbo graph. It has explicit `@fastppt/slidewave`, `@fastppt/slidewave/browser`, `@fastppt/slidewave/browser/runtime`, `@fastppt/slidewave/snapshot`, and `@fastppt/slidewave/server` entry points so browser capture and Node conversion cannot accidentally share runtime-only dependencies. The migrated fork keeps one HTML-to-editable-object conversion algorithm; the server entry supplies only its Node PptxGenJS backend. Each built-in theme imports the browser runtime from its Slidev setup entry.

Export capture runs inside a hidden Slidev `/print` iframe in the FastPPT browser. The injected `@fastppt/slidewave/browser/runtime` entry captures the rendered DOM, returns a serializable snapshot through a versioned `postMessage` protocol, and the SPA uploads it through the Gateway snapshot endpoint. `@fastppt/slidewave/server` receives only the validated snapshot and converts it to editable PPTX objects; the Gateway and MCP process never launch Chromium.

Exports are serially queued, persisted to SQLite, streamed on `export:<id>`, cancellable, bounded by a 120-second browser-snapshot timeout, and downloadable only through a completed known job. Names are sanitized and outputs stay under `<workspace>/.fastppt/exports`.

Agent execution is also bounded: Claude and Codex each receive an independent active-run quota of one.

The MCP `inspect_overflow`, `get_preview_status`, and `export_editable_pptx` tools use a workspace-scoped Gateway runtime descriptor. An active SPA claims browser work through the event stream. MCP exports are copied under `.fastppt/exports/mcp`.

## Commands and tests

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format

# Browser flow only
pnpm --filter @fastppt/e2e test
```

The automated suite covers workspace traversal/symlink/revision safety, theme registry invariants, managed installation and config merge, JSONL/RPC failure handling, Claude/Codex session and approval fixtures, all provider × built-in-theme Skill routes, third-theme enumeration, registry reloads, Slidev lifecycle, export queue/cancel/recovery/download, official MCP client calls, and the complete Playwright browser flow.

## Security

- Loopback-only HTTP, preview and WebSocket listeners
- Fixed trusted SPA-origin CORS and loopback-only service binding
- Canonical workspace containment, symlink defense, secret-file denylist, size/binary checks and atomic revision writes
- Image attachment signature, size, extension and workspace-containment validation before either Harness receives a path
- No provider keys in browser DTOs or logs; structured logger redaction
- No default provider bypass mode; approvals retain command, cwd, files and risk context
- Explicit child-process environment allowlists for Slidev, Codex and Claude; Claude receives only system runtime variables plus `ANTHROPIC_*`/`CLAUDE_CODE_*` authentication and configuration
- Process output is text-redacted before structured logging, in addition to Pino field redaction, and all managed child processes are closed during Gateway shutdown
- Sanitized export names and root-contained download resolution
- `.fastppt` state/cache/log/export paths are excluded from Slidev content discovery

## Troubleshooting and known limits

- A Harness may be `unavailable` while the rest of the Gateway remains usable; inspect `/ready` and the UI status.
- `pending-trust` means the MCP config was written but still requires provider confirmation.
- Skill execution observation remains `unknown` when the current provider protocol offers no stable proof; the invocation request and selected Skill are still auditable.
- MCP rendered inspection and editable export require an active FastPPT SPA so its Slidev iframe can perform DOM work; Gateway and MCP deliberately do not provide a headless-browser fallback.
- Slidewave maps supported DOM/text/image/vector elements to editable PowerPoint objects. Unsupported visual constructs may produce explicit export warnings rather than pixel-perfect editable equivalents.
- The Gateway writes its short-lived local connection descriptor to `.fastppt/runtime/gateway.json` with owner-only permissions and removes it on clean shutdown. It is ignored by version control and never written to Harness MCP configuration.
- Native SQLite installation requires Node 22 and normal native build support.

See `docs/architecture/overview.md`, `docs/api/http.md`, and `docs/development/getting-started.md` for detailed contracts and workflows. Third-party fork provenance is retained in each theme's `THIRD_PARTY_NOTICES.md`.
