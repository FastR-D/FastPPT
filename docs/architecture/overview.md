# Architecture overview

FastPPT is a stateful localhost daemon plus a Vue SPA, not a stateless cloud CRUD service. The Gateway owns the fixed workspace, process lifecycles, file revisions, normalized Harness events, approvals, theme snapshots, preview state and export jobs. SQLite stores FastPPT audit/state records without replacing provider session history as the source of truth.

## Runtime flow

```text
Browser
  ├─ authenticated REST ──────────────┐
  └─ sequenced topic WebSocket ───────┤
                                      ▼
                              Fastify Gateway
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
 safe WorkspaceService       HarnessAdapter registry       preview/export runtime
 file tree/read/write/watch   ├─ Claude Agent SDK           ├─ SlidevHost
        │                     └─ Codex app-server RPC       └─ ExportJobManager
        ▼                             │                             │
 SQLite app/audit/export state        ▼                             ▼
                              managed Skills + MCP          Slidewave server runtime
```

Package dependency direction is app → protocol/domain package. Claude and Codex depend on `harness-core`, never on each other. Provider protocol details do not enter Vue. `protocol` contains no Node-specific module and is shared by Gateway and browser.

## Theme and Skill invariant

The validated theme registry is the sole theme-to-Skill authority. A request provides `themeId`; the Gateway resolves the common `fastppt` Skill and exactly one registered theme Skill, verifies the selected provider's discovery/invocation capabilities and managed installation, then creates an immutable run snapshot. Adapters only translate that structured request into their provider's documented mechanism.

Registry reload builds and validates a complete candidate plus its install plan before atomically replacing the live registry. Existing requests retain their snapshot. Duplicate IDs, invalid ownership, symlink escape, missing Skills and native metadata mismatches reject the candidate.

## Event and state model

HTTP handles commands and authoritative state reads. WebSocket clients subscribe to exact topics such as `workspace`, `sessions`, `preview`, and `export:<id>`. Events have monotonic process-local sequence numbers; clients reconnect, resubscribe, ignore duplicate/older events, then refresh authoritative HTTP state so missed events and Gateway sequence resets cannot leave stale UI state. Pending iframe export and inspection delegations are included in application state for the same reason. Heartbeats and buffered-byte limits protect dead or slow clients.

Provider history remains provider-owned. FastPPT persists workspace/deck references, user session aliases, recent provider/theme choices, approvals, managed installation state, run/Skill audit events and export jobs. Interrupted queued/running exports are recovered as explicit failures on startup.

## Preview and export boundary

`SlidevHost` allocates a loopback port per deck, starts a package-owned Slidev runner with a registered absolute theme root, probes readiness and owns stop/restart/idle cleanup. The runner injects a host-level Vite deny policy for `.fastppt`, Harness configuration and common secret files, independent of the selected theme. The browser embeds the preview in a sandboxed iframe and relies on Slidev/Vite HMR.

Slidewave is a native workspace package with separate core, browser protocol, browser runtime, snapshot contract, and server entry points. It has no dependency on FastPPT application packages. The `slidewave/snapshot` entry owns the transport-safe types and runtime validation schema; `@fastppt/protocol` re-exports that contract rather than duplicating it. Each theme imports the browser runtime from its Slidev setup entry. When an export waits for capture, the SPA creates a hidden `/print` iframe, exchanges a versioned `postMessage`, and uploads the resulting serializable snapshot to the authenticated Gateway endpoint. The Gateway validates the transport schema and owns the queue, while the Slidewave server runtime converts the snapshot and writes a partial file; neither launches nor controls Chromium.

The Gateway-owned `ExportJobManager` owns queueing, cancellation, snapshot timeouts, progress, warnings, atomic rename and terminal state. Slidewave exposes conversion capabilities rather than FastPPT DTOs or HTTP job lifecycle concepts.

## Security boundaries

Gateway, Vite and Slidev bind to loopback. HTTP/WebSocket operations require a local token. Workspace paths are canonicalized and contained, sensitive names are denied, writes are atomic/revision-checked, and symlinks cannot escape. Downloads resolve only persisted completed outputs below the export root. Provider keys never enter browser DTOs. Child processes receive explicit environment allowlists; Claude retains only required system variables and `ANTHROPIC_*`/`CLAUDE_CODE_*` settings. Harness and Slidev output is text-redacted before structured logging, and child processes are closed during Gateway shutdown.
