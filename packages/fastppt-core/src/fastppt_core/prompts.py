"""Server-owned prompt composition for planning and visual tasks."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Iterable

from .models import FactAnchor, PageContract, TargetScope, WorkflowMode


def compose_planning_prompt(
    *,
    instruction: str,
    workflow_mode: WorkflowMode,
    target_scope: TargetScope,
    page_contracts: Iterable[PageContract],
    facts: Iterable[FactAnchor],
    design_snapshot: dict | None = None,
    page_versions: Iterable[dict] = (),
) -> str:
    if not instruction.strip():
        raise ValueError("Instruction cannot be empty")
    context = {
        "workflow_mode": workflow_mode.value,
        "target_scope": target_scope.value,
        "page_contracts": [asdict(item) for item in page_contracts],
        "facts": [asdict(item) for item in facts],
        "design_snapshot": dict(design_snapshot or {}),
        "page_versions": [dict(item) for item in page_versions],
    }
    return "\n".join(
        (
            "You are the planning component of FastPPT.",
            "Return one JSON object only. Do not emit shell commands, paths, URLs, or tool calls.",
            "Use only these change kinds: preserve_fact, rewrite_text, layout_change, hierarchy_change, color_change, image_change, basic_structure_change.",
            "Never alter locked facts. Multi-page, global, page-count, fact, visual-direction, or high-cost changes require confirmation.",
            "Declare unsupported requests instead of hiding them behind a full-slide raster image.",
            "CONTEXT_JSON:",
            json.dumps(context, ensure_ascii=False, separators=(",", ":")),
            "USER_INSTRUCTION:",
            instruction.strip(),
        )
    )
