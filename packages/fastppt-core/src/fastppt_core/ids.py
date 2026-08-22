"""Stable opaque identifier helpers."""

from __future__ import annotations

import uuid


_PREFIXES = {
    "artifact",
    "agent_run",
    "asset",
    "conflict",
    "document",
    "deck_revision",
    "event",
    "export",
    "fact",
    "image_attempt",
    "image_run",
    "job",
    "operation",
    "page",
    "plan",
    "project",
    "profile",
    "pptx_manifest",
    "reconstruction",
    "render_authority",
    "request",
    "session",
    "source_text",
    "usage",
    "user",
    "visual_approval",
    "version",
}


def new_id(kind: str) -> str:
    if kind not in _PREFIXES:
        raise ValueError(f"Unsupported identifier kind: {kind}")
    return f"{kind}_{uuid.uuid4().hex}"
