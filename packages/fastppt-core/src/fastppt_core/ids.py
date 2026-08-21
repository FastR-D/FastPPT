"""Stable opaque identifier helpers."""

from __future__ import annotations

import uuid


_PREFIXES = {
    "artifact",
    "asset",
    "conflict",
    "document",
    "event",
    "export",
    "fact",
    "job",
    "operation",
    "page",
    "plan",
    "project",
    "request",
    "session",
    "usage",
    "user",
    "version",
}


def new_id(kind: str) -> str:
    if kind not in _PREFIXES:
        raise ValueError(f"Unsupported identifier kind: {kind}")
    return f"{kind}_{uuid.uuid4().hex}"
