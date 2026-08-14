# Development guide

## First run

The installable CLI is the normal backend-only entry point:

```bash
pnpm add --global @fastppt/cli
cd /path/to/deck-workspace
fastppt
# gateway: http://127.0.0.1:4317; frontend is not started
```

For a project-local dependency, use `pnpm add --save-dev @fastppt/cli` and
`pnpm exec fastppt`. The current directory is the workspace by default;
`fastppt --dir <path>` and `fastppt --workspace <path>` select another one.
Open the deployed frontend at `https://fastppt.vercel.app`.

Use `fastppt status`, `fastppt doctor`, and `fastppt stop` to inspect or stop
the Gateway registered for the current workspace. `fastppt start --open`
opens the deployed frontend after the local service starts; `--json` provides
machine-readable diagnostics.

The packaged theme bundle is synchronized to `~/.fastppt/themes` on the first
`start` or `doctor` invocation and whenever the CLI version changes. Imported
themes remain in that user directory across CLI upgrades.

Use the repository development command only when changing FastPPT itself. It
starts both backend and frontend development processes with source watching:

```bash
pnpm install
pnpm dev --dir ./examples/demo-deck   # --workspace works as an alias
# gateway: http://127.0.0.1:4317
# web:     http://127.0.0.1:4318
```

The Gateway serves plain HTTP on the loopback at `127.0.0.1:4317` and the Vite dev server runs on `127.0.0.1:4318`. Browsers allow secure pages (e.g. the Vercel-deployed SPA) to reach loopback addresses, so no hosts entry, certificate, or `sudo` is required. FastPPT reconciles the common/theme Skills and MCP configuration at runtime; no `.env` file or session token is required.

Do not commit generated `.fastppt`, `.mcp.json`, `.codex`, `.claude`, or `.agents` state from an example workspace; FastPPT creates and reconciles it at runtime.

## Configuration

Gateway binds to `127.0.0.1:4317` with plain HTTP; the web app points at `http://127.0.0.1:4317` and `ws://127.0.0.1:4317` regardless of whether the page is served by the local Vite dev server or the Vercel deployment. These endpoints are fixed in code and are not overridden through environment variables.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` includes the Playwright suite. Run it alone with `pnpm --filter @fastppt/e2e test`. It starts isolated ports, a temporary workspace, fake Claude/Codex Harnesses and a fake exporter; no provider account or key is used. The runner automatically uses system Chrome when available and otherwise uses Playwright Chromium.

## Adding a theme

Copy/create a package under `themes/`, preserve source/license notices, add layouts and examples, then provide `agent/theme-manifest.json`, `agent/theme-rules.md`, and `agent/SKILL.md`. IDs and versions must match across the package, manifest, directory and native Skill metadata. Do not add provider branches or theme maps to Harness adapters; registry enumeration, managed installation and parameterized routing tests must discover the package automatically.

## Adapter changes

Keep provider version checks and protocol payloads inside the owning Harness package. Update deterministic fixtures for request matching, streaming, approvals, cancellation and failure recovery. Never fall back to a free-form prompt when documented Skill invocation is unavailable.

Keep Slidewave runtime ownership explicit: DOM APIs belong under `packages/slidewave/src/browser` or the capture modules in `src/slidev`, while file output belongs under `src/server`. Themes activate capture through the public `slidewave/browser/runtime` side-effect import. Public consumers use package exports rather than source-relative imports. Package dependencies use the root workspace catalog, and production boundaries participate in composite project references whose generated declarations stay under `.tsbuild/`. Browser protocol changes require matching runtime/UI tests and a package build; conversion changes must preserve the fork's single conversion path and require snapshot-to-PPTX tests.

Do not start Slidev directly from Gateway code or add security policy to individual themes. `packages/slidev-host/runner.mjs` is the single process entry and injects the Vite filesystem deny list that prevents `.fastppt`, Harness configuration and secret files from being served.
