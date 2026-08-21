"""Shared FastPPT application service used by local and server APIs."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastppt_agent_harness import AgentError, AgentHarness, AgentRequest
from fastppt_core.contracts import validate_plan
from fastppt_core.documents import MEDIA_TYPES, DocumentError, page_drafts_from_markdown, parse_document, safe_file_name
from fastppt_core.ids import new_id
from fastppt_core.models import FactAnchor, PageContract, PageType, TargetScope, WorkflowMode
from fastppt_core.prompts import compose_planning_prompt
from fastppt_core.svg import render_page_svg
from fastppt_core.visual import render_visual_preview
from fastppt_core.version import SCHEMA_VERSION, VERSION, __version__
from fastppt_ppt_master import ConversionRequest, PptMasterAdapter

from .artifacts import ArtifactStore
from .config import RuntimeSettings
from .store import MetadataStore


PLAN_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "workflowMode": {"type": "string", "enum": [item.value for item in WorkflowMode]},
        "targetScope": {"type": "string", "enum": [item.value for item in TargetScope]},
        "affectedPageIds": {"type": "array", "items": {"type": "string"}},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string"},
                    "target": {"type": "string"},
                    "value": {},
                    "factId": {"type": "string"},
                    "constraint": {"type": "string"},
                },
                "required": ["kind"],
                "additionalProperties": False,
            },
        },
        "pageDelta": {"type": "object"},
        "factImpact": {"type": "object"},
        "unsupported": {"type": "array", "items": {"type": "string"}},
        "requiresConfirmation": {"type": "boolean"},
        "confirmationReasons": {"type": "array", "items": {"type": "string"}},
        "estimatedUsage": {"type": "object"},
    },
    "required": [
        "workflowMode",
        "targetScope",
        "affectedPageIds",
        "changes",
        "pageDelta",
        "factImpact",
        "unsupported",
        "requiresConfirmation",
        "confirmationReasons",
        "estimatedUsage",
    ],
    "additionalProperties": False,
}


class NotFoundError(LookupError):
    pass


class ConflictError(RuntimeError):
    pass


class ApplicationService:
    def __init__(
        self,
        settings: RuntimeSettings,
        store: MetadataStore,
        artifacts: ArtifactStore,
        *,
        adapter: PptMasterAdapter | None = None,
        harness: AgentHarness | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.artifacts = artifacts
        self.adapter = adapter or PptMasterAdapter(settings.repository_root)
        self.harness = harness or AgentHarness()

    def _project(self, owner_id: str, project_id: str) -> dict[str, Any]:
        project = self.store.get_project(owner_id, project_id)
        if not project:
            raise NotFoundError("Project not found")
        return project

    def _record_artifact(self, project_id: str, kind: str, content: bytes, media_type: str) -> dict[str, Any]:
        object_id = new_id("artifact")
        stored = self.artifacts.put(project_id, object_id, content)
        return self.store.add_artifact(project_id, kind, stored.storage_key, stored.sha256, stored.size_bytes, media_type)

    def _artifact_bytes(self, project_id: str, artifact_id: str) -> bytes:
        artifact = self.store.get_artifact(project_id, artifact_id)
        if not artifact:
            raise NotFoundError("Artifact not found")
        with self.artifacts.open(artifact["storage_key"]) as handle:
            content = handle.read()
        if hashlib.sha256(content).hexdigest() != artifact["sha256"]:
            raise ConflictError("Artifact hash verification failed")
        return content

    def _image_data_uri(self, project_id: str, artifact_id: str | None) -> str | None:
        if not artifact_id:
            return None
        artifact = self.store.get_artifact(project_id, artifact_id)
        if not artifact or not str(artifact["media_type"]).startswith("image/"):
            raise ConflictError("Image change references an unregistered image artifact")
        encoded = base64.b64encode(self._artifact_bytes(project_id, artifact_id)).decode("ascii")
        return f"data:{artifact['media_type']};base64,{encoded}"

    def _render_contract_svg(self, project_id: str, contract: PageContract, body: str, page_number: int) -> bytes:
        image_id = contract.image_artifact_ids[0] if contract.image_artifact_ids else None
        return render_page_svg(
            contract.title,
            body,
            page_number=page_number,
            page_role=contract.page_type.value if contract.page_type != PageType.OTHER else "content",
            accent=contract.accent_color,
            background=contract.background_color,
            layout=contract.layout_intent,
            hierarchy=contract.hierarchy_style,
            image_data_uri=self._image_data_uri(project_id, image_id),
        ).encode("utf-8")

    def _render_contract_visual(self, project_id: str, contract: PageContract, body: str, page_number: int) -> bytes:
        image_content = self._artifact_bytes(project_id, contract.image_artifact_ids[0]) if contract.image_artifact_ids else None
        return render_visual_preview(contract.title, body, page_number=page_number, accent=contract.accent_color, background=contract.background_color, layout=contract.layout_intent, image_content=image_content)

    @staticmethod
    def _clean_project_name(name: Any) -> str:
        if not isinstance(name, str):
            raise ValueError("Project name must be text")
        clean = " ".join(name.split())
        if not clean or len(clean) > 120:
            raise ValueError("Project name must contain 1 to 120 characters")
        return clean

    @staticmethod
    def _body_contract_fields(body: Any) -> tuple[str, tuple[str, ...]]:
        """Keep the short conclusion and the complete, line-preserving body."""
        normalized = str(body or "").strip()
        lines = tuple(normalized.splitlines())
        conclusion = next((line.strip() for line in lines if line.strip()), normalized)
        return conclusion[:300], lines

    @staticmethod
    def _contract_body(contract: PageContract) -> str:
        return "\n".join(contract.compressible_content) if contract.compressible_content else contract.conclusion

    @staticmethod
    def _usage_reservation(settings: RuntimeSettings) -> tuple[dict[str, Any], dict[str, Any]]:
        price = {"amount": "unknown", "currency": "CNY", "source": "runtime_configuration"}
        reserved = {"requests": 1, "amount": "unknown", "currency": "CNY"}
        if settings.agent.backend.value == "deterministic_test":
            price["amount"] = 0
            reserved["amount"] = 0
        return price, reserved

    async def _run_agent(self, project_id: str, request: AgentRequest) -> tuple[Any, str]:
        self.settings.agent.validate(production=self.settings.production)
        request_id = new_id("request")
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(
            project_id,
            None,
            request_id,
            self.settings.agent.backend.value,
            self.settings.agent.model,
            price,
            reserved,
        )
        self.store.update_usage(request_id, "submitted")
        try:
            result = await self.harness.run(self.settings.agent, request, production=self.settings.production)
        except AgentError as exc:
            self.store.update_usage(request_id, "submission_unknown", error=exc.__class__.__name__)
            raise
        except Exception as exc:
            self.store.update_usage(request_id, "failed", error=exc.__class__.__name__)
            raise
        settled = {"usage": result.usage or {}, "amount": 0 if self.settings.agent.backend.value == "deterministic_test" else "unknown", "currency": "CNY"}
        self.store.update_usage(request_id, "settled", settled=settled)
        return result, request_id

    def create_project(self, owner_id: str, name: str) -> dict[str, Any]:
        clean = self._clean_project_name(name)
        project = self.store.create_project(owner_id, clean)
        self.store.audit(owner_id, "project.create", project_id=project["project_id"], entity_type="project", entity_id=project["project_id"])
        return project

    def update_project(self, owner_id: str, project_id: str, *, name: str | None = None, status: str | None = None) -> dict[str, Any]:
        self._project(owner_id, project_id)
        clean_name = self._clean_project_name(name) if name is not None else None
        if status not in {None, "draft", "processing", "ready", "degraded", "failed", "archived"}:
            raise ValueError("Invalid project status")
        updated = self.store.update_project(owner_id, project_id, name=clean_name, status=status)
        if not updated:
            raise NotFoundError("Project not found")
        self.store.audit(owner_id, "project.update", project_id=project_id, entity_type="project", entity_id=project_id, detail={"status": status, "renamed": name is not None})
        return updated

    def copy_project(self, owner_id: str, project_id: str) -> dict[str, Any]:
        source = self._project(owner_id, project_id)
        copied = self.create_project(owner_id, f"{source['name']} Copy")
        drafts: list[dict[str, str]] = []
        for page in self.store.list_pages(project_id):
            contract = self._page_contract(project_id, page)
            drafts.append(
                {
                    "title": contract.title,
                    "body": self._contract_body(contract),
                    "page_type": contract.page_type.value,
                    "layout_intent": contract.layout_intent,
                    "hierarchy_style": contract.hierarchy_style,
                    "accent_color": contract.accent_color,
                    "background_color": contract.background_color,
                }
            )
        if drafts:
            self.materialize_pages(owner_id, copied["project_id"], drafts)
        self.store.audit(owner_id, "project.copy", project_id=copied["project_id"], entity_type="project", entity_id=copied["project_id"], detail={"source_project_id": project_id})
        return self.store.get_project(owner_id, copied["project_id"]) or copied

    def ingest_document(self, owner_id: str, project_id: str, file_name: str, content: bytes) -> dict[str, Any]:
        self._project(owner_id, project_id)
        safe_name = safe_file_name(file_name)
        digest = hashlib.sha256(content).hexdigest()
        existing = self.store.document_by_hash(project_id, digest)
        if existing:
            return {**existing, "deduplicated": True}
        suffix = Path(safe_name).suffix.casefold()
        snapshot = self._record_artifact(project_id, "source", content, MEDIA_TYPES[suffix])
        document = self.store.add_document(
            project_id,
            safe_name,
            MEDIA_TYPES[suffix],
            digest,
            len(content),
            snapshot["artifact_id"],
            owner_id,
            "parsing",
        )
        self.store.emit_event("document.queued", project_id=project_id, payload={"document_id": document["document_id"]})
        if self.settings.production:
            self.store.update_document_parse(project_id, document["document_id"], "queued", None, None)
            self.store.enqueue_job(
                project_id,
                "parse_document",
                {"owner_id": owner_id, "document_id": document["document_id"]},
                f"parse:{document['document_id']}:{digest}",
            )
            return self.store.get_document(project_id, document["document_id"]) or document
        return self.parse_document_record(owner_id, project_id, document["document_id"])

    def parse_document_record(self, owner_id: str, project_id: str, document_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        document = self.store.get_document(project_id, document_id)
        if not document:
            raise NotFoundError("Document not found")
        if document["parse_status"] in {"ready", "warning"}:
            return document
        content = self._artifact_bytes(project_id, document["artifact_id"])
        try:
            parsed = parse_document(document["file_name"], content)
        except DocumentError as exc:
            self.store.update_document_parse(project_id, document["document_id"], "failed", None, str(exc))
            self.store.emit_event("document.failed", project_id=project_id, payload={"document_id": document["document_id"], "reason": str(exc)})
            return self.store.get_document(project_id, document["document_id"]) or document
        status = "warning" if parsed.warnings else "ready"
        self.store.replace_document_facts(
            project_id,
            document["document_id"],
            [
                {
                    "kind": fact.kind,
                    "value": fact.value,
                    "normalized_value": fact.normalized_value,
                    "source_locator": fact.source_locator,
                    "confidence": fact.confidence,
                    "conflict_key": fact.conflict_key,
                }
                for fact in parsed.facts
            ],
        )
        conflicts = self.store.rebuild_fact_conflicts(project_id)
        unresolved = [item for item in conflicts if item["status"] == "detected"]
        if unresolved:
            status = "blocked"
            for conflict in unresolved:
                self.store.emit_event("conflict.detected", project_id=project_id, payload={"conflict_id": conflict["conflict_id"], "kind": conflict["kind"], "fact_ids": conflict["fact_ids"]})
        self.store.update_document_parse(project_id, document["document_id"], status, parsed.summary, None)
        self.store.emit_event("document.ready" if status != "blocked" else "plan.blocked", project_id=project_id, payload={"document_id": document["document_id"], "warnings": list(parsed.warnings), "conflict_count": len(unresolved)})
        self.store.audit(owner_id, "document.ingest", project_id=project_id, entity_type="document", entity_id=document["document_id"], detail={"sha256": document["sha256"], "size_bytes": len(content), "status": status})
        return self.store.get_document(project_id, document["document_id"]) or document

    def list_fact_governance(self, owner_id: str, project_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        return {"facts": self.store.list_facts(project_id), "conflicts": self.store.list_fact_conflicts(project_id)}

    def set_fact_locked(self, owner_id: str, project_id: str, fact_id: str, locked: bool) -> dict[str, Any]:
        self._project(owner_id, project_id)
        fact = self.store.set_fact_locked(project_id, fact_id, locked)
        if not fact:
            raise NotFoundError("Fact not found")
        self.store.audit(owner_id, "fact.lock" if locked else "fact.unlock", project_id=project_id, entity_type="fact", entity_id=fact_id)
        return fact

    def resolve_fact_conflict(self, owner_id: str, project_id: str, conflict_id: str, resolution: str, fact_ids: list[str]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        conflict = self.store.resolve_fact_conflict(project_id, conflict_id, resolution, fact_ids)
        if not conflict:
            raise NotFoundError("Fact conflict not found")
        if not any(item["status"] == "detected" for item in self.store.list_fact_conflicts(project_id)):
            for document in self.store.list_documents(project_id):
                if document["parse_status"] == "blocked":
                    self.store.update_document_parse(project_id, document["document_id"], "ready", document.get("summary"), None)
        self.store.emit_event("conflict.resolved", project_id=project_id, payload={"conflict_id": conflict_id, "resolution": resolution, "fact_ids": conflict["resolved_fact_ids"]})
        self.store.audit(owner_id, "conflict.resolve", project_id=project_id, entity_type="fact_conflict", entity_id=conflict_id, detail={"resolution": resolution, "fact_ids": conflict["resolved_fact_ids"]})
        return conflict

    def ingest_image_asset(self, owner_id: str, project_id: str, file_name: str, role: str, content: bytes, media_type: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        roles = {"finished_slide", "content_reference", "visual_reference", "layout_reference", "color_reference", "edit_target", "local_asset"}
        if role not in roles:
            raise ValueError("Image role is invalid")
        clean_name = Path(file_name).name
        if clean_name != file_name or not clean_name or len(clean_name) > 180:
            raise ValueError("A safe image filename is required")
        media_types = {"image/png", "image/jpeg", "image/webp"}
        if media_type not in media_types or not content or len(content) > 25 * 1024 * 1024:
            raise ValueError("Supported image assets are PNG, JPEG, and WebP up to 25 MB")
        try:
            from PIL import Image

            with Image.open(io.BytesIO(content)) as image:
                image.verify()
                detected = f"image/{str(image.format).casefold()}"
        except Exception as exc:
            raise ValueError("Image asset content is invalid") from exc
        if detected == "image/jpg":
            detected = "image/jpeg"
        if detected != media_type:
            raise ValueError("Image media type does not match its content")
        artifact = self._record_artifact(project_id, "image", content, media_type)
        asset = self.store.add_project_asset(project_id, artifact["artifact_id"], clean_name, role, media_type, artifact["sha256"], owner_id)
        self.store.audit(owner_id, "asset.ingest", project_id=project_id, entity_type="asset", entity_id=asset["asset_id"], detail={"role": role, "sha256": artifact["sha256"]})
        return asset

    def create_session(self, owner_id: str, project_id: str, workflow_mode: str, source_document_ids: list[str]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        mode = WorkflowMode(workflow_mode)
        known = {item["document_id"] for item in self.store.list_documents(project_id)}
        if set(source_document_ids).difference(known):
            raise ValueError("Session references an unknown document")
        return self.store.create_work_session(project_id, mode.value, source_document_ids, owner_id)

    def _drafts_from_session(self, project_id: str, session: dict[str, Any]) -> list[dict[str, str]]:
        drafts: list[dict[str, str]] = []
        for document_id in session["source_document_ids"]:
            document = self.store.get_document(project_id, document_id)
            if not document or document["parse_status"] not in {"ready", "warning"}:
                raise ConflictError("All source documents must be parsed before planning")
            content = self._artifact_bytes(project_id, document["artifact_id"])
            parsed = parse_document(document["file_name"], content)
            drafts.extend(page_drafts_from_markdown(parsed.text))
        return drafts[:100]

    def create_generation_plan(
        self,
        owner_id: str,
        project_id: str,
        session_id: str,
        page_drafts: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        self._project(owner_id, project_id)
        unresolved = [item for item in self.store.list_fact_conflicts(project_id) if item["status"] == "detected"]
        if unresolved:
            self.store.emit_event("plan.blocked", project_id=project_id, session_id=session_id, payload={"reason": "fact_conflicts", "conflict_ids": [item["conflict_id"] for item in unresolved]})
            raise ConflictError("Resolve all detected fact conflicts before planning")
        session = self.store.get_work_session(project_id, session_id)
        if not session:
            raise NotFoundError("Work session not found")
        if page_drafts is None:
            page_drafts = self._drafts_from_session(project_id, session)
        source_hashes = tuple(
            document["sha256"]
            for document_id in session["source_document_ids"]
            if (document := self.store.get_document(project_id, document_id))
        )
        cleaned: list[dict[str, Any]] = []
        for index, item in enumerate(page_drafts):
            title = " ".join(str(item.get("title", "")).split())
            body = str(item.get("body", "")).strip()
            if not title or len(title) > 160 or len(body) > 5000:
                raise ValueError(f"Page draft {index + 1} is invalid")
            cleaned.append({"page_draft_id": f"draft_{index + 1:03d}", "order_index": index, "title": title, "body": body, "page_type": str(item.get("page_type") or ("cover" if index == 0 else "content")), "source_hashes": list(source_hashes)})
        if not cleaned:
            raise ValueError("At least one page draft is required")
        plan = {
            "workflowMode": session["workflow_mode"],
            "targetScope": "global",
            "affectedPageIds": [],
            "changes": [{"kind": "basic_structure_change", "target": "deck", "value": "create_pages"}],
            "pageDelta": {"add": [item["page_draft_id"] for item in cleaned], "remove": [], "split": [], "merge": []},
            "factImpact": {"added": [], "removed": [], "changed": []},
            "unsupported": [],
            "requiresConfirmation": True,
            "confirmationReasons": ["new_deck", "page_count_change", "multi_page_scope"],
            "estimatedUsage": {"imageUnits": 0, "amount": "unknown", "currency": "CNY"},
            "pageDrafts": cleaned,
            "representativeDraftIds": [item["page_draft_id"] for item in cleaned[: min(2, len(cleaned))]],
            "generationStage": "awaiting_plan_confirmation",
            "nextAction": "confirm_plan",
        }
        created = self.store.create_plan(project_id, session_id, plan, True, owner_id)
        self.store.emit_event("plan.created", project_id=project_id, session_id=session_id, payload={"plan_id": created["plan_id"]})
        self.store.emit_event("confirmation.required", project_id=project_id, session_id=session_id, payload={"plan_id": created["plan_id"], "reasons": plan["confirmationReasons"]})
        return created

    def confirm_generation_plan(self, owner_id: str, project_id: str, plan_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] == "cancelled":
            raise ConflictError("Cancelled plan cannot be confirmed")
        drafts = plan["structured_plan"]["pageDrafts"]
        existing = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
        if plan["status"] == "completed":
            if len(existing) != len(drafts):
                raise ConflictError("Completed plan is missing materialized pages")
            return {"plan_id": plan_id, "status": "completed", "pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in existing]}
        if plan["status"] == "awaiting_sample_confirmation":
            return {"plan_id": plan_id, "status": "awaiting_sample_confirmation", "sample_pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in existing], "next_action": "confirm_samples"}
        representative_ids = set(plan["structured_plan"].get("representativeDraftIds") or [drafts[0]["page_draft_id"]])
        representative_drafts = [draft for draft in drafts if draft["page_draft_id"] in representative_ids]
        if len(existing) > len(representative_drafts):
            raise ConflictError("Plan sample state is inconsistent")
        self.store.update_plan(project_id, plan_id, status="generating_samples", confirmed=True)
        self.materialize_pages(owner_id, project_id, representative_drafts[len(existing) :], operation_id=plan_id, preview_only=True)
        materialized = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
        structured = dict(plan["structured_plan"])
        structured.update({"generationStage": "awaiting_sample_confirmation", "nextAction": "confirm_samples", "samplePageIds": [item["page_id"] for item in materialized]})
        self.store.update_plan(project_id, plan_id, status="awaiting_sample_confirmation", structured_plan=structured, confirmed=True)
        self.store.emit_event("confirmation.required", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id, "reasons": ["representative_page_confirmation"], "page_ids": structured["samplePageIds"]})
        return {"plan_id": plan_id, "status": "awaiting_sample_confirmation", "sample_pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in materialized], "next_action": "confirm_samples"}

    def confirm_generation_samples(self, owner_id: str, project_id: str, plan_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] == "completed":
            existing = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
            return {"plan_id": plan_id, "status": "completed", "pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in existing]}
        if plan["status"] != "awaiting_sample_confirmation":
            raise ConflictError("Representative pages are not awaiting confirmation")
        self.store.update_plan(project_id, plan_id, status="generating_pages", confirmed=True)
        self._reconstruct_sample_pages(owner_id, project_id, plan_id)
        drafts = plan["structured_plan"]["pageDrafts"]
        representative_ids = set(plan["structured_plan"].get("representativeDraftIds") or [])
        remaining = [draft for draft in drafts if draft["page_draft_id"] not in representative_ids]
        self.materialize_pages(owner_id, project_id, remaining, operation_id=plan_id)
        pages = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
        if len(pages) != len(drafts):
            raise ConflictError("Plan did not materialize every page")
        structured = dict(plan["structured_plan"])
        structured.update({"generationStage": "completed", "nextAction": "export"})
        self.store.update_plan(project_id, plan_id, status="completed", structured_plan=structured, confirmed=True)
        pages = [
            {
                "page_id": item["page_id"],
                "version_id": item["current_version_id"],
                "order_index": item["order_index"],
                "page_type": item["page_type"],
            }
            for item in pages
        ]
        return {"plan_id": plan_id, "status": "completed", "pages": pages}

    def cancel_plan(self, owner_id: str, project_id: str, plan_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] == "completed":
            raise ConflictError("Completed plan cannot be cancelled")
        if plan["status"] == "cancelled":
            return {"plan_id": plan_id, "status": "cancelled"}
        archived_pages = self.store.archive_pages_for_operation(project_id, plan_id)
        if not self.store.update_plan_status(project_id, plan_id, "cancelled"):
            raise NotFoundError("Plan not found")
        self.store.emit_event("plan.cancelled", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id, "archived_page_count": archived_pages})
        return {"plan_id": plan_id, "status": "cancelled", "archived_page_count": archived_pages}

    def _draft_fact_ids(self, project_id: str, draft: dict[str, Any], facts: list[dict[str, Any]]) -> list[str]:
        content = f"{draft.get('title', '')}\n{draft.get('body', '')}".casefold()
        resolved_conflicts = {
            fact_id: set(conflict.get("resolved_fact_ids") or [])
            for conflict in self.store.list_fact_conflicts(project_id)
            if conflict.get("status") == "resolved"
            for fact_id in conflict.get("fact_ids", [])
        }
        selected = []
        for fact in facts:
            value = str(fact.get("value") or "").casefold()
            normalized = str(fact.get("normalized_value") or "").casefold()
            allowed = resolved_conflicts.get(fact["fact_id"])
            if allowed is not None and fact["fact_id"] not in allowed:
                continue
            if value and value in content or normalized and normalized in content:
                selected.append(fact["fact_id"])
        return list(dict.fromkeys(selected))

    def materialize_pages(self, owner_id: str, project_id: str, drafts: list[dict[str, Any]], *, operation_id: str | None = None, preview_only: bool = False) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        existing = self.store.list_pages(project_id)
        facts = self.store.list_facts(project_id)
        assets = [item for item in self.store.list_project_assets(project_id) if item["role"] in {"content_reference", "visual_reference", "local_asset"}]
        created: list[dict[str, Any]] = []
        for offset, draft in enumerate(drafts, len(existing)):
            page_id = new_id("page")
            fact_ids = self._draft_fact_ids(project_id, draft, facts)
            try:
                page_type = PageType(str(draft.get("page_type", "content")))
            except ValueError:
                page_type = PageType.OTHER
            conclusion, compressible_content = self._body_contract_fields(draft.get("body", ""))
            contract = PageContract(
                page_id=page_id,
                page_type=page_type,
                purpose="Present the approved page draft",
                title=str(draft["title"]),
                conclusion=conclusion,
                required_fact_ids=tuple(fact_ids),
                compressible_content=compressible_content,
                visual_direction="quiet editorial workspace",
                layout_intent=str(draft.get("layout_intent") or "title_body"),
                hierarchy_style=str(draft.get("hierarchy_style") or "standard"),
                accent_color=str(draft.get("accent_color") or "#D14D3F"),
                background_color=str(draft.get("background_color") or "#F7F8FA"),
                image_artifact_ids=(assets[offset % len(assets)]["artifact_id"],) if assets else (),
                source_hashes=tuple(str(value) for value in draft.get("source_hashes", [])),
            )
            contract_content = json.dumps(asdict(contract), ensure_ascii=False, indent=2, default=str).encode("utf-8")
            contract_artifact = self._record_artifact(project_id, "contract", contract_content, "application/json")
            svg = self._render_contract_svg(project_id, contract, str(draft.get("body", "")), offset + 1)
            quick_artifact = self._record_artifact(project_id, "quick_preview", svg, "image/svg+xml")
            visual = self._render_contract_visual(project_id, contract, str(draft.get("body", "")), offset + 1)
            visual_artifact = self._record_artifact(project_id, "visual_preview", visual, "image/png")
            svg_artifact = None if preview_only else self._record_artifact(project_id, "svg", svg, "image/svg+xml")
            page = self.store.create_page_with_version(
                project_id,
                offset,
                page_type.value,
                fact_ids,
                {
                    "operation_id": operation_id,
                    "page_contract_artifact_id": contract_artifact["artifact_id"],
                    "quick_preview_artifact_id": quick_artifact["artifact_id"],
                    "visual_preview_artifact_id": visual_artifact["artifact_id"],
                    "svg_artifact_id": svg_artifact["artifact_id"] if svg_artifact else None,
                    "editable_level": "visual" if preview_only else "native_structure",
                    "status": "previewing" if preview_only else "ready",
                    "qa": {"quick_preview": "available", "visual_preview": "available", "visual_preview_media_type": "image/png", "representative": preview_only, "authoritative_render": "pending" if self.settings.render_backend == "powerpoint" else "unavailable", "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "full_slide_raster": False},
                },
                page_id=page_id,
            )
            self.store.emit_event("preview.quick.ready", project_id=project_id, page_id=page_id, version_id=page["version_id"], payload={"artifact_id": quick_artifact["artifact_id"]})
            self.store.emit_event("preview.visual.ready", project_id=project_id, page_id=page_id, version_id=page["version_id"], payload={"artifact_id": visual_artifact["artifact_id"], "representative": preview_only})
            self.store.emit_event("page.version.created", project_id=project_id, page_id=page_id, version_id=page["version_id"])
            created.append(page)
        self.store.update_project(owner_id, project_id, status="degraded" if self.settings.render_backend == "unavailable" else "processing")
        return created

    def _reconstruct_sample_pages(self, owner_id: str, project_id: str, operation_id: str) -> None:
        self._project(owner_id, project_id)
        pages = [page for page in self.store.list_pages(project_id) if page["version_status"] == "previewing" and page.get("operation_id") == operation_id]
        for page in pages:
            contract = self._page_contract(project_id, page)
            # The approved representative receives a fresh editable SVG artifact.
            # It is intentionally rendered from the page contract instead of
            # promoting the quick-preview bytes to the final reconstruction.
            svg = self._render_contract_svg(project_id, contract, self._contract_body(contract), int(page["order_index"]) + 1)
            svg_artifact = self._record_artifact(project_id, "svg", svg, "image/svg+xml")
            qa = dict(page.get("qa") or {}) | {
                "representative": True,
                "representative_approved": True,
                "reconstruction": "complete",
            }
            version = self.store.create_page_version(project_id, page["page_id"], {"operation_id": operation_id, "page_contract_artifact_id": page["page_contract_artifact_id"], "quick_preview_artifact_id": page["quick_preview_artifact_id"], "visual_preview_artifact_id": page["visual_preview_artifact_id"], "svg_artifact_id": svg_artifact["artifact_id"], "editable_level": "native_structure", "status": "ready", "qa": qa})
            if version:
                self.store.emit_event("page.version.created", project_id=project_id, operation_id=operation_id, page_id=page["page_id"], version_id=version["version_id"], payload={"representative_approved": True})

    def _page_contract(self, project_id: str, page: dict[str, Any]) -> PageContract:
        payload = json.loads(self._artifact_bytes(project_id, page["page_contract_artifact_id"]).decode("utf-8"))
        payload["page_type"] = PageType(payload["page_type"])
        for key in ("required_fact_ids", "verbatim_text", "compressible_content", "prohibited_content", "image_artifact_ids", "source_hashes"):
            payload[key] = tuple(payload.get(key, ()))
        return PageContract(**payload)

    async def create_edit_operation_async(
        self,
        owner_id: str,
        project_id: str,
        instruction: str,
        target_scope: str,
        page_ids: list[str],
        workflow_mode: str = "pptx_improve",
    ) -> dict[str, Any]:
        self._project(owner_id, project_id)
        unresolved = [item for item in self.store.list_fact_conflicts(project_id) if item["status"] == "detected"]
        if unresolved:
            raise ConflictError("Resolve all detected fact conflicts before editing pages")
        scope, mode = TargetScope(target_scope), WorkflowMode(workflow_mode)
        pages = self.store.list_pages(project_id)
        known = {page["page_id"] for page in pages}
        resolved = page_ids if scope != TargetScope.GLOBAL else [page["page_id"] for page in pages]
        if set(resolved).difference(known) or not resolved:
            raise ValueError("Operation scope contains unknown or empty pages")
        selected = [page for page in pages if page["page_id"] in resolved]
        if any(page.get("version_status") == "previewing" for page in selected):
            raise ConflictError("Confirm representative pages before editing them")
        contracts = [self._page_contract(project_id, page) for page in selected]
        facts = [
            FactAnchor(
                fact_id=item["fact_id"],
                kind=item["kind"],
                value=item["value"],
                normalized_value=item["normalized_value"],
                source_document_id=item["source_document_id"],
                source_locator=item["source_locator"],
                confidence=float(item["confidence"]),
                locked=bool(item["locked"]),
            )
            for item in self.store.list_facts(project_id)
        ]
        prompt = compose_planning_prompt(instruction=instruction, workflow_mode=mode, target_scope=scope, page_contracts=contracts, facts=facts)
        prompt_artifact = self._record_artifact(project_id, "prompt", prompt.encode("utf-8"), "text/plain; charset=utf-8")
        result, usage_request_id = await self._run_agent(
            project_id,
            AgentRequest(prompt, PLAN_OUTPUT_SCHEMA, {"page_ids": resolved, "target_scope": scope.value, "workflow_mode": mode.value}),
        )
        validated = validate_plan(result.output, known)
        assets = {item["artifact_id"] for item in self.store.list_project_assets(project_id)}
        for change in result.output.get("changes", []):
            if change.get("kind") == "image_change" and change.get("value", {}).get("artifactId") not in assets:
                self.store.update_usage(usage_request_id, "released", error="unregistered_image_artifact")
                raise ConflictError("Image changes must reference an image registered in this project")
        plan_payload = result.output | {
            "requiresConfirmation": validated.requires_confirmation,
            "confirmationReasons": list(validated.confirmation_reasons),
            "_instruction": instruction,
            "_promptArtifactId": prompt_artifact["artifact_id"],
            "_agent": {"backend": result.backend, "model": result.model, "thread_id": result.thread_id, "usage": result.usage},
            "_usageRequestId": usage_request_id,
        }
        operation = self.store.create_operation(project_id, None, plan_payload)
        self.store.update_usage(usage_request_id, "settled", operation_id=operation["operation_id"])
        self.store.emit_event("operation.started" if not validated.requires_confirmation else "confirmation.required", project_id=project_id, operation_id=operation["operation_id"], payload={"status": operation["status"]})
        if not validated.requires_confirmation:
            if self.settings.production:
                self.store.enqueue_job(project_id, "execute_operation", {"owner_id": owner_id, "operation_id": operation["operation_id"]}, f"operation:{operation['operation_id']}")
                return operation | {"structured_plan": plan_payload, "queued": True}
            return self.execute_operation(owner_id, project_id, operation["operation_id"])
        return operation | {"structured_plan": plan_payload}

    def create_edit_operation(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return asyncio.run(self.create_edit_operation_async(*args, **kwargs))

    def execute_operation(self, owner_id: str, project_id: str, operation_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        operation = self.store.get_operation(project_id, operation_id)
        if not operation:
            raise NotFoundError("Operation not found")
        if operation["confirmation_required"] and not operation.get("confirmed_at"):
            raise ConflictError("Operation requires confirmation")
        if operation["status"] in {"cancelled", "rolled_back"}:
            raise ConflictError(f"Operation in {operation['status']} state cannot execute")
        existing_versions = self.store.versions_for_operation(project_id, operation_id)
        existing_by_page = {item["page_id"]: item["version_id"] for item in existing_versions}
        if operation["status"] == "completed":
            if set(existing_by_page) != set(operation["resolved_page_ids"]):
                raise ConflictError("Completed operation is missing page versions")
            return operation
        self.store.update_operation_status(project_id, operation_id, "running")
        result_versions: list[str] = [
            existing_by_page[page_id]
            for page_id in operation["resolved_page_ids"]
            if page_id in existing_by_page
        ]
        instruction = operation["structured_plan"].get("_instruction", "")
        project_facts = {item["fact_id"]: item for item in self.store.list_facts(project_id)}
        page_errors: dict[str, str] = {}
        for page_id in operation["resolved_page_ids"]:
            if page_id in existing_by_page:
                continue
            page = self.store.get_page(project_id, page_id)
            if not page:
                page_errors[page_id] = "Page is no longer available"
                continue
            try:
                contract = self._page_contract(project_id, page)
                title, body = contract.title, self._contract_body(contract)
                layout, hierarchy = contract.layout_intent, contract.hierarchy_style
                accent, background = contract.accent_color, contract.background_color
                image_ids = list(contract.image_artifact_ids)
                fact_ids = list(contract.required_fact_ids)
                executed: list[str] = []
                for index, change in enumerate(operation["structured_plan"].get("changes", [])):
                    kind, target, value = change.get("kind"), change.get("target"), change.get("value")
                    if kind == "preserve_fact":
                        fact_id = change.get("factId")
                        if fact_id not in project_facts:
                            raise ConflictError(f"Fact {fact_id} is not available")
                        if fact_id not in fact_ids:
                            fact_ids.append(fact_id)
                    elif kind == "rewrite_text":
                        if value:
                            if target == "title":
                                title = str(value)[:160]
                            elif target in {"body", "content"}:
                                body = str(value)[:5000]
                        if change.get("constraint") == "one_line":
                            hierarchy = "compact"
                    elif kind == "layout_change":
                        layout = str(value)
                    elif kind == "hierarchy_change":
                        hierarchy = str(value)
                    elif kind == "color_change":
                        if target == "accent":
                            accent = str(value)
                        elif target == "background":
                            background = str(value)
                    elif kind == "image_change":
                        artifact_id = value.get("artifactId") if isinstance(value, dict) else None
                        self._image_data_uri(project_id, artifact_id)
                        image_ids = [artifact_id]
                    else:
                        raise ConflictError(f"Unsupported executable change at index {index}: {kind}")
                    executed.append(kind)
                if len(executed) != len(operation["structured_plan"].get("changes", [])):
                    raise ConflictError("Not every structured change was executed")
                conclusion, compressible_content = self._body_contract_fields(body)
                revised = PageContract(
                    page_id=contract.page_id,
                    page_type=contract.page_type,
                    purpose=contract.purpose,
                    title=title,
                    conclusion=conclusion,
                    required_fact_ids=tuple(fact_ids),
                    verbatim_text=contract.verbatim_text,
                    compressible_content=compressible_content,
                    prohibited_content=contract.prohibited_content,
                    visual_direction=contract.visual_direction,
                    layout_intent=layout,
                    density=contract.density,
                    hierarchy_style=hierarchy,
                    accent_color=accent,
                    background_color=background,
                    image_artifact_ids=tuple(image_ids),
                    source_hashes=contract.source_hashes,
                )
                contract_artifact = self._record_artifact(project_id, "contract", json.dumps(asdict(revised), ensure_ascii=False, indent=2, default=str).encode("utf-8"), "application/json")
                svg = self._render_contract_svg(project_id, revised, self._contract_body(revised) or instruction, int(page["order_index"]) + 1)
                quick_artifact = self._record_artifact(project_id, "quick_preview", svg, "image/svg+xml")
                visual = self._render_contract_visual(project_id, revised, self._contract_body(revised) or instruction, int(page["order_index"]) + 1)
                visual_artifact = self._record_artifact(project_id, "visual_preview", visual, "image/png")
                svg_artifact = self._record_artifact(project_id, "svg", svg, "image/svg+xml")
                version = self.store.create_page_version(project_id, page_id, {"operation_id": operation_id, "page_contract_artifact_id": contract_artifact["artifact_id"], "prompt_snapshot_artifact_id": operation["structured_plan"].get("_promptArtifactId"), "quick_preview_artifact_id": quick_artifact["artifact_id"], "visual_preview_artifact_id": visual_artifact["artifact_id"], "svg_artifact_id": svg_artifact["artifact_id"], "editable_level": "native_partial" if image_ids else "native_structure", "status": "ready", "qa": {"quick_preview": "available", "visual_preview": "available", "visual_preview_media_type": "image/png", "executed_changes": executed, "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "full_slide_raster": False}})
                if not version:
                    raise ConflictError("Page version could not be created")
                self.store.set_page_fact_anchors(project_id, page_id, fact_ids)
                result_versions.append(version["version_id"])
                self.store.emit_event("preview.quick.ready", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"], payload={"artifact_id": quick_artifact["artifact_id"]})
                self.store.emit_event("preview.visual.ready", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"], payload={"artifact_id": visual_artifact["artifact_id"]})
                self.store.emit_event("page.version.created", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"])
                self.store.emit_event("operation.progress", project_id=project_id, operation_id=operation_id, page_id=page_id, payload={"completed": len(result_versions), "total": len(operation["resolved_page_ids"])})
            except Exception as exc:
                page_errors[page_id] = str(exc)
                self.store.emit_event("operation.failed", project_id=project_id, operation_id=operation_id, page_id=page_id, payload={"recoverable": True, "reason": str(exc)})
        status = "completed" if len(result_versions) == len(operation["resolved_page_ids"]) else ("partial" if result_versions else "failed")
        error = {"page_errors": page_errors, "recoverable": bool(page_errors)} if page_errors else {}
        self.store.update_operation_status(project_id, operation_id, status, result_version_ids=result_versions, error=error)
        self.store.emit_event("operation.completed" if status == "completed" else "operation.failed", project_id=project_id, operation_id=operation_id, payload={"status": status, "result_version_ids": result_versions, "page_errors": page_errors})
        return self.store.get_operation(project_id, operation_id) or operation

    def confirm_operation(self, owner_id: str, project_id: str, operation_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        operation = self.store.get_operation(project_id, operation_id)
        if not operation:
            raise NotFoundError("Operation not found")
        if operation["status"] in {"cancelled", "rolled_back"}:
            raise ConflictError(f"Operation in {operation['status']} state cannot be confirmed")
        if operation["status"] in {"completed", "partial"}:
            return operation
        if not self.store.update_operation_status(project_id, operation_id, "confirmed", confirmed=True):
            raise NotFoundError("Operation not found")
        if self.settings.production:
            job = self.store.enqueue_job(project_id, "execute_operation", {"owner_id": owner_id, "operation_id": operation_id}, f"operation:{operation_id}")
            return (self.store.get_operation(project_id, operation_id) or {}) | {"queued": True, "job_id": job["job_id"]}
        return self.execute_operation(owner_id, project_id, operation_id)

    def retry_operation(self, owner_id: str, project_id: str, operation_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        operation = self.store.get_operation(project_id, operation_id)
        if not operation:
            raise NotFoundError("Operation not found")
        if operation["status"] not in {"failed", "partial"}:
            raise ConflictError("Only failed or partial operations can be retried")
        if self.settings.production:
            retries = sum(1 for item in self.store.list_jobs(project_id) if item["kind"] == "execute_operation" and item["payload"].get("operation_id") == operation_id)
            job = self.store.enqueue_job(project_id, "execute_operation", {"owner_id": owner_id, "operation_id": operation_id}, f"operation:{operation_id}:retry:{retries + 1}")
            return operation | {"queued": True, "job_id": job["job_id"]}
        return self.execute_operation(owner_id, project_id, operation_id)

    def cancel_operation(self, owner_id: str, project_id: str, operation_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        operation = self.store.get_operation(project_id, operation_id)
        if not operation:
            raise NotFoundError("Operation not found")
        if operation["status"] in {"completed", "rolled_back"}:
            raise ConflictError(f"Operation in {operation['status']} state cannot be cancelled")
        self.store.update_operation_status(project_id, operation_id, "cancelled")
        self.store.emit_event("operation.failed", project_id=project_id, operation_id=operation_id, payload={"status": "cancelled", "recoverable": False})
        return self.store.get_operation(project_id, operation_id) or operation

    def rollback_operation(self, owner_id: str, project_id: str, operation_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        operation = self.store.get_operation(project_id, operation_id)
        if not operation:
            raise NotFoundError("Operation not found")
        restored = []
        for version_id in operation["result_version_ids"]:
            version = self.store.get_version(project_id, version_id)
            if version and version["parent_version_id"] and self.store.restore_version(project_id, version["page_id"], version["parent_version_id"]):
                restored.append(version["page_id"])
        self.store.update_operation_status(project_id, operation_id, "rolled_back")
        self.store.emit_event("operation.rolled_back", project_id=project_id, operation_id=operation_id, payload={"restored_page_ids": restored})
        return {"operation_id": operation_id, "status": "rolled_back", "restored_page_ids": restored}

    def compare_versions(self, owner_id: str, project_id: str, page_id: str, left_version_id: str, right_version_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        page = self.store.get_page(project_id, page_id)
        left = self.store.get_version(project_id, left_version_id)
        right = self.store.get_version(project_id, right_version_id)
        if not page or not left or not right or left["page_id"] != page_id or right["page_id"] != page_id:
            raise NotFoundError("Version comparison target not found")
        left_contract = json.loads(self._artifact_bytes(project_id, left["page_contract_artifact_id"]).decode("utf-8"))
        right_contract = json.loads(self._artifact_bytes(project_id, right["page_contract_artifact_id"]).decode("utf-8"))
        keys = ("title", "conclusion", "compressible_content", "required_fact_ids", "layout_intent", "hierarchy_style", "accent_color", "background_color", "image_artifact_ids")
        changes = {key: {"left": left_contract.get(key), "right": right_contract.get(key)} for key in keys if left_contract.get(key) != right_contract.get(key)}
        return {"page_id": page_id, "left": left, "right": right, "changes": changes}

    def retry_job(self, owner_id: str, project_id: str, job_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        job = self.store.retry_job(project_id, job_id)
        if not job:
            raise NotFoundError("Job not found")
        self.store.audit(owner_id, "job.retry", project_id=project_id, entity_type="job", entity_id=job_id)
        return job

    def export_project(self, owner_id: str, project_id: str) -> dict[str, Any]:
        project = self._project(owner_id, project_id)
        pages = self.store.list_pages(project_id)
        if not pages:
            raise ConflictError("Project has no pages to export")
        if any(page["version_status"] not in {"ready", "degraded"} or not page.get("svg_artifact_id") for page in pages):
            raise ConflictError("Approve representative pages and finish reconstruction before export")
        if any(item["status"] == "detected" for item in self.store.list_fact_conflicts(project_id)):
            raise ConflictError("Resolve all detected fact conflicts before export")
        version_lock = [{"page_id": page["page_id"], "version_id": page["current_version_id"]} for page in pages]
        export = self.store.create_export(project_id, version_lock)
        if self.settings.production:
            job = self.store.enqueue_job(project_id, "export_project", {"owner_id": owner_id, "export_id": export["export_id"]}, f"export:{export['export_id']}")
            return export | {"status": "queued", "job_id": job["job_id"]}
        return self.execute_export(owner_id, project_id, export["export_id"])

    def execute_export(self, owner_id: str, project_id: str, export_id: str) -> dict[str, Any]:
        project = self._project(owner_id, project_id)
        export = self.store.get_export(project_id, export_id)
        if not export:
            raise NotFoundError("Export not found")
        if export.get("artifact_id") and export["status"] in {"degraded", "validating", "ready"}:
            return export
        locked_versions: list[dict[str, Any]] = []
        for item in export["version_lock"]:
            version = self.store.get_version(project_id, item["version_id"])
            if not version or version["page_id"] != item["page_id"]:
                raise ConflictError("Export version lock references a missing page version")
            if version["status"] not in {"ready", "degraded"} or not version.get("svg_artifact_id"):
                raise ConflictError("Every representative page must be approved and reconstructed before export")
            locked_versions.append(version)
        try:
            with tempfile.TemporaryDirectory(prefix="fastppt-export-") as temp_name:
                svg_files: list[Path] = []
                for index, version in enumerate(locked_versions, 1):
                    svg_path = Path(temp_name) / f"{index:03d}.svg"
                    svg_path.write_bytes(self._artifact_bytes(project_id, version["svg_artifact_id"]))
                    svg_files.append(svg_path)
                output = self.settings.export_dir / f"{export_id}.pptx"
                result = self.adapter.convert(ConversionRequest(tuple(svg_files), output, project["name"]))
            pptx = output.read_bytes()
            artifact = self._record_artifact(project_id, "export", pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
            qa = {"product_version": VERSION, "technical_version": __version__, "schema_version": SCHEMA_VERSION, "pptx_sha256": result.pptx_sha256, "slide_count": result.slide_count, "kernel_version": result.kernel_version, "svg_qa_status": result.svg_qa_status, "svg_qa_sha256": result.svg_qa_sha256, "pptx_qa_status": result.pptx_qa_status, "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "advisories": list(result.advisories), "version_lock": export["version_lock"]}
            status = "degraded" if self.settings.render_backend == "unavailable" else "validating"
            self.store.complete_export(project_id, export_id, artifact["artifact_id"], status, qa)
            if self.settings.render_backend == "powerpoint":
                self.store.enqueue_job(project_id, "render_export", {"owner_id": owner_id, "export_id": export_id}, f"render:{export_id}", max_attempts=2)
            self.store.emit_event("export.completed", project_id=project_id, export_id=export_id, payload={"status": status, "artifact_id": artifact["artifact_id"]})
        except Exception as exc:
            self.store.complete_export(project_id, export_id, None, "failed", {"error": str(exc)})
            raise
        return self.store.get_export(project_id, export_id) or export

    def artifact_download(self, owner_id: str, project_id: str, artifact_id: str) -> tuple[bytes, str]:
        self._project(owner_id, project_id)
        artifact = self.store.get_artifact(project_id, artifact_id)
        if not artifact:
            raise NotFoundError("Artifact not found")
        return self._artifact_bytes(project_id, artifact_id), artifact["media_type"]

    def health(self) -> dict[str, Any]:
        return {
            "api": {"status": "ready"},
            "metadata_store": self.store.health(),
            "artifact_store": self.artifacts.health(),
            "queue": {"status": "ready", "backend": self.settings.queue_backend, "worker": self.store.worker_health("worker")},
            "model": self.harness.probe(self.settings.agent, production=self.settings.production),
            "render_worker": self.store.worker_health("render") | {"backend": self.settings.render_backend},
            "kernel": self.adapter.probe(),
            "deployment": self.settings.public_summary(),
        }
