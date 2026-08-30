"""Domain enums and immutable request contracts."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
import hashlib
import json
from typing import Any

from .version import SCHEMA_VERSION
from .v2 import V2EditableLevel

# v1 keeps its historical names; v2 exposes the normative editability
# vocabulary separately so old persisted rows remain readable.
EditableLevelV2 = V2EditableLevel


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


class AgentRole(StrEnum):
    COORDINATOR = "coordinator"
    SOURCE_ANALYST = "source_analyst"
    IMPORT_ANALYST = "import_analyst"
    FACT_REVIEWER = "fact_reviewer"
    OUTLINE_PLANNER = "outline_planner"
    CONTENT_LOGIC_REVIEWER = "content_logic_reviewer"
    PAGE_WRITER = "page_writer"
    VISUAL_DIRECTOR = "visual_director"
    RECONSTRUCTION_PLANNER = "reconstruction_planner"
    QA_REVIEWER = "qa_reviewer"
    EDIT_PLANNER = "edit_planner"


class AgentRunStatus(StrEnum):
    NOT_REQUIRED = "not_required"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SUBMISSION_UNKNOWN = "submission_unknown"
    ABANDONED = "abandoned"


class ImagePurpose(StrEnum):
    FULL_SLIDE_REFERENCE = "full_slide_reference"
    LOCAL_ELEMENT = "local_element"
    TEMPLATE_VARIATION = "template_variation"
    IMAGE_EDIT = "image_edit"


class ImageRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_USER_DECISION = "awaiting_user_decision"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ImageAttemptStatus(StrEnum):
    CREATED = "created"
    SUBMITTED = "submitted"
    SUBMISSION_UNKNOWN = "submission_unknown"
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"
    CANCELLED = "cancelled"


class ReconstructionStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    PARTIAL = "partial"
    FAILED = "failed"
    AWAITING_TEXT_CONFIRMATION = "awaiting_text_confirmation"
    AWAITING_RECONSTRUCTION_DECISION = "awaiting_reconstruction_decision"


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
    # v1.1 fields are appended with defaults so v1.0 fixtures remain readable.
    contract_revision: int = 1
    content_blocks: tuple[dict[str, Any], ...] = ()
    speaker_notes: str = ""
    page_size: dict[str, Any] = field(default_factory=lambda: {"width": 13.333, "height": 7.5, "unit": "inch"})
    font_policy: dict[str, Any] = field(default_factory=lambda: {
        "zh_family": "Microsoft YaHei",
        "latin_family": "Arial",
        "fallback_families": [],
    })
    template_artifact_ids: tuple[str, ...] = ()
    design_snapshot: dict[str, Any] = field(default_factory=lambda: {
        "style_pack_id": None,
        "template_pack_id": None,
        "selection_source": "none",
        "capability_matrix": {},
    })
    schema_version: str = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        """Return the wire representation used by immutable contract artifacts."""
        value = asdict(self)
        value["page_type"] = self.page_type.value
        for key in ("required_fact_ids", "verbatim_text", "compressible_content", "prohibited_content", "image_artifact_ids", "source_hashes", "template_artifact_ids"):
            value[key] = list(value[key])
        value["content_blocks"] = [dict(block) for block in self.content_blocks]
        return value

    def content_hash(self) -> str:
        payload = json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True, slots=True)
class ContentBlock:
    block_id: str
    kind: str
    content: dict[str, Any] = field(default_factory=dict)
    source_hashes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    profile_id: str
    display_name: str
    endpoint_mode: str
    base_url: str | None
    secret_reference: str
    capability_settings: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    archived_at: str | None = None
    connection_status_by_capability: dict[str, str] = field(default_factory=dict)
    last_tested_at_by_capability: dict[str, str | None] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProjectModelPolicy:
    project_id: str
    agent_profile_id: str | None = None
    agent_model: str | None = None
    image_generation_profile_id: str | None = None
    image_generation_model: str | None = None
    image_edit_profile_id: str | None = None
    image_edit_model: str | None = None
    updated_by: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True, slots=True)
class DeckRevision:
    deck_revision_id: str
    project_id: str
    parent_revision_id: str | None
    source_session_id: str
    source_mode: WorkflowMode
    ordered_pages: tuple[dict[str, Any], ...]
    status: str
    aggregate_sha256: str
    created_by: str
    created_at: str

    @staticmethod
    def aggregate_hash(ordered_pages: list[dict[str, Any]]) -> str:
        payload = json.dumps(ordered_pages, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True, slots=True)
class AgentRun:
    agent_run_id: str
    project_id: str
    session_id: str | None
    parent_run_id: str | None
    role: AgentRole
    profile_id: str
    model: str
    input_artifact_ids: tuple[str, ...] = ()
    output_artifact_ids: tuple[str, ...] = ()
    context_digest: str = ""
    prompt_artifact_id: str | None = None
    prompt_id: str = ""
    prompt_version: str = SCHEMA_VERSION
    input_contract_version: str = SCHEMA_VERSION
    output_schema_version: str = SCHEMA_VERSION
    input_context_digest: str = ""
    prompt_digest: str = ""
    output_digest: str = ""
    context_manifest_artifact_id: str | None = None
    truncation_report_artifact_id: str | None = None
    parent_output_artifact_ids: tuple[str, ...] = ()
    design_selection_id: str | None = None
    status: AgentRunStatus = AgentRunStatus.QUEUED
    usage_request_id: str = ""
    retry_of_run_id: str | None = None
    idempotency_key: str = ""
    provider_request_id: str | None = None
    provider_snapshot: dict[str, Any] = field(default_factory=dict)
    error: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


@dataclass(frozen=True, slots=True)
class ImageRun:
    image_run_id: str
    project_id: str
    page_id: str | None
    purpose: ImagePurpose
    prompt_artifact_id: str
    input_artifact_ids: tuple[str, ...] = ()
    input_hashes: tuple[str, ...] = ()
    status: ImageRunStatus = ImageRunStatus.QUEUED
    selected_output_artifact_ids: tuple[str, ...] = ()
    decision: str | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass(frozen=True, slots=True)
class ImageAttempt:
    image_attempt_id: str
    image_run_id: str
    retry_of_attempt_id: str | None
    attempt_number: int
    profile_id: str
    provider_snapshot: dict[str, Any]
    endpoint_mode: str
    model: str
    idempotency_key: str
    provider_request_id: str | None
    usage_request_id: str
    status: ImageAttemptStatus = ImageAttemptStatus.CREATED
    output_artifact_ids: tuple[str, ...] = ()
    output_hashes: tuple[str, ...] = ()
    error: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


@dataclass(frozen=True, slots=True)
class VisualApproval:
    visual_approval_id: str
    page_id: str
    contract_revision: int
    visual_artifact_id: str
    visual_sha256: str
    decision: str
    comment: str
    actor_id: str
    created_at: str


@dataclass(frozen=True, slots=True)
class ReconstructionManifest:
    reconstruction_manifest_id: str
    page_id: str
    version_id: str
    page_contract_artifact_id: str
    visual_approval_id: str
    source_import_manifest_id: str | None
    objects: tuple[dict[str, Any], ...]
    unresolved_items: tuple[dict[str, Any], ...]
    qa_report_id: str
    aggregate_sha256: str
    schema_version: str = SCHEMA_VERSION


@dataclass(frozen=True, slots=True)
class PageProductionState:
    page_id: str
    contract_revision: int
    current_image_run_id: str | None
    selected_visual_artifact_id: str | None
    visual_approval_id: str | None
    reconstruction_manifest_id: str | None
    reconstruction_status: ReconstructionStatus
    render_authority_record_id: str | None
    updated_at: str


@dataclass(frozen=True, slots=True)
class RenderAuthorityRecord:
    render_authority_record_id: str
    page_id: str
    version_id: str
    pptx_artifact_id: str
    pptx_sha256: str
    render_worker: str
    office_version: str | None
    status: str
    output_png_artifact_id: str | None
    output_png_sha256: str | None
    qa_report_id: str | None
    reason: str | None
    created_at: str


@dataclass(frozen=True, slots=True)
class SourceText:
    source_text_id: str
    project_id: str
    artifact_id: str
    text: str
    sha256: str
    created_by: str
    created_at: str


@dataclass(frozen=True, slots=True)
class PptxImportManifest:
    manifest_id: str
    source_artifact_id: str
    source_sha256: str
    page_size: dict[str, Any]
    pages: tuple[dict[str, Any], ...]
    aggregate_sha256: str
    created_at: str


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
