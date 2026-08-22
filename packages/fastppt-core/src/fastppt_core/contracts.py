"""Fail-closed validation for model-produced structured plans."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from .models import (
    AgentRunStatus,
    ImageAttemptStatus,
    ImageRunStatus,
    PlanChange,
    ReconstructionStatus,
    StructuredPlan,
    TargetScope,
    WorkflowMode,
)


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


class ContractValidationError(ValueError):
    """Raised when a v1.1 immutable artifact is not safe to persist."""

    def __init__(self, errors: Sequence[str]):
        self.errors = tuple(errors)
        super().__init__("; ".join(self.errors))


def validate_page_contract(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Fail closed on the v1.1 PageContract wire shape.

    The validator intentionally accepts the v1.0-compatible fields while
    requiring every new structural field when a v1.1 contract is declared.
    """
    errors: list[str] = []
    required = ("page_id", "page_type", "purpose", "title", "conclusion", "content_blocks", "page_size", "font_policy")
    if payload.get("schema_version") == "1.1.0":
        required += ("contract_revision", "speaker_notes", "verbatim_text", "compressible_content", "prohibited_content", "required_fact_ids", "source_hashes", "visual_direction", "layout_intent", "density", "hierarchy_style", "accent_color", "background_color", "image_artifact_ids", "template_artifact_ids")
    for key in required:
        if key not in payload:
            errors.append(f"{key} is required")
    if payload.get("schema_version") not in {None, "1.0.0", "1.1.0"}:
        errors.append("schema_version is unsupported")
    if not isinstance(payload.get("contract_revision", 1), int) or payload.get("contract_revision", 1) < 1:
        errors.append("contract_revision must be a positive integer")
    blocks = payload.get("content_blocks", [])
    allowed_kinds = {"paragraph", "bullets", "table", "chart", "image", "shape", "other"}
    if not isinstance(blocks, list):
        errors.append("content_blocks must be an array")
    else:
        for index, block in enumerate(blocks):
            if not isinstance(block, Mapping):
                errors.append(f"content_blocks[{index}] must be an object")
                continue
            if not isinstance(block.get("block_id"), str) or not block["block_id"]:
                errors.append(f"content_blocks[{index}].block_id is required")
            if block.get("kind") not in allowed_kinds:
                errors.append(f"content_blocks[{index}].kind is invalid")
            if not isinstance(block.get("content", {}), Mapping):
                errors.append(f"content_blocks[{index}].content must be an object")
            if not isinstance(block.get("source_hashes", []), list) or any(not isinstance(item, str) for item in block.get("source_hashes", [])):
                errors.append(f"content_blocks[{index}].source_hashes must be strings")
    size = payload.get("page_size", {})
    if not isinstance(size, Mapping) or not isinstance(size.get("width"), (int, float)) or not isinstance(size.get("height"), (int, float)) or size.get("unit") not in {"inch", "cm", "emu"}:
        errors.append("page_size must contain positive width, height and a supported unit")
    elif size["width"] <= 0 or size["height"] <= 0:
        errors.append("page_size dimensions must be positive")
    fonts = payload.get("font_policy", {})
    if not isinstance(fonts, Mapping) or not isinstance(fonts.get("zh_family"), str) or not isinstance(fonts.get("latin_family"), str) or not isinstance(fonts.get("fallback_families", []), list):
        errors.append("font_policy is invalid")
    if payload.get("schema_version") == "1.1.0":
        for field in ("verbatim_text", "compressible_content", "prohibited_content", "required_fact_ids", "source_hashes", "image_artifact_ids", "template_artifact_ids"):
            value = payload.get(field, [])
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                errors.append(f"{field} must be an array of strings")
        for field in ("visual_direction", "layout_intent", "density", "hierarchy_style"):
            if not isinstance(payload.get(field, ""), str) or not str(payload.get(field, "")).strip():
                errors.append(f"{field} must be non-empty text")
        for field in ("accent_color", "background_color"):
            if not isinstance(payload.get(field), str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", str(payload.get(field, ""))):
                errors.append(f"{field} must be a six-digit hex color")
    if errors:
        raise ContractValidationError(errors)
    return dict(payload)


AGENT_RUN_TRANSITIONS: dict[str, set[str]] = {
    AgentRunStatus.QUEUED.value: {AgentRunStatus.QUEUED.value, AgentRunStatus.RUNNING.value, AgentRunStatus.CANCELLED.value},
    AgentRunStatus.RUNNING.value: {AgentRunStatus.RUNNING.value, AgentRunStatus.COMPLETED.value, AgentRunStatus.PARTIAL.value, AgentRunStatus.FAILED.value, AgentRunStatus.SUBMISSION_UNKNOWN.value, AgentRunStatus.CANCELLED.value},
    AgentRunStatus.SUBMISSION_UNKNOWN.value: {AgentRunStatus.SUBMISSION_UNKNOWN.value, AgentRunStatus.COMPLETED.value, AgentRunStatus.FAILED.value, AgentRunStatus.ABANDONED.value},
    AgentRunStatus.FAILED.value: {AgentRunStatus.FAILED.value, AgentRunStatus.QUEUED.value, AgentRunStatus.ABANDONED.value},
    AgentRunStatus.PARTIAL.value: {AgentRunStatus.PARTIAL.value, AgentRunStatus.QUEUED.value, AgentRunStatus.COMPLETED.value},
    AgentRunStatus.COMPLETED.value: {AgentRunStatus.COMPLETED.value},
    AgentRunStatus.CANCELLED.value: {AgentRunStatus.CANCELLED.value},
    AgentRunStatus.ABANDONED.value: {AgentRunStatus.ABANDONED.value},
}


IMAGE_RUN_TRANSITIONS: dict[str, set[str]] = {
    ImageRunStatus.QUEUED.value: {ImageRunStatus.QUEUED.value, ImageRunStatus.RUNNING.value, ImageRunStatus.CANCELLED.value},
    ImageRunStatus.RUNNING.value: {ImageRunStatus.RUNNING.value, ImageRunStatus.COMPLETED.value, ImageRunStatus.AWAITING_USER_DECISION.value, ImageRunStatus.PAUSED.value, ImageRunStatus.CANCELLED.value},
    ImageRunStatus.AWAITING_USER_DECISION.value: {ImageRunStatus.AWAITING_USER_DECISION.value, ImageRunStatus.QUEUED.value, ImageRunStatus.RUNNING.value, ImageRunStatus.PAUSED.value, ImageRunStatus.CANCELLED.value},
    ImageRunStatus.PAUSED.value: {ImageRunStatus.PAUSED.value, ImageRunStatus.QUEUED.value, ImageRunStatus.CANCELLED.value},
    ImageRunStatus.COMPLETED.value: {ImageRunStatus.COMPLETED.value},
    ImageRunStatus.CANCELLED.value: {ImageRunStatus.CANCELLED.value},
}


IMAGE_ATTEMPT_TRANSITIONS: dict[str, set[str]] = {
    ImageAttemptStatus.CREATED.value: {ImageAttemptStatus.CREATED.value, ImageAttemptStatus.SUBMITTED.value, ImageAttemptStatus.CANCELLED.value},
    ImageAttemptStatus.SUBMITTED.value: {ImageAttemptStatus.SUBMITTED.value, ImageAttemptStatus.COMPLETED.value, ImageAttemptStatus.FAILED.value, ImageAttemptStatus.SUBMISSION_UNKNOWN.value, ImageAttemptStatus.CANCELLED.value},
    ImageAttemptStatus.SUBMISSION_UNKNOWN.value: {ImageAttemptStatus.SUBMISSION_UNKNOWN.value, ImageAttemptStatus.COMPLETED.value, ImageAttemptStatus.FAILED.value, ImageAttemptStatus.ABANDONED.value},
    ImageAttemptStatus.FAILED.value: {ImageAttemptStatus.FAILED.value, ImageAttemptStatus.ABANDONED.value},
    ImageAttemptStatus.COMPLETED.value: {ImageAttemptStatus.COMPLETED.value},
    ImageAttemptStatus.ABANDONED.value: {ImageAttemptStatus.ABANDONED.value},
    ImageAttemptStatus.CANCELLED.value: {ImageAttemptStatus.CANCELLED.value},
}


def validate_transition(current: str, target: str, transitions: Mapping[str, set[str]]) -> None:
    if target not in transitions.get(current, set()):
        raise ContractValidationError([f"invalid state transition: {current} -> {target}"])


def validate_reconstruction_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    if not payload.get("page_id") or not payload.get("version_id") or not payload.get("visual_approval_id") or not payload.get("page_contract_artifact_id"):
        errors.append("page_id, version_id, page_contract_artifact_id and visual_approval_id are required")
    if payload.get("schema_version") != "1.1.0":
        errors.append("schema_version must be 1.1.0")
    if not isinstance(payload.get("qa_report_id"), str) or not payload.get("qa_report_id"):
        errors.append("qa_report_id is required")
    if not isinstance(payload.get("aggregate_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("aggregate_sha256", ""))):
        errors.append("aggregate_sha256 must be a lowercase SHA-256 hex digest")
    objects = payload.get("objects")
    if not isinstance(objects, list) or not objects:
        errors.append("objects must be a non-empty array")
    unresolved = payload.get("unresolved_items", [])
    if not isinstance(unresolved, list):
        errors.append("unresolved_items must be an array")
    for index, item in enumerate(objects or []):
        if not isinstance(item, Mapping):
            errors.append(f"objects[{index}] must be an object")
            continue
        if item.get("type") not in {"text", "shape", "svg_icon", "image", "table", "chart", "other"}:
            errors.append(f"objects[{index}].type is invalid")
        if not isinstance(item.get("object_id"), str) or not item.get("object_id"):
            errors.append(f"objects[{index}].object_id is required")
        bounds = item.get("bounds")
        if not isinstance(bounds, Mapping) or not all(isinstance(bounds.get(key), (int, float)) for key in ("x", "y", "width", "height")) or any(float(bounds.get(key, 0)) < 0 for key in ("width", "height")):
            errors.append(f"objects[{index}].bounds is invalid")
        if not isinstance(item.get("z_index"), int) or item.get("z_index") < 0:
            errors.append(f"objects[{index}].z_index must be a non-negative integer")
        if item.get("editable_level") not in {"text_native", "native_structure", "native_partial", "raster_local"}:
            errors.append(f"objects[{index}].editable_level is invalid")
        confidence = item.get("recognition_confidence")
        if confidence is not None and (not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1):
            errors.append(f"objects[{index}].recognition_confidence is invalid")
        if not isinstance(item.get("requires_user_confirmation"), bool):
            errors.append(f"objects[{index}].requires_user_confirmation must be boolean")
        if item.get("requires_user_confirmation") and not item.get("confirmed_at"):
            errors.append(f"objects[{index}] requires user confirmation")
        if item.get("editable_level") == "raster_local" and not isinstance(item.get("artifact_id"), str):
            errors.append(f"objects[{index}] raster_local requires a registered artifact")
    if unresolved:
        errors.append("unresolved_items prevent reconstruction from becoming ready")
    if errors:
        raise ContractValidationError(errors)
    return dict(payload)


def validate_reconstruction_status(status: str) -> None:
    if status not in {item.value for item in ReconstructionStatus}:
        raise ContractValidationError(["reconstruction status is invalid"])


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
