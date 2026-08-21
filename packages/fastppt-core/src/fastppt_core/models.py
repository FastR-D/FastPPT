"""Domain enums and immutable request contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from .version import SCHEMA_VERSION


class WorkflowMode(StrEnum):
    DOCUMENT_CREATE = "document_create"
    PAGE_ENTRY = "page_entry"
    PPTX_IMPROVE = "pptx_improve"


class TargetScope(StrEnum):
    SINGLE = "single"
    MULTI = "multi"
    GLOBAL = "global"


class PageType(StrEnum):
    COVER = "cover"
    TOC = "toc"
    SECTION = "section"
    CONTENT = "content"
    ENDING = "ending"
    OTHER = "other"


class EditableLevel(StrEnum):
    VISUAL = "visual"
    TEXT_NATIVE = "text_native"
    NATIVE_PARTIAL = "native_partial"
    NATIVE_STRUCTURE = "native_structure"


class PreviewKind(StrEnum):
    QUICK = "quick"
    VISUAL = "visual"
    AUTHORITATIVE = "authoritative"


@dataclass(frozen=True, slots=True)
class FactAnchor:
    fact_id: str
    kind: str
    value: str
    normalized_value: str
    source_document_id: str
    source_locator: str
    confidence: float
    locked: bool = False


@dataclass(frozen=True, slots=True)
class PageContract:
    page_id: str
    page_type: PageType
    purpose: str
    title: str
    conclusion: str
    required_fact_ids: tuple[str, ...] = ()
    verbatim_text: tuple[str, ...] = ()
    compressible_content: tuple[str, ...] = ()
    prohibited_content: tuple[str, ...] = ()
    visual_direction: str = ""
    layout_intent: str = ""
    density: str = "balanced"
    hierarchy_style: str = "standard"
    accent_color: str = "#D14D3F"
    background_color: str = "#F7F8FA"
    image_artifact_ids: tuple[str, ...] = ()
    source_hashes: tuple[str, ...] = ()
    schema_version: str = SCHEMA_VERSION


@dataclass(frozen=True, slots=True)
class PlanChange:
    kind: str
    target: str | None = None
    value: Any = None
    fact_id: str | None = None
    constraint: str | None = None


@dataclass(frozen=True, slots=True)
class StructuredPlan:
    workflow_mode: WorkflowMode
    target_scope: TargetScope
    affected_page_ids: tuple[str, ...]
    changes: tuple[PlanChange, ...]
    page_delta: dict[str, tuple[str, ...]] = field(default_factory=dict)
    fact_impact: dict[str, tuple[str, ...]] = field(default_factory=dict)
    unsupported: tuple[str, ...] = ()
    requires_confirmation: bool = False
    confirmation_reasons: tuple[str, ...] = ()
    estimated_usage: dict[str, Any] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION
