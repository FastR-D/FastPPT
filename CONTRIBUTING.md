# Contributing to FastPPT

Development occurs on `main`. Keep commits small and keep local/server behavior
behind configuration and injected adapters, not branches.

Before submitting a change:

```powershell
.\tools\test.ps1
```

Changes to the kernel boundary must also run
`python kernel/ppt-master/sync.py --check`, the adapter integration test, and
Golden Deck validation. Do not submit `.env`, runtime data, exports, credentials,
or machine-specific paths.
