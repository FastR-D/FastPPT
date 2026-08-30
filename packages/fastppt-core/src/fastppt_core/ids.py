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
    "design_selection",
    "design_snapshot",
    "page_contract_snapshot",
    "checkpoint",
    "artifact_commit",
    "envelope",
    "event",
    "export",
    "export_snapshot",
    "export_attempt",
    "fact",
    "image_attempt",
    "image_run",
    "job",
    "logic_analysis",
    "operation",
    "page",
    "page_draft",
    "plan",
    "project",
    "profile",
    "context_manifest",
    "pptx_manifest",
    "reconstruction",
    "render_authority",
    "request",
    "session",
    "source_text",
    "truncation_report",
    "usage",
    "user",
    "visual_approval",
    "version",
}


def new_id(kind: str) -> str:
    if kind not in _PREFIXES:
        raise ValueError(f"Unsupported identifier kind: {kind}")
    return f"{kind}_{uuid.uuid4().hex}"
