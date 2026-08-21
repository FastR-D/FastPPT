"""Portable path resolution and workspace containment checks."""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath


_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]")


class UnsafePathError(ValueError):
    pass


def repository_root(start: Path | None = None) -> Path:
    current = (start or Path(__file__)).resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").is_file() and (candidate / "kernel" / "ppt-master").is_dir():
            return candidate
    raise RuntimeError("Cannot locate the FastPPT repository root")


def validate_logical_path(value: str) -> PurePosixPath:
    if not value or "\x00" in value:
        raise UnsafePathError("Path must be a non-empty logical path")
    if _WINDOWS_ABSOLUTE.match(value) or value.startswith(("/", "\\", "~")):
        raise UnsafePathError("Absolute paths are not accepted")
    if "\\" in value:
        raise UnsafePathError("Logical paths must use POSIX separators")
    logical = PurePosixPath(value)
    if any(part in {"", ".", ".."} for part in logical.parts):
        raise UnsafePathError("Path traversal is not accepted")
    return logical


def resolve_inside(root: Path, logical_path: str) -> Path:
    logical = validate_logical_path(logical_path)
    resolved_root = root.resolve()
    candidate = resolved_root.joinpath(*logical.parts).resolve(strict=False)
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise UnsafePathError("Resolved path escapes the configured workspace") from exc
    return candidate
