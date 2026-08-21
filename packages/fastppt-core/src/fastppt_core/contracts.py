"""Fail-closed validation for model-produced structured plans."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from .models import PlanChange, StructuredPlan, TargetScope, WorkflowMode


ALLOWED_CHANGE_KINDS = frozenset(
    {
        "preserve_fact",
        "rewrite_text",
        "layout_change",
        "hierarchy_change",
        "color_change",
        "image_change",
    }
)
LAYOUT_VALUES = frozenset({"title_body", "two_column", "three_stage_flow", "timeline", "metric_grid"})
HIERARCHY_VALUES = frozenset({"standard", "compact", "emphasis"})
TEXT_TARGETS = frozenset({"title", "body", "content"})
COLOR_TARGETS = frozenset({"accent", "background"})
PAGE_DELTA_KEYS = frozenset({"add", "remove", "split", "merge"})
FACT_IMPACT_KEYS = frozenset({"added", "removed", "changed"})


class PlanValidationError(ValueError):
    def __init__(self, errors: Sequence[str]):
        self.errors = tuple(errors)
        super().__init__("; ".join(self.errors))


def _strings(value: Any, field: str, errors: list[str]) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        errors.append(f"{field} must be an array of non-empty strings")
        return ()
    return tuple(value)


def _impact_map(value: Any, keys: frozenset[str], field: str, errors: list[str]) -> dict[str, tuple[str, ...]]:
    if not isinstance(value, Mapping) or set(value).difference(keys):
        errors.append(f"{field} contains unsupported keys")
        return {}
    return {key: _strings(value.get(key, []), f"{field}.{key}", errors) for key in sorted(keys)}


def validate_plan(payload: Mapping[str, Any], known_page_ids: set[str]) -> StructuredPlan:
    errors: list[str] = []
    try:
        workflow_mode = WorkflowMode(payload.get("workflowMode"))
    except ValueError:
        errors.append("workflowMode is invalid")
        workflow_mode = WorkflowMode.DOCUMENT_CREATE
    try:
        target_scope = TargetScope(payload.get("targetScope"))
    except ValueError:
        errors.append("targetScope is invalid")
        target_scope = TargetScope.SINGLE

    affected = _strings(payload.get("affectedPageIds"), "affectedPageIds", errors)
    unknown = sorted(set(affected).difference(known_page_ids))
    if unknown:
        errors.append("affectedPageIds contains unknown pages")
    if target_scope == TargetScope.SINGLE and len(affected) != 1:
        errors.append("single scope requires exactly one affected page")

    raw_changes = payload.get("changes")
    changes: list[PlanChange] = []
    if not isinstance(raw_changes, list) or not raw_changes:
        errors.append("changes must be a non-empty array")
    else:
        for index, item in enumerate(raw_changes):
            if not isinstance(item, Mapping):
                errors.append(f"changes[{index}] must be an object")
                continue
            kind = item.get("kind")
            if kind not in ALLOWED_CHANGE_KINDS:
                errors.append(f"changes[{index}].kind is not allowed")
                continue
            target = item.get("target") if isinstance(item.get("target"), str) else None
            value = item.get("value")
            fact_id = item.get("factId") if isinstance(item.get("factId"), str) else None
            if kind == "preserve_fact" and not fact_id:
                errors.append(f"changes[{index}].factId is required for preserve_fact")
                continue
            if kind == "rewrite_text":
                constraint = item.get("constraint")
                if target not in TEXT_TARGETS:
                    errors.append(f"changes[{index}].target is invalid for rewrite_text")
                    continue
                if value is not None and (not isinstance(value, str) or not value.strip()):
                    errors.append(f"changes[{index}].value must be non-empty text")
                    continue
                if constraint not in {None, "one_line"}:
                    errors.append(f"changes[{index}].constraint is not executable")
                    continue
                if value is None and not (target == "title" and constraint == "one_line"):
                    errors.append(f"changes[{index}] does not contain an executable text change")
                    continue
            if kind == "layout_change" and (target not in {"content", "layout"} or value not in LAYOUT_VALUES):
                errors.append(f"changes[{index}] contains an unsupported layout change")
                continue
            if kind == "hierarchy_change" and (target not in TEXT_TARGETS | {"page"} or value not in HIERARCHY_VALUES):
                errors.append(f"changes[{index}] contains an unsupported hierarchy change")
                continue
            if kind == "color_change":
                if target not in COLOR_TARGETS or not isinstance(value, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
                    errors.append(f"changes[{index}] contains an unsupported color change")
                    continue
            if kind == "image_change":
                artifact_id = value.get("artifactId") if isinstance(value, Mapping) else None
                if target not in {"content", "image"} or not isinstance(artifact_id, str) or not artifact_id.startswith("artifact_"):
                    errors.append(f"changes[{index}] must reference a registered local image artifact")
                    continue
            changes.append(
                PlanChange(
                    kind=kind,
                    target=target,
                    value=value,
                    fact_id=fact_id,
                    constraint=item.get("constraint") if isinstance(item.get("constraint"), str) else None,
                )
            )

    page_delta = _impact_map(payload.get("pageDelta", {}), PAGE_DELTA_KEYS, "pageDelta", errors)
    fact_impact = _impact_map(payload.get("factImpact", {}), FACT_IMPACT_KEYS, "factImpact", errors)
    if any(page_delta.values()):
        errors.append("page add, remove, split, and merge are not executable in v1.0.0 edit operations")
    if any(fact_impact.values()):
        errors.append("fact changes must use the fact conflict resolution workflow")
    unsupported = _strings(payload.get("unsupported", []), "unsupported", errors)
    stated_confirmation = payload.get("requiresConfirmation")
    if not isinstance(stated_confirmation, bool):
        errors.append("requiresConfirmation must be a boolean")
        stated_confirmation = False
    reasons = _strings(payload.get("confirmationReasons", []), "confirmationReasons", errors)
    estimated_usage = payload.get("estimatedUsage", {})
    if not isinstance(estimated_usage, Mapping):
        errors.append("estimatedUsage must be an object")
        estimated_usage = {}

    computed_reasons = list(reasons)
    if target_scope != TargetScope.SINGLE:
        computed_reasons.append("multi_page_scope")
    if any(page_delta.values()):
        computed_reasons.append("page_count_change")
    if any(fact_impact.values()):
        computed_reasons.append("fact_change")
    visual_kinds = {"layout_change", "hierarchy_change", "color_change", "image_change"}
    if any(change.kind in visual_kinds for change in changes):
        computed_reasons.append("visual_change")
    if unsupported:
        errors.append("unsupported capabilities must be resolved before execution")
    requires_confirmation = bool(computed_reasons)
    if requires_confirmation and not stated_confirmation:
        errors.append("requiresConfirmation cannot bypass server confirmation rules")

    if errors:
        raise PlanValidationError(errors)
    return StructuredPlan(
        workflow_mode=workflow_mode,
        target_scope=target_scope,
        affected_page_ids=affected,
        changes=tuple(changes),
        page_delta=page_delta,
        fact_impact=fact_impact,
        unsupported=unsupported,
        requires_confirmation=requires_confirmation,
        confirmation_reasons=tuple(dict.fromkeys(computed_reasons)),
        estimated_usage=dict(estimated_usage),
    )
