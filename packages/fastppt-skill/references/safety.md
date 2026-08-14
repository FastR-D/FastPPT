# Workspace safety

- Operate only through FastPPT MCP tools scoped to the current workspace.
- Treat tool-returned paths and revisions as authoritative.
- Supply the latest revision when writing; on conflict, reread and reconcile.
- Never follow symlinks or construct paths that escape the workspace.
- Never read or expose `.env`, credentials, tokens, SSH material, provider stores,
  browser profiles, or operating-system configuration.
- Never modify `.git`, `.fastppt`, `.claude`, `.agents`, or `.codex` during a deck
  authoring run.
- Use Harness web-search or browsing tools for discovery. Import remote images
  only through `import_remote_image`; never use arbitrary filesystem writes.
- Keep fallback command execution subject to the Harness approval flow.
- Export only on an explicit user request and report the produced workspace artifact.
