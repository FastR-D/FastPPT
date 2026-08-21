# ppt-master kernel

This directory is the single vendored boundary for the upstream `ppt-master`
kernel. FastPPT product code must call it through
`packages/ppt-master-adapter`; it must not import kernel internals directly.

- `upstream/` is an unmodified snapshot of upstream `skills/ppt-master/`.
- `UPSTREAM.json` records the source repository, branch, and pinned commit.
- `sync.py` previews or applies a controlled update from the configured Git
  remote. It never pushes upstream.

Run `python kernel/ppt-master/sync.py --check` to verify the pinned snapshot,
then `python kernel/ppt-master/sync.py --check --fetch` to preview the latest
configured upstream branch without relying on a machine-local Git remote.
Apply an audited snapshot with
`python kernel/ppt-master/sync.py --apply --fetch --commit <sha>`. Run the
adapter and Golden Deck tests before committing the update.
