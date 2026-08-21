# Reuse ledger

FastPPT v1.0.0 is reimplemented in the current mainline. No code from the
legacy FastPPT Skill application or student Gateway has been copied.

| Source | Source commit | Source path | Target path | Method | License | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| `hugohe3/ppt-master` | `a160e776b7faff5d2227d180d0f31c6253056fae` | `skills/ppt-master` | `kernel/ppt-master/upstream` | Unmodified vendored kernel snapshot | MIT; copyright retained | `attribution_guard.py`, adapter probe, exact file/byte inventory, integration export |
| `hugohe3/ppt-master` | repository history through the migration baseline | repository examples/docs/plugin entry | `kernel/ppt-master/upstream-repository` | Mechanical relocation for attribution and reference only; not a FastPPT runtime dependency | Original notices retained | Git rename audit and repository hygiene scan |

New FastPPT domain, API, runtime, deployment, Agent Harness, Web UI, tests, and
documentation were authored in this repository for v1.0.0.
