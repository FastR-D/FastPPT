#!/usr/bin/env python3
"""Preview and apply a pinned ppt-master kernel snapshot from Git."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


WRAPPER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = WRAPPER_ROOT.parents[1]
MANIFEST_PATH = WRAPPER_ROOT / "UPSTREAM.json"
KERNEL_ROOT = WRAPPER_ROOT / "upstream"


class SyncError(RuntimeError):
    pass


def _run(*args: str, timeout_seconds: int | None = None) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise SyncError(f"Command timed out after {timeout_seconds}s: {' '.join(args)}") from exc
    if result.returncode:
        raise SyncError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def _manifest() -> dict[str, str]:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    required = {"repository", "branch", "source_path", "base_commit"}
    missing = sorted(required.difference(payload))
    if missing:
        raise SyncError(f"UPSTREAM.json is missing: {', '.join(missing)}")
    return payload


def _assert_clean_kernel() -> None:
    changed = _run("git", "status", "--short", "--", str(WRAPPER_ROOT.relative_to(REPOSITORY_ROOT)))
    allowed = {"kernel/ppt-master/UPSTREAM.json"}
    unsafe = []
    for line in changed.splitlines():
        path = line[3:].replace("\\", "/") if len(line) > 3 else ""
        if path and path not in allowed:
            unsafe.append(line)
    if unsafe:
        raise SyncError("Kernel has local changes; review them before sync:\n" + "\n".join(unsafe))


def _resolve_commit(manifest: dict[str, str], requested: str | None, *, fetched: bool) -> str:
    reference = requested or ("FETCH_HEAD" if fetched else manifest["base_commit"])
    return _run("git", "rev-parse", "--verify", f"{reference}^{{commit}}")


def _archive(commit: str, source_path: str, destination: Path) -> Path:
    archive_path = destination / "kernel.tar"
    with archive_path.open("wb") as handle:
        result = subprocess.run(
            ["git", "archive", "--format=tar", commit, source_path],
            cwd=REPOSITORY_ROOT,
            check=False,
            stdout=handle,
            stderr=subprocess.PIPE,
        )
    if result.returncode:
        raise SyncError(result.stderr.decode("utf-8", errors="replace").strip())
    extracted = destination / "extracted"
    extracted.mkdir()
    with tarfile.open(archive_path) as archive:
        archive.extractall(extracted, filter="data")
    return extracted / source_path


def _snapshot_files(root: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix.casefold() not in {".pyc", ".pyo"}
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )


def _inventory(root: Path) -> dict[str, int | str]:
    files = _snapshot_files(root)
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return {
        "files": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "sha256": digest.hexdigest(),
    }


def _temporary_workspace() -> tempfile.TemporaryDirectory[str]:
    return tempfile.TemporaryDirectory(
        prefix="fastppt-kernel-sync-",
        dir=WRAPPER_ROOT.parent,
    )


def _replace_snapshot(candidate: Path, backup: Path) -> None:
    KERNEL_ROOT.rename(backup)
    try:
        shutil.copytree(candidate, KERNEL_ROOT)
    except Exception:
        if KERNEL_ROOT.exists():
            shutil.rmtree(KERNEL_ROOT)
        backup.rename(KERNEL_ROOT)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="show the pinned update without changing files")
    action.add_argument("--apply", action="store_true", help="replace the vendored snapshot")
    parser.add_argument(
        "--commit",
        help="exact upstream commit; defaults to the pinned commit, or the fetched branch head with --fetch",
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="fetch the configured upstream repository and branch before checking",
    )
    args = parser.parse_args(argv)

    manifest = _manifest()
    if args.apply and not args.commit:
        raise SyncError("--apply requires an explicit --commit for reproducibility")
    if args.fetch:
        _run("git", "fetch", "--no-tags", manifest["repository"], manifest["branch"], timeout_seconds=120)
    commit = _resolve_commit(manifest, args.commit, fetched=args.fetch)
    with _temporary_workspace() as temp_name:
        candidate = _archive(commit, manifest["source_path"], Path(temp_name))
        current = _inventory(KERNEL_ROOT)
        candidate_inventory = _inventory(candidate)
        result = {
            "current_commit": manifest["base_commit"],
            "candidate_commit": commit,
            "current": current,
            "candidate": candidate_inventory,
            "changed": commit != manifest["base_commit"] or current["sha256"] != candidate_inventory["sha256"],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not args.apply or not result["changed"]:
            return 0
        _assert_clean_kernel()
        if KERNEL_ROOT.resolve().parent != WRAPPER_ROOT.resolve():
            raise SyncError("Refusing to replace a kernel outside the wrapper")
        backup = Path(temp_name) / "previous"
        _replace_snapshot(candidate, backup)
        manifest["base_commit"] = commit
        MANIFEST_PATH.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        raise SystemExit(f"sync failed: {exc}") from exc
