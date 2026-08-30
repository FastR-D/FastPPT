"""Shared FastPPT application service used by local and server APIs."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import tempfile
import ipaddress
import mimetypes
import re
from dataclasses import asdict, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from fastppt_agent_harness import AgentBackend, AgentError, AgentHarness, AgentRequest, DeterministicImageAdapter, ImageAdapterError, ImageRequest, OpenAIImageAdapter
from fastppt_core.agent_contracts import STAGE_OUTPUT_SCHEMAS, validate_stage_output
from fastppt_core.contracts import ContractValidationError, validate_page_contract, validate_plan, validate_reconstruction_manifest, validate_transition, IMAGE_RUN_TRANSITIONS
from fastppt_core.content_exports import render_content_plan
from fastppt_core.documents import MEDIA_TYPES, DocumentError, extract_pptx_import_manifest, page_drafts_from_markdown, parse_document, safe_file_name
from fastppt_core.design import design_snapshot, pack_content_hash
from fastppt_core.ids import new_id
from fastppt_core.models import AgentRole, FactAnchor, PageContract, PageType, TargetScope, WorkflowMode
from fastppt_core.prompts import compose_planning_prompt
from fastppt_core.prompting import canonical_json, detect_untrusted_source_instructions, estimate_tokens, provider_prompt, redact_sensitive, sha256_json
from fastppt_core.svg import render_page_svg
from fastppt_core.v2 import CompiledPageIR, DesignSnapshot, V2ContractError
from fastppt_core.visual import render_visual_preview
from fastppt_core.version import SCHEMA_VERSION, VERSION, __version__
from fastppt_ppt_master import ConversionRequest, PptMasterAdapter

from .artifacts import ArtifactStore
from .config import RuntimeSettings
from .context import ContextResolver
from .design_packs import install_bundle, validate_bundle
from .store import MetadataStore
from .task1 import Task1Runner, task1_ir_contract_fingerprint, task1_preview_artifact_id, validate_task1_request, validate_task1_token


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
        self.context_resolver = ContextResolver(store, self._artifact_bytes)
        self.task1_runner = Task1Runner()
        self.task1_startup_reconciliation = self._reconcile_task1_on_startup()

    def _project(self, owner_id: str, project_id: str) -> dict[str, Any]:
        project = self.store.get_project(owner_id, project_id)
        if not project:
            raise NotFoundError("Project not found")
        return project

    def _record_artifact(self, project_id: str, kind: str, content: bytes, media_type: str) -> dict[str, Any]:
        object_id = new_id("artifact")
        stored = self.artifacts.put(project_id, object_id, content)
        return self.store.add_artifact(project_id, kind, stored.storage_key, stored.sha256, stored.size_bytes, media_type)

    def _persist_task1_descriptor(
        self,
        project_id: str,
        output_dir: Path,
        descriptor: Mapping[str, Any],
        *,
        kind: str,
        expected_artifact_id: str | None = None,
    ) -> dict[str, Any]:
        """Hash-verify and register one immutable task-one Artifact."""
        relative = Path(str(descriptor.get("path") or ""))
        if not relative.parts or relative.is_absolute() or ".." in relative.parts:
            raise ConflictError("Task-one artifact path is invalid")
        root = output_dir.resolve()
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ConflictError("Task-one artifact path escapes its output directory") from exc
        if not path.is_file():
            raise ConflictError("Task-one artifact is missing")
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        expected = str(descriptor.get("sha256") or "")
        if expected != f"sha256:{digest}":
            raise ConflictError("Task-one artifact hash verification failed")
        if int(descriptor.get("size_bytes") or -1) != len(content):
            raise ConflictError("Task-one artifact byte count does not match its descriptor")
        artifact_id = str(descriptor.get("artifact_id") or "")
        if not artifact_id or expected_artifact_id and artifact_id != expected_artifact_id:
            raise ConflictError("Task-one artifact identity does not match its request")
        existing = self.store.get_artifact(project_id, artifact_id)
        if existing:
            if str(existing.get("sha256") or "") != digest or int(existing.get("size_bytes") or -1) != len(content):
                raise ConflictError("Task-one artifact ID already refers to different bytes")
            try:
                self._artifact_bytes(project_id, artifact_id)
            except Exception as exc:
                raise ConflictError("Task-one artifact record points to missing bytes") from exc
            return existing
        stored = self.artifacts.put(project_id, artifact_id, content)
        if stored.sha256 != digest or stored.size_bytes != len(content):
            raise ConflictError("ArtifactStore returned an inconsistent task-one artifact")
        return self.store.add_artifact(
            project_id,
            kind,
            stored.storage_key,
            stored.sha256,
            stored.size_bytes,
            str(descriptor.get("media_type") or "application/octet-stream"),
            artifact_id=artifact_id,
        )

    @staticmethod
    def _verify_task1_record_hash(record: Mapping[str, Any], name: str) -> None:
        expected = str(record.get("content_hash") or "")
        actual = sha256_json({key: value for key, value in record.items() if key != "content_hash"})
        if not expected or expected != actual:
            raise ConflictError(f"Task-one {name} content hash verification failed")

    def _validate_task1_descriptor(
        self,
        project_id: str,
        output_dir: Path,
        descriptor: Mapping[str, Any],
        *,
        expected_artifact_id: str,
    ) -> bytes:
        """Validate descriptor identity, local bytes and any existing Artifact without writing."""
        relative = Path(str(descriptor.get("path") or ""))
        if not relative.parts or relative.is_absolute() or ".." in relative.parts:
            raise ConflictError("Task-one artifact path is invalid")
        root = output_dir.resolve()
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ConflictError("Task-one artifact path escapes its output directory") from exc
        if not path.is_file():
            raise ConflictError("Task-one artifact is missing")
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if descriptor.get("artifact_id") != expected_artifact_id:
            raise ConflictError("Task-one artifact identity does not match its request")
        if descriptor.get("sha256") != f"sha256:{digest}":
            raise ConflictError("Task-one artifact hash verification failed")
        if int(descriptor.get("size_bytes") or -1) != len(content):
            raise ConflictError("Task-one artifact byte count does not match its descriptor")
        existing = self.store.get_artifact(project_id, expected_artifact_id)
        if existing:
            if str(existing.get("sha256") or "") != digest or int(existing.get("size_bytes") or -1) != len(content):
                raise ConflictError("Task-one artifact ID already refers to different bytes")
            try:
                if self._artifact_bytes(project_id, expected_artifact_id) != content:
                    raise ConflictError("Task-one ArtifactStore bytes do not match the manifest")
            except ConflictError:
                raise
            except Exception as exc:
                raise ConflictError("Task-one artifact record points to missing bytes") from exc
        return content

    def _validate_task1_manifest(
        self,
        project_id: str,
        idempotency_key: str,
        output_dir: Path,
        manifest: Mapping[str, Any],
    ) -> tuple[dict[str, Any], list[tuple[dict[str, Any], dict[str, Any]]]]:
        """Validate all immutable nested records and links before persistence starts."""
        if manifest.get("project_id") != project_id:
            raise ConflictError("Task-one manifest belongs to another project")
        if manifest.get("schema_version") != "2.0.0":
            raise ConflictError("Task-one manifest schema version is invalid")
        if manifest.get("status") != "completed":
            raise ConflictError("Task-one manifest status is invalid")
        self._verify_task1_record_hash(manifest, "manifest")

        snapshot_payload = manifest.get("design_snapshot")
        checkpoint = manifest.get("recovery_checkpoint")
        export_snapshot = manifest.get("export_snapshot")
        export_attempt = manifest.get("export_attempt")
        if not all(isinstance(item, Mapping) for item in (snapshot_payload, checkpoint, export_snapshot, export_attempt)):
            raise ConflictError("Task-one manifest is missing immutable persistence records")
        try:
            snapshot = DesignSnapshot.from_dict(snapshot_payload, verify_hash=True)
        except V2ContractError as exc:
            raise ConflictError(f"Task-one DesignSnapshot validation failed: {exc}") from exc
        if manifest.get("mode") != snapshot.mode:
            raise ConflictError("Task-one manifest mode does not match its DesignSnapshot")
        if snapshot.mode == "style_template" and not (
            snapshot.preview_artifact_hash and snapshot.confirmed_by and snapshot.confirmed_at
        ):
            raise ConflictError("Task-one style/template DesignSnapshot is not confirmed")

        fixture_lock = self.task1_runner.fixture["lock"]
        if manifest.get("fixture_lock_hash") != fixture_lock.get("content_hash"):
            raise ConflictError("Task-one manifest fixture lock hash is invalid")
        expected_fixture_irs = list(self.task1_runner.fixture.get("expected_irs") or ())
        expected_fixture_hashes = [str(item.get("content_hash") or "") for item in expected_fixture_irs]
        if list(manifest.get("expected_ir_hashes") or []) != expected_fixture_hashes:
            raise ConflictError("Task-one manifest expected IR lock is invalid")

        page_payloads = manifest.get("pages")
        ir_payloads = manifest.get("compiled_page_irs")
        if not isinstance(page_payloads, list) or not isinstance(ir_payloads, list):
            raise ConflictError("Task-one manifest pages and compiled IRs must be arrays")
        if len(page_payloads) != len(self.task1_runner.fixture["pages"]) or len(ir_payloads) != len(page_payloads):
            raise ConflictError("Task-one manifest page count is invalid")
        try:
            compiled_irs = [CompiledPageIR.from_dict(item, verify_hash=True) for item in ir_payloads]
        except (TypeError, V2ContractError) as exc:
            raise ConflictError(f"Task-one CompiledPageIR validation failed: {exc}") from exc

        validated_pages: list[tuple[dict[str, Any], dict[str, Any]]] = []
        page_locks: list[dict[str, str]] = []
        version_ids: list[str] = []
        for page, ir, fixture_contract in zip(page_payloads, compiled_irs, self.task1_runner.fixture["pages"], strict=True):
            if not isinstance(page, Mapping):
                raise ConflictError("Task-one manifest page record is invalid")
            page_value = dict(page)
            contract = fixture_contract.to_dict()
            page_id = str(page_value.get("page_id") or "")
            version_id = str(page_value.get("version_id") or "")
            if page_id != fixture_contract.page_id or not version_id:
                raise ConflictError("Task-one manifest has an unknown page contract")
            if page_value.get("page_contract_hash") != contract.get("content_hash"):
                raise ConflictError("Task-one page contract hash verification failed")
            if ir.page_id != page_id or ir.content_hash != page_value.get("ir_hash"):
                raise ConflictError("Task-one page record does not match its CompiledPageIR")
            if ir.design_snapshot_hash != snapshot.content_hash:
                raise ConflictError("Task-one CompiledPageIR is bound to another DesignSnapshot")
            validated_pages.append((page_value, contract))
            page_locks.append({"page_id": page_id, "version_id": version_id})
            version_ids.append(version_id)
        if len(set(version_ids)) != len(version_ids):
            raise ConflictError("Task-one manifest reuses a page version ID")
        if snapshot.mode == "style_template":
            expected_fixture_fingerprints = [task1_ir_contract_fingerprint(item) for item in expected_fixture_irs]
            actual_fingerprints = [task1_ir_contract_fingerprint(ir) for ir in compiled_irs]
            if actual_fingerprints != expected_fixture_fingerprints:
                raise ConflictError("Task-one compiled IRs do not match the locked fixture")

        for name, record in (
            ("RecoveryCheckpoint", checkpoint),
            ("ExportSnapshot", export_snapshot),
            ("ExportAttempt", export_attempt),
        ):
            self._verify_task1_record_hash(record, name)
        if checkpoint.get("input_hash") != manifest.get("input_hash"):
            raise ConflictError("Task-one RecoveryCheckpoint input hash is invalid")
        if checkpoint.get("idempotency_key") != idempotency_key:
            raise ConflictError("Task-one RecoveryCheckpoint idempotency key is invalid")
        if list(checkpoint.get("committed_outputs") or []) != version_ids:
            raise ConflictError("Task-one RecoveryCheckpoint outputs do not match page versions")
        if export_snapshot.get("design_snapshot_hash") != snapshot.content_hash:
            raise ConflictError("Task-one ExportSnapshot is bound to another DesignSnapshot")
        if list(export_snapshot.get("page_version_lock") or []) != page_locks:
            raise ConflictError("Task-one ExportSnapshot page lock is invalid")
        if export_attempt.get("export_snapshot_id") != export_snapshot.get("export_snapshot_id"):
            raise ConflictError("Task-one ExportAttempt is bound to another ExportSnapshot")

        descriptor = manifest.get("pptx_artifact")
        expected_artifact_hashes: list[str] = []
        if descriptor is not None:
            if not isinstance(descriptor, Mapping):
                raise ConflictError("Task-one PPTX Artifact descriptor is invalid")
            self._verify_task1_record_hash(descriptor, "PPTX Artifact")
            expected_artifact_id = "artifact_" + hashlib.sha256(
                f"{project_id}:{idempotency_key}:pptx".encode("utf-8")
            ).hexdigest()[:32]
            self._validate_task1_descriptor(
                project_id,
                output_dir,
                descriptor,
                expected_artifact_id=expected_artifact_id,
            )
            expected_artifact_hashes = [str(descriptor.get("sha256") or "")]
        if list(export_snapshot.get("artifact_hashes") or []) != expected_artifact_hashes:
            raise ConflictError("Task-one ExportSnapshot Artifact lock is invalid")
        if export_attempt.get("artifact") != descriptor:
            raise ConflictError("Task-one ExportAttempt Artifact does not match the manifest")
        expected_attempt_status = "succeeded" if descriptor is not None else "skipped"
        if export_attempt.get("status") != expected_attempt_status:
            raise ConflictError("Task-one ExportAttempt status is inconsistent")

        for name, record in (
            ("QAReport", manifest.get("qa_report")),
            ("FactBindingReport", manifest.get("fact_binding_report")),
            ("EditabilityReport", manifest.get("editability_report")),
        ):
            if not isinstance(record, Mapping):
                raise ConflictError(f"Task-one manifest is missing {name}")
            self._verify_task1_record_hash(record, name)
        return dict(snapshot_payload), validated_pages

    def _reconcile_task1_on_startup(self) -> dict[str, Any]:
        """Reconcile direct, safely named task-one manifests after Runtime restart."""
        root = self.settings.data_dir / "task1"
        report: dict[str, Any] = {"status": "completed", "reconciled": [], "errors": []}
        if not root.is_dir():
            return report
        for project_dir in sorted(root.iterdir(), key=lambda item: item.name):
            if not project_dir.is_dir() or project_dir.is_symlink():
                continue
            try:
                project_id = validate_task1_token(project_dir.name, "project_id")
            except ValueError as exc:
                report["errors"].append({"project_id": project_dir.name, "error": str(exc)})
                continue
            for job_dir in sorted(project_dir.iterdir(), key=lambda item: item.name):
                if not job_dir.is_dir() or job_dir.is_symlink():
                    continue
                try:
                    key = validate_task1_token(job_dir.name, "idempotency_key")
                    manifest_path = job_dir / "manifest.json"
                    if not manifest_path.is_file() or manifest_path.is_symlink():
                        continue
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                    if not isinstance(manifest, Mapping):
                        raise ConflictError("Task-one manifest root must be an object")
                    self._reconcile_task1_manifest(project_id, key, job_dir, manifest)
                    report["reconciled"].append({"project_id": project_id, "idempotency_key": key})
                except Exception as exc:
                    report["errors"].append(
                        {"project_id": project_id, "idempotency_key": job_dir.name, "error": str(exc)}
                    )
        if report["errors"]:
            report["status"] = "failed"
        return report

    def _persist_task1_pptx(self, project_id: str, idempotency_key: str, output_dir: Path, manifest: Mapping[str, Any]) -> dict[str, Any] | None:
        """Register the deterministic task-one PPTX in the normal ArtifactStore."""
        descriptor = manifest.get("pptx_artifact")
        if not isinstance(descriptor, Mapping):
            return None
        expected_id = "artifact_" + hashlib.sha256(
            f"{project_id}:{idempotency_key}:pptx".encode("utf-8")
        ).hexdigest()[:32]
        return self._persist_task1_descriptor(
            project_id,
            output_dir,
            descriptor,
            kind="task1_export",
            expected_artifact_id=expected_id,
        )

    def _task1_preview_snapshot(self, project_id: str, request: Mapping[str, Any]) -> dict[str, Any] | None:
        """Load a persisted preview and bind it to its immutable local Artifact."""
        if request.get("expected_mode") != "style_template":
            return None
        preview = self.store.get_v2_design_snapshot(
            project_id,
            idempotency_key=str(request["idempotency_key"]) + ":preview",
        )
        if not preview or not isinstance(preview.get("snapshot"), Mapping):
            raise ConflictError("DESIGN_CONFIRMATION_REQUIRED: generate a matching style/template preview first")
        snapshot = dict(preview["snapshot"])
        expected_hash = str(snapshot.get("preview_artifact_hash") or "")
        artifact_id = task1_preview_artifact_id(project_id, str(request["idempotency_key"]))
        artifact = self.store.get_artifact(project_id, artifact_id)
        if not expected_hash or not artifact:
            raise ConflictError("DESIGN_CONFIRMATION_REQUIRED: preview Artifact is missing")
        try:
            preview_bytes = self._artifact_bytes(project_id, artifact_id)
        except Exception as exc:
            raise ConflictError("DESIGN_CONFIRMATION_REQUIRED: preview Artifact bytes are missing") from exc
        actual_hash = "sha256:" + hashlib.sha256(preview_bytes).hexdigest()
        if actual_hash != expected_hash or actual_hash != request.get("preview_artifact_hash"):
            raise ConflictError("DESIGN_CONFIRMATION_REQUIRED: preview Artifact does not match confirmation")
        return snapshot

    def _reconcile_task1_manifest(
        self,
        project_id: str,
        idempotency_key: str,
        output_dir: Path,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Complete every immutable persistence step for a published task-one manifest."""
        snapshot, validated_pages = self._validate_task1_manifest(
            project_id, idempotency_key, output_dir, manifest
        )
        checkpoint = dict(manifest["recovery_checkpoint"])
        export_snapshot = dict(manifest["export_snapshot"])
        export_attempt = dict(manifest["export_attempt"])
        self.store.create_v2_design_snapshot(project_id, idempotency_key, snapshot)
        for page, contract in validated_pages:
            page_id = str(page["page_id"])
            version_id = str(page["version_id"])
            self.store.create_v2_page_contract_snapshot(project_id, page_id, version_id, contract)
        self.store.create_v2_checkpoint(project_id, idempotency_key, checkpoint)
        self._persist_task1_pptx(project_id, idempotency_key, output_dir, manifest)
        if isinstance(manifest.get("pptx_artifact"), Mapping):
            self.store.create_v2_artifact_commit(project_id, idempotency_key, dict(manifest["pptx_artifact"]), status="committed")
        self.store.create_v2_export_snapshot(project_id, export_snapshot)
        self.store.create_v2_export_attempt(project_id, str(export_snapshot["export_snapshot_id"]), export_attempt)
        return dict(manifest)

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
        price = {"amount": 0, "currency": "CNY", "source": "billing_disabled"}
        reserved = {"requests": 1, "amount": 0, "currency": "CNY"}
        return price, reserved

    async def _run_agent(self, project_id: str, request: AgentRequest) -> tuple[Any, str]:
        if self.settings.agent.backend == AgentBackend.UNCONFIGURED:
            raise ConflictError("No Agent provider is configured")
        self.settings.agent.validate(production=self.settings.agent_production)
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
            result = await self.harness.run(self.settings.agent, request, production=self.settings.agent_production)
        except AgentError as exc:
            state = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(request_id, state, error=exc.code)
            raise
        except Exception as exc:
            self.store.update_usage(request_id, "failed", error=exc.__class__.__name__)
            raise
        settled = {"usage": result.usage or {}, "amount": 0, "currency": "CNY"}
        self.store.update_usage(request_id, "settled", settled=settled)
        return result, request_id

    def create_project(self, owner_id: str, name: str) -> dict[str, Any]:
        clean = self._clean_project_name(name)
        project = self.store.create_project(
            owner_id,
            clean,
            v2_default_selection={
                "style_version_ref": self.settings.default_style_ref,
                "template_version_ref": self.settings.default_template_ref,
            },
        )
        self.store.audit(owner_id, "project.create", project_id=project["project_id"], entity_type="project", entity_id=project["project_id"])
        return project

    @staticmethod
    def _validate_provider_profile(profile: dict[str, Any]) -> dict[str, Any]:
        def reject_embedded_secrets(value: Any, path: str = "capability_settings") -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    key_text = str(key)
                    if re.search(r"(?i)(?:api[_-]?key|authorization|bearer|password|secret|token)", key_text):
                        raise ValueError(f"{path}.{key_text} must use the top-level secret_reference")
                    reject_embedded_secrets(child, f"{path}.{key_text}")
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    reject_embedded_secrets(child, f"{path}[{index}]")
            elif isinstance(value, str) and re.search(r"(?i)(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._~+/-]{20,})", value):
                raise ValueError(f"{path} contains a credential-like value")

        display_name = str(profile.get("display_name") or "").strip()
        if not display_name or len(display_name) > 120:
            raise ValueError("Provider display_name must contain 1 to 120 characters")
        mode = str(profile.get("endpoint_mode") or "official").lower()
        if mode not in {"official", "relay"}:
            raise ValueError("endpoint_mode must be official or relay")
        base_url = profile.get("base_url")
        if mode == "relay":
            parsed = urlparse(str(base_url or ""))
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError("Relay Base URL must be an HTTPS URL without credentials")
            host = parsed.hostname or ""
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                address = None
            if host.lower() in {"localhost", "ip6-localhost"} or address and (address.is_private or address.is_loopback or address.is_link_local):
                raise ValueError("Relay Base URL cannot target a private or loopback address")
        elif base_url:
            raise ValueError("Official provider profiles cannot set base_url")
        secret_reference = str(profile.get("secret_reference") or "").strip()
        if not secret_reference or len(secret_reference) > 240:
            raise ValueError("secret_reference is required and must be a reference, not a secret")
        if not re.fullmatch(r"env:[A-Za-z_][A-Za-z0-9_]*", secret_reference):
            raise ValueError("secret_reference must use the env:VARIABLE_NAME reference format")
        capabilities = profile.get("capability_settings") or {}
        if not isinstance(capabilities, dict):
            raise ValueError("capability_settings must be an object")
        reject_embedded_secrets(capabilities)
        return {"profile_id": profile.get("profile_id"), "display_name": display_name, "endpoint_mode": mode, "base_url": base_url, "secret_reference": secret_reference, "capability_settings": capabilities, "enabled": bool(profile.get("enabled", True))}

    def list_provider_profiles(self, actor_id: str, *, include_archived: bool = False) -> list[dict[str, Any]]:
        return self.store.list_provider_profiles(include_archived=include_archived)

    @staticmethod
    def _resolve_secret_reference(reference: str) -> str | None:
        """Resolve only an explicit environment reference; never accept raw secrets."""
        value = str(reference or "").strip()
        if value.startswith("env:"):
            return os.environ.get(value[4:].strip()) or None
        return None

    def _profile_for_capability(self, project_id: str, capability: str, profile_id: str | None = None) -> dict[str, Any] | None:
        selected = None if profile_id in {None, "", "runtime-default"} else profile_id
        if not selected:
            policy = self.store.get_model_policy(project_id)
            selected = policy.get({
                "agent": "agent_profile_id",
                "image_generation": "image_generation_profile_id",
                "image_edit": "image_edit_profile_id",
            }[capability])
        if not selected:
            return None
        profile = self.store.get_provider_profile(str(selected), include_archived=False)
        if not profile or not profile.get("enabled"):
            raise ConflictError(f"{capability} provider profile is unavailable")
        return profile

    def _agent_settings_for(self, project_id: str, profile_id: str | None = None):
        policy = self.store.get_model_policy(project_id)
        profile = self._profile_for_capability(project_id, "agent", profile_id)
        if not profile:
            settings = replace(self.settings.agent, model=str(policy.get("agent_model") or self.settings.agent.model)) if policy.get("agent_model") else self.settings.agent
            return settings, "runtime-default", {"backend": settings.backend.value, "endpoint_mode": settings.endpoint_mode.value, "model": settings.model}
        config = profile.get("capability_settings") or {}
        capability = config.get("agent", config) if isinstance(config, dict) else {}
        if not isinstance(capability, dict):
            capability = {}
        try:
            backend = AgentBackend(str(capability.get("backend") or self.settings.agent.backend.value))
            endpoint_mode = self.settings.agent.endpoint_mode.__class__(str(capability.get("endpoint_mode") or profile.get("endpoint_mode") or self.settings.agent.endpoint_mode.value))
            from fastppt_agent_harness.harness import AgentSettings

            resolved = self._resolve_secret_reference(str(profile.get("secret_reference") or ""))
            settings = AgentSettings(
                backend=backend,
                model=str(capability.get("model") or policy.get("agent_model") or self.settings.agent.model),
                endpoint_mode=endpoint_mode,
                base_url=profile.get("base_url") if endpoint_mode.value == "relay" else None,
                api_key=resolved,
                reasoning_effort=str(capability.get("reasoning_effort") or self.settings.agent.reasoning_effort),
                timeout_seconds=int(capability.get("timeout_seconds") or self.settings.agent.timeout_seconds),
            )
            settings.validate(production=self.settings.agent_production)
        except Exception as exc:
            raise ConflictError(f"Agent provider profile is unavailable: {exc}") from exc
        return settings, str(profile["profile_id"]), {"backend": settings.backend.value, "endpoint_mode": settings.endpoint_mode.value, "model": settings.model}

    def _image_settings_for(self, project_id: str, purpose: str, profile_id: str | None = None):
        capability_name = "image_edit" if purpose == "image_edit" else "image_generation"
        policy = self.store.get_model_policy(project_id)
        profile = self._profile_for_capability(project_id, capability_name, profile_id)
        if not profile:
            model = policy.get(f"{capability_name}_model")
            settings = replace(self.settings.image, model=str(model)) if model else self.settings.image
            return settings, "runtime-default", {
                "backend": "openai_images",
                "endpoint_mode": settings.endpoint_mode.value,
                "protocol": settings.protocol.value,
                "model": settings.model,
            }
        config = profile.get("capability_settings") or {}
        capability = config.get(capability_name, config) if isinstance(config, dict) else {}
        if not isinstance(capability, dict):
            capability = {}
        try:
            from fastppt_agent_harness.image import ImageEndpointMode, ImageProtocol, ImageSettings

            endpoint_mode = ImageEndpointMode(str(capability.get("endpoint_mode") or profile.get("endpoint_mode") or self.settings.image.endpoint_mode.value))
            protocol = ImageProtocol(str(capability.get("protocol") or self.settings.image.protocol.value))
            resolved = self._resolve_secret_reference(str(profile.get("secret_reference") or ""))
            settings = ImageSettings(
                model=str(capability.get("model") or policy.get(f"{capability_name}_model") or self.settings.image.model),
                endpoint_mode=endpoint_mode,
                protocol=protocol,
                base_url=profile.get("base_url") if endpoint_mode == ImageEndpointMode.RELAY else None,
                api_key=resolved,
                timeout_seconds=int(capability.get("timeout_seconds") or self.settings.image.timeout_seconds),
            )
            settings.validate(production=self.settings.production)
        except Exception as exc:
            raise ConflictError(f"{capability_name} provider profile is unavailable: {exc}") from exc
        return settings, str(profile["profile_id"]), {
            "backend": "openai_images",
            "endpoint_mode": settings.endpoint_mode.value,
            "protocol": settings.protocol.value,
            "model": settings.model,
        }

    def create_provider_profile(self, actor_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        clean = self._validate_provider_profile(profile)
        result = self.store.create_provider_profile(actor_id, clean)
        self.store.audit(actor_id, "provider_profile.create", entity_type="provider_profile", entity_id=result["profile_id"], detail={"endpoint_mode": result["endpoint_mode"], "secret_reference": "redacted"})
        return result

    def update_provider_profile(self, actor_id: str, profile_id: str, values: dict[str, Any]) -> dict[str, Any]:
        current = self.store.get_provider_profile(profile_id)
        if not current:
            raise NotFoundError("Provider profile not found")
        clean = self._validate_provider_profile({**current, **values})
        result = self.store.update_provider_profile(profile_id, clean)
        self.store.audit(actor_id, "provider_profile.update", entity_type="provider_profile", entity_id=profile_id, detail={"secret_reference": "redacted"})
        return result or current

    def archive_provider_profile(self, actor_id: str, profile_id: str) -> dict[str, Any]:
        result = self.store.archive_provider_profile(profile_id)
        if not result:
            raise NotFoundError("Provider profile not found")
        self.store.audit(actor_id, "provider_profile.archive", entity_type="provider_profile", entity_id=profile_id)
        return result

    def test_provider_profile(self, actor_id: str, profile_id: str, capability: str) -> dict[str, Any]:
        profile = self.store.get_provider_profile(profile_id, include_archived=False)
        if not profile:
            raise NotFoundError("Provider profile not found")
        if capability not in {"agent", "image_generation", "image_edit"}:
            raise ValueError("Unsupported provider capability")
        # Validate the selected capability contract without claiming a live
        # network probe. A worker-side probe can promote this status after an
        # actual provider response is recorded.
        config = profile.get("capability_settings") or {}
        capability_config = config.get(capability, config) if isinstance(config, dict) else {}
        if not isinstance(capability_config, dict):
            raise ConflictError("Provider capability settings must be an object")
        if capability == "agent":
            from fastppt_agent_harness.harness import AgentBackend, AgentSettings, EndpointMode

            endpoint = str(capability_config.get("endpoint_mode") or profile.get("endpoint_mode") or "official")
            settings = AgentSettings(
                backend=AgentBackend(str(capability_config.get("backend") or "unconfigured")),
                model=str(capability_config.get("model") or ""),
                endpoint_mode=EndpointMode(endpoint),
                base_url=profile.get("base_url") if endpoint == "relay" else None,
                api_key=self._resolve_secret_reference(str(profile.get("secret_reference") or "")),
                reasoning_effort=str(capability_config.get("reasoning_effort") or "medium"),
                timeout_seconds=int(capability_config.get("timeout_seconds") or 180),
            )
            settings.validate(production=self.settings.production)
        else:
            from fastppt_agent_harness.image import ImageEndpointMode, ImageProtocol, ImageSettings

            endpoint = str(capability_config.get("endpoint_mode") or profile.get("endpoint_mode") or "official")
            settings = ImageSettings(
                model=str(capability_config.get("model") or "gpt-image-2"),
                endpoint_mode=ImageEndpointMode(endpoint),
                protocol=ImageProtocol(str(capability_config.get("protocol") or "openai_images")),
                base_url=profile.get("base_url") if endpoint == "relay" else None,
                api_key=self._resolve_secret_reference(str(profile.get("secret_reference") or "")),
                timeout_seconds=int(capability_config.get("timeout_seconds") or 180),
            )
            settings.validate(production=self.settings.production)
        status = "configuration_validated"
        result = self.store.update_provider_capability_test(profile_id, capability, status) or profile
        self.store.audit(actor_id, "provider_profile.test", entity_type="provider_profile", entity_id=profile_id, detail={"capability": capability, "status": status, "live_probe": False})
        return {"profile": result, "capability": capability, "status": status, "detail": "configuration accepted; no live provider call was made"}

    def get_model_policy(self, owner_id: str, project_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        return self.store.get_model_policy(project_id)

    def update_model_policy(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        for key in ("agent_profile_id", "image_generation_profile_id", "image_edit_profile_id"):
            profile_id = values.get(key)
            if profile_id and not self.store.get_provider_profile(str(profile_id), include_archived=False):
                raise ConflictError(f"Provider profile {profile_id} is unavailable")
        result = self.store.upsert_model_policy(project_id, owner_id, values)
        self.store.audit(owner_id, "model_policy.update", project_id=project_id, entity_type="project_model_policy", entity_id=project_id)
        return result

    @staticmethod
    def _public_design_pack(pack: dict[str, Any]) -> dict[str, Any]:
        public = {key: value for key, value in pack.items() if key != "storage_path"}
        public["preview_count"] = len((pack.get("manifest") or {}).get("preview_artifact_ids") or [])
        return public

    def _validate_design_pack_runtime(self, owner_id: str, pack: dict[str, Any], *, seen: set[tuple[str, str]] | None = None) -> dict[str, Any]:
        if pack.get("status") != "active":
            raise ConflictError("Design Pack is not active")
        version = str(pack.get("version") or pack.get("current_version") or "")
        manifest = dict(pack.get("manifest") or {})
        if manifest.get("pack_id") != pack.get("pack_id") or manifest.get("version") != version or manifest.get("content_hash") != pack.get("content_hash"):
            raise ConflictError("Design Pack metadata no longer matches its registered Manifest")
        validation = dict(pack.get("validation") or {})
        if validation.get("status") != "valid":
            raise ConflictError("Design Pack did not pass its stored validation")
        if pack.get("scope") == "private":
            private_root = (self.settings.data_dir / "private-packs").resolve()
            storage_root = (self.settings.data_dir / str(pack.get("storage_path") or "")).resolve()
            try:
                storage_root.relative_to(private_root)
            except ValueError as exc:
                raise ConflictError("Private Design Pack storage escapes the configured runtime directory") from exc
            resource_hashes = dict(validation.get("resource_hashes") or {})
            for relative, expected in resource_hashes.items():
                resource = (storage_root / Path(*Path(str(relative)).parts)).resolve()
                try:
                    resource.relative_to(storage_root)
                except ValueError as exc:
                    raise ConflictError("Private Design Pack resource path is unsafe") from exc
                if not resource.is_file() or hashlib.sha256(resource.read_bytes()).hexdigest() != expected:
                    raise ConflictError("Private Design Pack resource is missing or has changed")
            if pack_content_hash(manifest, resource_hashes) != pack.get("content_hash"):
                raise ConflictError("Private Design Pack content hash is no longer valid")
        key = (str(pack["pack_id"]), version)
        visited = seen if seen is not None else set()
        if key in visited:
            return pack
        visited.add(key)
        membership = self.store.get_design_pack_membership(key[0], key[1])
        if not membership:
            raise ConflictError("Design Pack membership metadata is unavailable")
        for dependency_id in membership.get("dependency_ids") or []:
            dependency = self.store.get_bundle_design_pack(owner_id, membership["bundle_id"], str(dependency_id))
            if not dependency:
                raise ConflictError(f"Design Pack dependency is unavailable: {dependency_id}")
            self._validate_design_pack_runtime(owner_id, dependency, seen=visited)
        return pack

    def _selection_packs(self, owner_id: str, selection: dict[str, Any] | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        selection = selection or {}
        style = self.store.get_design_pack_version(owner_id, str(selection.get("style_pack_id")), str(selection.get("style_version"))) if selection.get("style_pack_id") and selection.get("style_version") else None
        template = self.store.get_design_pack_version(owner_id, str(selection.get("template_pack_id")), str(selection.get("template_version"))) if selection.get("template_pack_id") and selection.get("template_version") else None
        if selection.get("style_pack_id") and not style or selection.get("template_pack_id") and not template:
            raise ConflictError("A selected Design Pack version is no longer available")
        if style:
            self._validate_design_pack_runtime(owner_id, style)
        if template:
            self._validate_design_pack_runtime(owner_id, template)
        return style, template

    @staticmethod
    def _decorate_design_selection(selection: dict[str, Any]) -> dict[str, Any]:
        snapshot = dict(selection.get("snapshot") or {})
        return {
            **selection,
            "style_display_name": snapshot.get("style_display_name"),
            "template_display_name": snapshot.get("template_display_name"),
        }

    @staticmethod
    def _apply_design_snapshot(draft: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
        applied = dict(snapshot.get("applied_constraints") or {})
        palette = dict(applied.get("style:color_palette") or {})
        typography = dict(applied.get("style:typography") or {})
        density = dict(applied.get("style:density") or {})
        visual_language = dict(applied.get("style:visual_language") or {})
        blueprints = applied.get("template:layout_blueprints") or applied.get("style:layout_blueprints") or []
        draft["design_snapshot"] = snapshot
        if palette:
            draft["accent_color"] = str(palette.get("accent") or palette.get("primary") or draft.get("accent_color") or "#D14D3F")
            draft["background_color"] = str(palette.get("background") or palette.get("surface") or draft.get("background_color") or "#F7F8FA")
        if typography:
            draft["zh_font"] = str(typography.get("zh_family") or draft.get("zh_font") or "Microsoft YaHei")
            draft["latin_font"] = str(typography.get("latin_family") or draft.get("latin_font") or "Arial")
        if density.get("level"):
            draft["density"] = str(density["level"])
        if visual_language.get("direction"):
            draft["visual_direction"] = str(visual_language["direction"])
        if isinstance(blueprints, list) and blueprints and isinstance(blueprints[0], dict):
            draft["layout_intent"] = str(blueprints[0].get("layout_intent") or blueprints[0].get("id") or draft.get("layout_intent") or "title_body")
        return draft

    def import_design_bundle(self, owner_id: str, project_id: str, content: bytes | Path | Mapping[str, bytes]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        private_root = (self.settings.data_dir / "private-packs").resolve()
        private_root.mkdir(parents=True, exist_ok=True)
        candidate = validate_bundle(content, owner_id)
        existing = [
            self.store.get_design_pack_version(owner_id, item["manifest"]["pack_id"], item["manifest"]["version"])
            for item in candidate["members"]
        ]
        if any(existing):
            if not all(existing) or any(
                row.get("content_hash") != item["manifest"]["content_hash"] or row.get("bundle_id") != candidate["bundle"]["bundle_id"]
                for row, item in zip(existing, candidate["members"], strict=True)
            ):
                raise ConflictError("Design Bundle retry conflicts with an existing Pack version")
            packs = [self._public_design_pack(row) for row in existing if row]
            self.store.audit(owner_id, "design_bundle.import_idempotent", project_id=project_id, entity_type="design_bundle", entity_id=str(candidate["bundle"]["bundle_id"]), detail={"pack_ids": [item["pack_id"] for item in packs]})
            return {"bundle_id": candidate["bundle"]["bundle_id"], "display_name": candidate["bundle"]["display_name"], "version": candidate["bundle"]["version"], "content_hash": candidate["bundle"]["content_hash"], "packs": packs, "deduplicated": True}
        validated, targets = install_bundle(content, owner_id, private_root)
        storage_paths = {
            (item["manifest"]["pack_id"], item["manifest"]["version"]): str(
                (private_root / owner_id / item["manifest"]["pack_id"] / item["manifest"]["version"]).relative_to(self.settings.data_dir)
            ).replace("\\", "/")
            for item in validated["members"]
        }
        try:
            packs = self.store.register_design_bundle(owner_id, validated["bundle"], validated["members"], storage_paths)
        except Exception:
            for target in targets:
                resolved = target.resolve()
                if private_root in resolved.parents:
                    shutil.rmtree(resolved, ignore_errors=True)
            raise
        self.store.audit(owner_id, "design_bundle.import", project_id=project_id, entity_type="design_bundle", entity_id=str(validated["bundle"]["bundle_id"]), detail={"pack_ids": [item["pack_id"] for item in packs], "content_hash": validated["bundle"]["content_hash"]})
        return {"bundle_id": validated["bundle"]["bundle_id"], "display_name": validated["bundle"]["display_name"], "version": validated["bundle"]["version"], "content_hash": validated["bundle"]["content_hash"], "packs": [self._public_design_pack(item) for item in packs]}

    def list_design_packs(self, owner_id: str, project_id: str, *, pack_kind: str | None = None, include_all_private: bool = False) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        if pack_kind and pack_kind not in {"style", "template"}:
            raise ValueError("pack_kind must be style or template")
        if include_all_private and (self.store.get_user(owner_id) or {}).get("role") != "admin":
            raise ConflictError("Administrator role is required to inspect other users' private Design Packs")
        packs = self.store.list_design_packs(owner_id, include_all_private=include_all_private, pack_kind=pack_kind)
        if include_all_private:
            self.store.audit(owner_id, "design_pack.admin_list", project_id=project_id, entity_type="design_pack", detail={"count": len(packs)})
        return [self._public_design_pack(item) for item in packs]

    def get_design_pack(self, owner_id: str, project_id: str, pack_id: str, *, include_all_private: bool = False) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if include_all_private and (self.store.get_user(owner_id) or {}).get("role") != "admin":
            raise ConflictError("Administrator role is required to inspect other users' private Design Packs")
        pack = self.store.get_design_pack(owner_id, pack_id, include_all_private=include_all_private)
        if not pack:
            raise NotFoundError("Design Pack not found")
        if include_all_private and pack.get("owner_id") != owner_id:
            self.store.audit(owner_id, "design_pack.admin_view", project_id=project_id, entity_type="design_pack", entity_id=pack_id, detail={"owner_id": pack.get("owner_id")})
        return self._public_design_pack(pack)

    def design_pack_preview(self, owner_id: str, project_id: str, pack_id: str, index: int) -> tuple[bytes, str]:
        self._project(owner_id, project_id)
        pack = self.store.get_design_pack(owner_id, pack_id)
        if not pack:
            raise NotFoundError("Design Pack not found")
        self._validate_design_pack_runtime(owner_id, pack)
        previews = list((pack.get("manifest") or {}).get("preview_artifact_ids") or [])
        if index < 0 or index >= len(previews):
            raise NotFoundError("Design Pack preview not found")
        root = (self.settings.data_dir / str(pack.get("storage_path") or "")).resolve()
        preview = (root / Path(*Path(str(previews[index])).parts)).resolve()
        try:
            preview.relative_to(root)
        except ValueError as exc:
            raise ConflictError("Design Pack preview path is unsafe") from exc
        media_type = mimetypes.guess_type(preview.name)[0] or "application/octet-stream"
        if not preview.is_file() or media_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise NotFoundError("Design Pack preview not found")
        return preview.read_bytes(), media_type

    def archive_design_pack(self, owner_id: str, project_id: str, pack_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        pack = self.store.archive_design_pack(owner_id, pack_id)
        if not pack:
            raise NotFoundError("Private Design Pack not found")
        self.store.audit(owner_id, "design_pack.archive", project_id=project_id, entity_type="design_pack", entity_id=pack_id)
        return self._public_design_pack(pack)

    def select_design_pack(self, owner_id: str, project_id: str, session_id: str, pack_id: str | None, pack_kind: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        session = self.store.get_work_session(project_id, session_id)
        if not session:
            raise NotFoundError("Work session not found")
        if pack_kind not in {"style", "template"}:
            raise ValueError("pack_kind must be style or template")
        current = self.store.get_session_design_selection(project_id, session_id) or {}
        style, template = self._selection_packs(owner_id, current) if current else (None, None)
        selected = None
        if pack_id:
            selected = self.store.get_design_pack(owner_id, pack_id)
            if not selected or selected.get("status") != "active":
                raise NotFoundError("Design Pack not found or unavailable")
            if selected["pack_kind"] != pack_kind:
                raise ValueError("Design Pack kind does not match the selected tab")
            self._validate_design_pack_runtime(owner_id, selected)
        if pack_kind == "style":
            style = selected
        else:
            template = selected
        snapshot = design_snapshot(style, template)
        row = self.store.create_design_selection(project_id, {
            "session_id": session_id,
            "style_pack_id": style.get("pack_id") if style else None,
            "style_version": style.get("current_version") if style else None,
            "style_content_hash": style.get("content_hash") if style else None,
            "template_pack_id": template.get("pack_id") if template else None,
            "template_version": template.get("current_version") if template else None,
            "template_content_hash": template.get("content_hash") if template else None,
            "selection_scope": "session",
            "selected_by": owner_id,
            "selection_source": snapshot["selection_source"],
            "status": "draft",
            "snapshot": snapshot,
        })
        self.store.audit(owner_id, "design_pack.use_draft", project_id=project_id, entity_type="design_selection", entity_id=row["design_selection_id"], detail={"pack_id": pack_id, "pack_kind": pack_kind, "selection_source": snapshot["selection_source"]})
        plan = self.store.get_plan(project_id, str(session.get("plan_id") or "")) if session.get("plan_id") else None
        if plan and plan["status"] != "awaiting_content_confirmation":
            used = self.store.use_design_selection(project_id, row["design_selection_id"], plan["plan_id"], snapshot)
            if not used:
                raise ConflictError("Design selection changed before it could be applied")
            structured = dict(plan["structured_plan"])
            generated_ids = set(structured.get("generatedDraftIds") or [])
            revised_drafts = []
            for draft in structured.get("pageDrafts") or []:
                revised_drafts.append(dict(draft) if draft.get("page_draft_id") in generated_ids else self._apply_design_snapshot(dict(draft), snapshot))
            structured.update({
                "designSelectionId": row["design_selection_id"],
                "designSnapshot": snapshot,
                "pageDrafts": revised_drafts,
                "consistencyStatus": "mixed_design" if generated_ids else "consistent",
            })
            self.store.update_plan(project_id, plan["plan_id"], status=plan["status"], structured_plan=structured, confirmed=True)
            self.store.audit(owner_id, "design_selection.used", project_id=project_id, entity_type="design_selection", entity_id=row["design_selection_id"], detail={"plan_id": plan["plan_id"], "consistency_status": structured["consistencyStatus"]})
            row = self.store.get_design_selection(project_id, row["design_selection_id"]) or row
        return self._decorate_design_selection(row)

    def get_session_design_selection(self, owner_id: str, project_id: str, session_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if not self.store.get_work_session(project_id, session_id):
            raise NotFoundError("Work session not found")
        selection = self.store.get_session_design_selection(project_id, session_id) or {
            "design_selection_id": None,
            "session_id": session_id,
            "style_pack_id": None,
            "template_pack_id": None,
            "selection_source": "none",
            "status": "draft",
            "snapshot": design_snapshot(None, None),
        }
        return self._decorate_design_selection(selection)

    def create_source_text(self, owner_id: str, project_id: str, text: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must contain content")
        if len(text.encode("utf-8")) > 5 * 1024 * 1024:
            raise ValueError("text source exceeds the 5 MB limit")
        content = text.encode("utf-8")
        artifact = self._record_artifact(project_id, "source_text", content, "text/plain; charset=utf-8")
        result = self.store.create_source_text(project_id, artifact["artifact_id"], text, artifact["sha256"], owner_id)
        self.store.enqueue_job(project_id, "analyze_source", {"owner_id": owner_id, "source_text_id": result["source_text_id"]}, f"source:{result['source_text_id']}")
        self.store.emit_event("source.queued", project_id=project_id, payload={"source_text_id": result["source_text_id"]})
        return result

    def list_source_texts(self, owner_id: str, project_id: str) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        return self.store.list_source_texts(project_id)

    def _persist_resolved_prompt(self, project_id: str, task_id: str, resolved: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        envelope = resolved.envelope
        context_manifest = dict(resolved.context_manifest)
        if resolved.truncation_summary:
            summary_artifact = self._record_artifact(
                project_id,
                "context_summary",
                json.dumps(resolved.truncation_summary, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                "application/json",
            )
            truncation_report = {**envelope.truncation_report, "summary_artifact_id": summary_artifact["artifact_id"]}
            envelope = replace(envelope, truncation_report=truncation_report)
            context_manifest["truncation_summary_artifact_id"] = summary_artifact["artifact_id"]
        envelope_payload = envelope.to_dict()
        prompt_artifact = self._record_artifact(
            project_id,
            "prompt_envelope",
            json.dumps(envelope_payload, ensure_ascii=False, sort_keys=True).encode("utf-8"),
            "application/json",
        )
        context_artifact = self._record_artifact(
            project_id,
            "context_manifest",
            json.dumps(context_manifest, ensure_ascii=False, sort_keys=True).encode("utf-8"),
            "application/json",
        )
        truncation_artifact = self._record_artifact(
            project_id,
            "truncation_report",
            json.dumps(envelope_payload["truncation_report"], ensure_ascii=False, sort_keys=True).encode("utf-8"),
            "application/json",
        )
        self.store.create_prompt_envelope(project_id, task_id, prompt_artifact["artifact_id"], envelope_payload)
        self.store.create_context_manifest(project_id, task_id, context_artifact["artifact_id"], envelope.input_context_digest)
        self.store.create_truncation_report(project_id, task_id, truncation_artifact["artifact_id"], envelope_payload["truncation_report"])
        return envelope_payload, {
            "prompt": prompt_artifact,
            "context": context_artifact,
            "truncation": truncation_artifact,
        }

    def _prepare_agent_run(
        self,
        project_id: str,
        *,
        role: str,
        session_id: str | None,
        parent_run_id: str | None,
        input_artifact_ids: list[str],
        user_prompt: str,
        output_schema: dict[str, Any],
        explicit_context: dict[str, Any],
        profile_id: str | None,
        idempotency_key: str | None,
        retry_of_run_id: str | None = None,
        design_selection_id: str | None = None,
        model_override: str | None = None,
    ) -> tuple[dict[str, Any], Any, str]:
        agent_settings, resolved_profile_id, provider_snapshot = self._agent_settings_for(project_id, profile_id)
        if model_override:
            agent_settings = replace(agent_settings, model=model_override)
            provider_snapshot = {**provider_snapshot, "model": model_override}
        if agent_settings.backend == AgentBackend.UNCONFIGURED:
            raise ConflictError("No Agent provider is configured")
        run_id = new_id("agent_run")
        resolved = self.context_resolver.resolve(
            project_id=project_id,
            role=role,
            task_id=run_id,
            session_id=session_id,
            parent_run_id=parent_run_id,
            input_artifact_ids=list(input_artifact_ids),
            user_prompt=user_prompt,
            output_schema=output_schema,
            provider_snapshot=provider_snapshot,
            explicit_context=explicit_context,
        )
        envelope_payload, prompt_artifacts = self._persist_resolved_prompt(project_id, run_id, resolved)
        prompt_artifact = prompt_artifacts["prompt"]
        context_artifact = prompt_artifacts["context"]
        truncation_artifact = prompt_artifacts["truncation"]
        parent_output_ids: list[str] = []
        if parent_run_id:
            parent = self.store.get_agent_run(project_id, parent_run_id)
            parent_output_ids = list((parent or {}).get("output_artifact_ids") or [])
        run = self.store.create_agent_run(project_id, {
            "agent_run_id": run_id,
            "session_id": session_id,
            "parent_run_id": parent_run_id,
            "role": role,
            "profile_id": resolved_profile_id,
            "model": agent_settings.model,
            "input_artifact_ids": list(resolved.envelope.input_artifact_ids),
            "output_artifact_ids": [],
            "context_digest": envelope_payload["input_context_digest"],
            "prompt_artifact_id": prompt_artifact["artifact_id"],
            "prompt_id": envelope_payload["prompt_id"],
            "prompt_version": envelope_payload["prompt_version"],
            "input_contract_version": envelope_payload["input_contract_version"],
            "output_schema_version": envelope_payload["output_schema_version"],
            "input_context_digest": envelope_payload["input_context_digest"],
            "prompt_digest": envelope_payload["prompt_digest"],
            "context_manifest_artifact_id": context_artifact["artifact_id"],
            "truncation_report_artifact_id": truncation_artifact["artifact_id"],
            "parent_output_artifact_ids": parent_output_ids,
            "design_selection_id": design_selection_id,
            "status": "queued",
            "usage_request_id": new_id("request"),
            "retry_of_run_id": retry_of_run_id,
            "provider_snapshot": provider_snapshot,
            "idempotency_key": idempotency_key or f"agent:{run_id}",
        })
        return run, agent_settings, provider_prompt(envelope_payload)

    def create_agent_run_record(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if values.get("status") not in {None, "queued"}:
            raise ValueError("New AgentRun must start in queued status")
        role = str(values.get("role") or "")
        if role not in {item.value for item in AgentRole}:
            raise ValueError("AgentRun role is invalid")
        input_artifact_ids = list(values.get("input_artifact_ids") or [])
        for artifact_id in input_artifact_ids:
            if not self.store.get_artifact(project_id, str(artifact_id)):
                raise ConflictError("AgentRun input references an unavailable Artifact")
        parent_run_id = values.get("parent_run_id")
        if parent_run_id and not self.store.get_agent_run(project_id, str(parent_run_id)):
            raise ConflictError("AgentRun parent is unavailable")
        profile_id = values.get("profile_id")
        if profile_id and profile_id != "runtime-default" and not self.store.get_provider_profile(str(profile_id), include_archived=False):
            raise ConflictError("Agent provider profile is unavailable")
        request_idempotency_key = str(values.get("idempotency_key") or "").strip()
        scoped_idempotency_key = f"agent-request:{project_id}:{request_idempotency_key}" if request_idempotency_key else None
        if scoped_idempotency_key:
            existing = self.store.get_agent_run_by_idempotency(project_id, scoped_idempotency_key)
            if existing:
                return existing
        metadata = dict(values.get("metadata") or {})
        explicit_context = dict(values.get("context") or {})
        if metadata:
            explicit_context.setdefault("user_options", metadata)
        # The role contract owns the output schema.  A caller may provide
        # metadata and context, but must not replace the system schema with a
        # looser or instruction-bearing custom object.
        output_schema = STAGE_OUTPUT_SCHEMAS.get(role, PLAN_OUTPUT_SCHEMA)
        result, _settings, _rendered_prompt = self._prepare_agent_run(
            project_id,
            role=role,
            session_id=values.get("session_id"),
            parent_run_id=str(parent_run_id) if parent_run_id else None,
            input_artifact_ids=input_artifact_ids,
            user_prompt=str(values.get("prompt") or "Perform the role task using only the supplied role-scoped context."),
            output_schema=output_schema,
            explicit_context=explicit_context,
            profile_id=str(profile_id) if profile_id else None,
            idempotency_key=scoped_idempotency_key,
            retry_of_run_id=values.get("retry_of_run_id"),
            design_selection_id=values.get("design_selection_id"),
        )
        self.store.enqueue_job(project_id, "agent_run", {"owner_id": owner_id, "agent_run_id": result["agent_run_id"], "event_metadata": metadata}, f"agent:{result['agent_run_id']}")
        self.store.emit_event("agent.run.started", project_id=project_id, session_id=values.get("session_id"), payload={"agent_run_id": result["agent_run_id"], "role": result["role"], "parent_run_id": result.get("parent_run_id")})
        return result

    def _record_stage_agent_run(self, owner_id: str, project_id: str, *, role: str, session_id: str | None, parent_run_id: str | None = None, input_artifact_ids: list[str] | None = None, summary: dict[str, Any] | None = None, design_selection_id: str | None = None) -> dict[str, Any]:
        stage_input = summary or {}
        explicit_context: dict[str, Any] = {"user_options": stage_input}
        if role == "source_analyst":
            explicit_context = {
                "source_metadata": stage_input,
                "user_options": stage_input.get("user_options") or {},
            }
        elif role == "import_analyst":
            explicit_context = {
                "source_metadata": stage_input,
                "import_manifest": stage_input.get("import_manifest") or {},
                "user_options": {"improvement_mode": stage_input.get("improvement_mode")},
            }
        elif role == "fact_reviewer":
            explicit_context = {
                "source_summaries": stage_input.get("source_summaries") or [],
                "candidate_facts": stage_input.get("candidate_facts") or [],
                "locked_facts": stage_input.get("locked_facts") or [],
                "fact_conflicts": stage_input.get("fact_conflicts") or [],
                "user_options": stage_input.get("user_options") or {},
            }
        elif role == "outline_planner":
            explicit_context = {
                "source_summaries": stage_input.get("source_summaries") or [],
                "reviewed_facts": stage_input.get("reviewed_facts") or {},
                "locked_facts": stage_input.get("locked_facts") or [],
                "fact_conflicts": stage_input.get("fact_conflicts") or [],
                "page_drafts": stage_input.get("page_drafts") or [],
                "design_snapshot": stage_input.get("design_snapshot") or design_snapshot(None, None),
                "user_options": stage_input.get("user_options") or {},
            }
        elif role == "content_logic_reviewer":
            explicit_context = {"page_drafts": stage_input.get("page_drafts", []), "user_options": stage_input}
        elif role == "page_writer":
            explicit_context = {
                "page_drafts": stage_input.get("page_drafts") or [],
                "reviewed_facts": stage_input.get("reviewed_facts") or [],
                "locked_facts": stage_input.get("locked_facts") or [],
                "verbatim_text": stage_input.get("verbatim_text") or [],
                "user_options": {
                    "content_mode": stage_input.get("content_mode"),
                    "language": stage_input.get("language"),
                    "audience": stage_input.get("audience"),
                },
            }
        elif role == "visual_director":
            explicit_context = {
                "page_geometry": stage_input,
                "design_snapshot": stage_input.get("design_snapshot") or {},
                "logic_analysis": stage_input.get("logic_analysis") or {},
            }
        elif role == "reconstruction_planner":
            explicit_context = {"existing_objects": stage_input.get("objects") or [], "import_manifest": stage_input.get("import_manifest") or {}}
        elif role == "qa_reviewer":
            explicit_context = {"qa_results": stage_input}
        output_schema = STAGE_OUTPUT_SCHEMAS.get(role, PLAN_OUTPUT_SCHEMA)
        run, agent_settings, rendered_prompt = self._prepare_agent_run(
            project_id,
            role=role,
            session_id=session_id,
            parent_run_id=parent_run_id,
            input_artifact_ids=list(input_artifact_ids or []),
            user_prompt="Perform this presentation workflow stage and return the bounded structured result.",
            output_schema=output_schema,
            explicit_context=explicit_context,
            profile_id=None,
            idempotency_key=None,
            design_selection_id=design_selection_id,
        )
        request_id = run["usage_request_id"]
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, request_id, agent_settings.backend.value, agent_settings.model, price, reserved)
        self.store.update_usage(request_id, "submitted")
        self.store.update_agent_run(project_id, run["agent_run_id"], status="running")
        try:
            result = asyncio.run(
                self.harness.run(
                    agent_settings,
                    AgentRequest(rendered_prompt, output_schema, {"role": role, "task_id": run["agent_run_id"], "test_fixture_context": explicit_context}),
                    production=self.settings.agent_production,
                )
            )
        except AgentError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(request_id, status, error=exc.code)
            self.store.update_agent_run(project_id, run["agent_run_id"], status=status, error={"code": exc.code, "message": str(exc), "retryable": exc.retryable})
            raise
        try:
            output_payload = validate_stage_output(role, result.output, strict=agent_settings.backend != AgentBackend.DETERMINISTIC_TEST)
        except ValueError as exc:
            self.store.update_usage(request_id, "failed", error="output_contract_violation")
            self.store.update_agent_run(project_id, run["agent_run_id"], status="failed", error={"code": "output_contract_violation", "message": str(exc), "retryable": False})
            raise ConflictError(str(exc)) from exc
        output = self._record_artifact(project_id, "agent_output", json.dumps(output_payload, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        self.store.update_usage(request_id, "settled", settled={"usage": result.usage or {}, "amount": 0, "currency": "CNY"})
        return self.store.update_agent_run(project_id, run["agent_run_id"], status="completed", output_artifact_ids=[output["artifact_id"]], output_digest="sha256:" + output["sha256"], provider_request_id=result.thread_id) or run

    def _record_not_required_agent_run(self, project_id: str, *, role: str, session_id: str | None, reason: str) -> dict[str, Any]:
        return self.store.create_agent_run(project_id, {
            "session_id": session_id,
            "role": role,
            "profile_id": "not_required",
            "model": "not_required",
            "input_artifact_ids": [],
            "output_artifact_ids": [],
            "status": "not_required",
            "usage_request_id": new_id("request"),
            "provider_snapshot": {"status": "not_required", "reason": reason},
            "idempotency_key": f"not-required:{session_id or project_id}:{role}",
            "error": {"code": "not_required", "message": reason, "retryable": False},
        })

    def execute_agent_run_record(self, owner_id: str, project_id: str, agent_run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        run = self.store.get_agent_run(project_id, agent_run_id)
        if not run:
            raise NotFoundError("Agent run not found")
        if run["status"] == "completed":
            return run
        agent_settings, _profile_id, _provider_snapshot = self._agent_settings_for(project_id, run.get("profile_id"))
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, run["usage_request_id"], agent_settings.backend.value, agent_settings.model, price, reserved)
        self.store.update_usage(run["usage_request_id"], "submitted")
        self.store.update_agent_run(project_id, agent_run_id, status="running")
        try:
            # Worker jobs are synchronous; run the async SDK only here.
            # Re-validate every registered input at execution time.  Agent
            # records are queued and may execute after an artifact store
            # mutation, so the create-time metadata check is not sufficient.
            registered_input_ids = [str(item) for item in (run.get("input_artifact_ids") or [])]
            for artifact_id in registered_input_ids:
                self._artifact_bytes(project_id, artifact_id)
            if run.get("prompt_artifact_id"):
                envelope = json.loads(self._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8"))
                envelope_input_ids = [str(item) for item in (envelope.get("input_artifact_ids") or [])]
                envelope_input_hashes = [str(item) for item in (envelope.get("input_artifact_hashes") or [])]
                if registered_input_ids != envelope_input_ids:
                    raise ConflictError("AgentRun input Artifact IDs do not match the PromptEnvelope")
                if len(envelope_input_hashes) != len(envelope_input_ids):
                    raise ConflictError("PromptEnvelope input Artifact hash count does not match its IDs")
                for artifact_id, expected_hash in zip(envelope_input_ids, envelope_input_hashes):
                    if not expected_hash.startswith("sha256:"):
                        raise ConflictError("PromptEnvelope input Artifact hash is invalid")
                    actual_hash = "sha256:" + hashlib.sha256(self._artifact_bytes(project_id, artifact_id)).hexdigest()
                    if actual_hash != expected_hash:
                        raise ConflictError("PromptEnvelope input Artifact hash does not match stored bytes")
                rendered_prompt = provider_prompt(envelope)
                if sha256_json(rendered_prompt) != run.get("prompt_digest"):
                    raise ConflictError("Saved PromptEnvelope digest does not match the provider request")
                output_schema = dict(envelope.get("output_schema") or PLAN_OUTPUT_SCHEMA)
            else:
                # Forward-compatible legacy replay path for v1.1 queued jobs.
                rendered_prompt = str(payload.get("prompt", ""))
                output_schema = dict(payload.get("output_schema") or PLAN_OUTPUT_SCHEMA)
            result = asyncio.run(self.harness.run(agent_settings, AgentRequest(rendered_prompt, output_schema, {"role": run["role"], "task_id": agent_run_id, "test_fixture_context": dict(envelope.get("rendered_context") or {}) if run.get("prompt_artifact_id") else {}}), production=self.settings.agent_production))
            try:
                output_payload = validate_stage_output(run["role"], result.output, strict=agent_settings.backend != AgentBackend.DETERMINISTIC_TEST)
            except ValueError as exc:
                self.store.update_usage(run["usage_request_id"], "failed", error="output_contract_violation")
                updated = self.store.update_agent_run(project_id, agent_run_id, status="failed", error={"code": "output_contract_violation", "message": str(exc), "retryable": False})
                self.store.emit_event("agent.run.failed", project_id=project_id, payload={"agent_run_id": agent_run_id, "reason": "output_contract_violation"})
                return updated or run
            output_artifact = self._record_artifact(project_id, "agent_output", json.dumps(output_payload, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
            settled = {"usage": result.usage or {}, "amount": 0, "currency": "CNY"}
            self.store.update_usage(run["usage_request_id"], "settled", settled=settled)
            updated = self.store.update_agent_run(project_id, agent_run_id, status="completed", provider_request_id=result.thread_id, output_artifact_ids=[output_artifact["artifact_id"]], output_digest="sha256:" + output_artifact["sha256"])
            self.store.emit_event("agent.run.completed", project_id=project_id, payload={"agent_run_id": agent_run_id})
            source_text_id = (payload.get("event_metadata") or payload.get("metadata") or {}).get("source_text_id")
            if source_text_id:
                self.store.emit_event("source.ready", project_id=project_id, payload={"source_text_id": source_text_id, "agent_run_id": agent_run_id, "output_artifact_id": output_artifact["artifact_id"]})
            return updated or run
        except AgentError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(run["usage_request_id"], status, error=exc.code)
            updated = self.store.update_agent_run(project_id, agent_run_id, status=status, error={"code": exc.code, "message": str(exc), "retryable": exc.retryable})
            self.store.emit_event("agent.run.submission_unknown" if status == "submission_unknown" else "agent.run.failed", project_id=project_id, payload={"agent_run_id": agent_run_id})
            return updated or run
        except (ConflictError, NotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError, TypeError, ValueError) as exc:
            # Prompt and input Artifacts are immutable execution inputs.  A
            # missing, corrupt, or malformed input must close both ledgers so
            # a worker failure cannot leave an apparently running run behind.
            self.store.update_usage(run["usage_request_id"], "failed", error="artifact_validation_failed")
            updated = self.store.update_agent_run(
                project_id,
                agent_run_id,
                status="failed",
                error={"code": "artifact_validation_failed", "message": str(exc), "retryable": False},
            )
            self.store.emit_event(
                "agent.run.failed",
                project_id=project_id,
                payload={"agent_run_id": agent_run_id, "reason": "artifact_validation_failed"},
            )
            return updated or run

    def list_agent_runs(self, owner_id: str, project_id: str) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        return self.store.list_agent_runs(project_id)

    def inspect_agent_run(self, owner_id: str, project_id: str, agent_run_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        run = self.store.get_agent_run(project_id, agent_run_id)
        if not run:
            raise NotFoundError("Agent run not found")
        if not run.get("prompt_artifact_id"):
            return {"agent_run": run, "status": "legacy_context_unavailable", "prompt_envelope": None, "context_manifest": None, "truncation_report": None}
        prompt_row = self.store.get_prompt_envelope(project_id, agent_run_id)
        if not prompt_row or prompt_row.get("content_deleted_at"):
            return {"agent_run": run, "status": "retention_expired", "prompt_envelope": None, "context_manifest": None, "truncation_report": None}
        try:
            envelope = json.loads(self._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8"))
            context_row = self.store.get_context_manifest(project_id, agent_run_id)
            truncation_row = self.store.get_truncation_report(project_id, agent_run_id)
            context_manifest = json.loads(self._artifact_bytes(project_id, context_row["artifact_id"]).decode("utf-8")) if context_row else None
            truncation_report = json.loads(self._artifact_bytes(project_id, truncation_row["artifact_id"]).decode("utf-8")) if truncation_row else None
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return {"agent_run": run, "status": "retention_expired", "prompt_envelope": None, "context_manifest": None, "truncation_report": None}
        return {
            "agent_run": run,
            "status": "available",
            "prompt_envelope": envelope,
            "final_prompt": provider_prompt(envelope),
            "context_manifest": context_manifest,
            "truncation_report": truncation_report,
            "output_artifact_ids": run.get("output_artifact_ids") or [],
        }

    def replay_agent_run(self, owner_id: str, project_id: str, agent_run_id: str, *, execute: bool = False) -> dict[str, Any]:
        inspection = self.inspect_agent_run(owner_id, project_id, agent_run_id)
        if inspection["status"] != "available":
            return {"agent_run_id": agent_run_id, "status": "replay_unavailable", "reason": inspection["status"]}
        envelope = dict(inspection["prompt_envelope"])
        artifacts = list(envelope.get("input_artifact_ids") or [])
        hashes = list(envelope.get("input_artifact_hashes") or [])
        missing: list[str] = []
        changed: list[str] = []
        for index, artifact_id in enumerate(artifacts):
            artifact = self.store.get_artifact(project_id, artifact_id)
            if not artifact:
                missing.append(artifact_id)
                continue
            actual = "sha256:" + artifact["sha256"]
            if index >= len(hashes) or hashes[index] != actual:
                changed.append(artifact_id)
            try:
                self._artifact_bytes(project_id, artifact_id)
            except (OSError, ConflictError):
                missing.append(artifact_id)
        rendered = provider_prompt(envelope)
        digest = sha256_json(rendered)
        digest_match = digest == envelope.get("prompt_digest")
        dry_result = {
            "agent_run_id": agent_run_id,
            "mode": "execute" if execute else "dry-run",
            "status": "ready" if not missing and not changed and digest_match else "replay_unavailable",
            "historical_prompt_digest": envelope.get("prompt_digest"),
            "reassembled_prompt_digest": digest,
            "digest_match": digest_match,
            "missing_artifact_ids": sorted(set(missing)),
            "changed_artifact_ids": sorted(set(changed)),
            "provider_snapshot": envelope.get("provider_snapshot") or {},
        }
        if not execute or dry_result["status"] != "ready" or not dry_result["digest_match"]:
            return dry_result
        old_run = inspection["agent_run"]
        artifact_keys = {
            str(item.get("context_key"))
            for item in (inspection.get("context_manifest") or {}).get("artifacts", [])
            if item.get("included")
        }
        explicit = {key: value for key, value in dict(envelope.get("rendered_context") or {}).items() if key not in artifact_keys}
        replay, _settings, _prompt = self._prepare_agent_run(
            project_id,
            role=old_run["role"],
            session_id=old_run.get("session_id"),
            parent_run_id=old_run.get("parent_run_id"),
            input_artifact_ids=artifacts,
            user_prompt=str(envelope.get("user_prompt") or ""),
            output_schema=dict(envelope.get("output_schema") or PLAN_OUTPUT_SCHEMA),
            explicit_context=explicit,
            profile_id=old_run.get("profile_id"),
            idempotency_key=f"replay:{agent_run_id}:{new_id('request')}",
            retry_of_run_id=agent_run_id,
            design_selection_id=old_run.get("design_selection_id"),
            model_override=old_run.get("model"),
        )
        result = self.execute_agent_run_record(owner_id, project_id, replay["agent_run_id"], {})
        self.store.audit(owner_id, "agent_run.replay", project_id=project_id, entity_type="agent_run", entity_id=result["agent_run_id"], detail={"replay_of_run_id": agent_run_id, "prompt_digest": result.get("prompt_digest")})
        return {**dry_result, "status": result["status"], "replay_agent_run": result}

    def cleanup_expired_prompt_content(self, actor_id: str, *, limit: int = 500) -> dict[str, Any]:
        expired = self.store.expired_prompt_envelopes(limit=limit)
        deleted = 0
        for row in expired:
            artifact_ids = [row["prompt_artifact_id"]]
            context = self.store.get_context_manifest(row["project_id"], row["agent_run_id"])
            truncation = self.store.get_truncation_report(row["project_id"], row["agent_run_id"])
            artifact_ids.extend(item["artifact_id"] for item in (context, truncation) if item)
            if truncation:
                try:
                    truncation_payload = json.loads(self._artifact_bytes(row["project_id"], truncation["artifact_id"]).decode("utf-8"))
                    if truncation_payload.get("summary_artifact_id"):
                        artifact_ids.append(str(truncation_payload["summary_artifact_id"]))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError, ConflictError):
                    pass
            if context:
                try:
                    context_payload = json.loads(self._artifact_bytes(row["project_id"], context["artifact_id"]).decode("utf-8"))
                    artifact_ids.extend(
                        str(item["artifact_id"])
                        for item in context_payload.get("artifacts") or []
                        if item.get("kind") == "source_chunk" and item.get("artifact_id")
                    )
                except (OSError, UnicodeDecodeError, json.JSONDecodeError, ConflictError):
                    pass
            run = self.store.get_agent_run(row["project_id"], row["agent_run_id"])
            if run:
                artifact_ids.extend(run.get("output_artifact_ids") or [])
            else:
                # Image PromptEnvelopes use the ImageRun ID as their audit
                # correlation key.  Their generated outputs live on
                # ImageAttempt rows rather than AgentRun, so include those
                # immutable response Artifacts in the same retention sweep.
                for attempt in self.store.list_image_attempts(row["project_id"], row["agent_run_id"]):
                    artifact_ids.extend(attempt.get("output_artifact_ids") or [])
            for artifact_id in dict.fromkeys(artifact_ids):
                artifact = self.store.get_artifact(row["project_id"], artifact_id)
                if artifact:
                    self.artifacts.delete(artifact["storage_key"])
            self.store.mark_prompt_envelope_deleted(row["envelope_id"])
            deleted += 1
        if deleted:
            self.store.audit(actor_id, "prompt_retention.cleanup", detail={"deleted_envelopes": deleted})
        return {"deleted_envelopes": deleted, "limit": limit}

    def create_image_run(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if values.get("status") not in {None, "queued"}:
            raise ValueError("New ImageRun must start in queued status")
        if values.get("page_id") and not self.store.get_page(project_id, str(values["page_id"])):
            raise NotFoundError("Page not found")
        if values.get("purpose") not in {"full_slide_reference", "local_element", "template_variation", "image_edit"}:
            raise ValueError("Image purpose is invalid")
        prompt_artifact = self.store.get_artifact(project_id, str(values.get("prompt_artifact_id") or ""))
        if not prompt_artifact or not (
            str(prompt_artifact.get("media_type", "")).startswith("text/")
            or prompt_artifact.get("kind") == "prompt_envelope"
        ):
            raise ConflictError("Image prompt must reference a registered PromptEnvelope or text Artifact")
        input_ids = list(values.get("input_artifact_ids") or [])
        input_hashes = list(values.get("input_hashes") or [])
        if input_hashes and len(input_hashes) != len(input_ids):
            raise ValueError("Image input hashes must be provided for every input Artifact")
        for index, artifact_id in enumerate(input_ids):
            artifact = self.store.get_artifact(project_id, str(artifact_id))
            if not artifact or not str(artifact.get("media_type", "")).startswith("image/"):
                raise ConflictError("Image input must reference a registered project image Artifact")
            if input_hashes and input_hashes[index] != artifact["sha256"]:
                raise ConflictError("Image input hash does not match the registered Artifact")
            if not input_hashes:
                input_hashes.append(artifact["sha256"])
        profile_id = values.get("profile_id")
        image_settings, resolved_profile_id, _provider_snapshot = self._image_settings_for(project_id, str(values.get("purpose") or ""), str(profile_id) if profile_id else None)
        profile_id = resolved_profile_id
        if profile_id:
            profile = self.store.get_provider_profile(str(profile_id), include_archived=False) if profile_id != "runtime-default" else None
            if profile_id != "runtime-default" and (not profile or not profile.get("enabled")):
                raise ConflictError("Image provider profile is unavailable")
            capability = "image_edit" if values.get("purpose") == "image_edit" else "image_generation"
            if profile and (profile.get("connection_status_by_capability") or {}).get(capability) == "disabled":
                raise ConflictError("Image provider capability is disabled")
        result = self.store.create_image_run(project_id, {**values, "profile_id": profile_id, "input_hashes": input_hashes})
        self.store.enqueue_job(project_id, "image_run", {"owner_id": owner_id, "image_run_id": result["image_run_id"], "profile_id": None if profile_id == "runtime-default" else profile_id}, f"image:{result['image_run_id']}")
        self.store.emit_event("image.submitted", project_id=project_id, page_id=values.get("page_id"), payload={"image_run_id": result["image_run_id"], "purpose": result["purpose"]})
        return result

    def image_run_decision(
        self,
        owner_id: str,
        project_id: str,
        image_run_id: str,
        decision: str,
        *,
        output_artifact_ids: list[str] | None = None,
        accept_duplicate_risk: bool = False,
        profile_id: str | None = None,
    ) -> dict[str, Any]:
        self._project(owner_id, project_id)
        current = self.store.get_image_run(project_id, image_run_id)
        if not current:
            raise NotFoundError("Image run not found")
        allowed = {"retry_same", "retry_with_profile", "use_existing_asset", "use_no_image_layout", "pause", "resume", "cancel"}
        if decision not in allowed:
            raise ValueError("Image decision is invalid")
        selected = list(output_artifact_ids or [])
        for artifact_id in selected:
            artifact = self.store.get_artifact(project_id, str(artifact_id))
            if not artifact or not str(artifact.get("media_type", "")).startswith("image/"):
                raise ConflictError("Image decision references an unavailable image Artifact")
        attempts = self.store.list_image_attempts(project_id, image_run_id)
        latest_attempt = attempts[-1] if attempts else None
        if decision == "retry_same" and not profile_id and latest_attempt:
            # Preserve the provider profile that produced the previous
            # attempt. Falling back to the current project default would make
            # a user-visible "retry same" silently switch endpoints/models.
            profile_id = str(latest_attempt.get("profile_id") or "") or None
        if decision in {"retry_same", "retry_with_profile"} and latest_attempt and latest_attempt["status"] == "submission_unknown":
            if not accept_duplicate_risk:
                raise ConflictError("Retrying an unknown image submission requires explicit duplicate-call risk acceptance")
            self.store.update_image_attempt(latest_attempt["image_attempt_id"], status="abandoned", error={"code": "duplicate_risk_accepted", "message": "User abandoned an unknown submission before retry"})
        if decision == "retry_with_profile" and not profile_id:
            raise ValueError("retry_with_profile requires profile_id")
        if decision == "use_existing_asset" and len(selected) != 1:
            raise ValueError("use_existing_asset requires exactly one registered image Artifact")
        if decision in {"use_existing_asset", "use_no_image_layout"}:
            if not current.get("page_id"):
                raise ConflictError("This image decision is not attached to a page")
            page = self.store.get_page(project_id, current["page_id"])
            if not page:
                raise NotFoundError("Page not found")
            if decision == "use_no_image_layout":
                contract = self._page_contract(project_id, page)
                visual = self._render_contract_visual(project_id, contract, self._contract_body(contract), int(page["order_index"]) + 1)
                artifact = self._record_artifact(project_id, "visual_preview", visual, "image/png")
                selected = [artifact["artifact_id"]]
            result = self.store.update_image_run(project_id, image_run_id, status="running", decision=decision, selected_output_artifact_ids=selected)
            self._apply_visual_artifact(project_id, current["page_id"], selected[0], image_run_id)
            result = self.store.update_image_run(project_id, image_run_id, status="completed", decision=decision, selected_output_artifact_ids=selected)
            self._refresh_plan_visual_status(project_id, current["page_id"])
            return result or current
        target = "queued" if decision in {"retry_same", "retry_with_profile", "resume"} else ("paused" if decision == "pause" else "cancelled")
        validate_transition(current["status"], target, IMAGE_RUN_TRANSITIONS)
        result = self.store.update_image_run(project_id, image_run_id, status=target, decision=decision, selected_output_artifact_ids=selected)
        if target == "queued":
            self.store.enqueue_job(project_id, "image_run", {"owner_id": owner_id, "image_run_id": image_run_id, "profile_id": profile_id}, f"image:{image_run_id}:attempt:{len(attempts) + 1}")
        self.store.emit_event("image.user_decision.required" if target == "awaiting_user_decision" else "image.reconciled", project_id=project_id, page_id=current.get("page_id"), payload={"image_run_id": image_run_id, "decision": decision, "status": target})
        return result or current

    def execute_image_run(self, owner_id: str, project_id: str, image_run_id: str, values: dict[str, Any] | None = None) -> dict[str, Any]:
        self._project(owner_id, project_id)
        run = self.store.get_image_run(project_id, image_run_id)
        if not run:
            raise NotFoundError("Image run not found")
        if run["status"] == "completed":
            return run
        if run["status"] not in {"queued", "running"}:
            raise ConflictError(f"Image run in {run['status']} cannot be executed without an explicit user decision")
        previous_attempts = self.store.list_image_attempts(project_id, image_run_id)
        if run["status"] == "running" and previous_attempts:
            latest = previous_attempts[-1]
            # A second worker may receive the same job after a lease expiry.
            # Never issue a second provider call while the first submission is
            # still unresolved. If the response was persisted before the
            # worker crashed, finish the ImageRun from that immutable attempt.
            if latest["status"] in {"created", "submitted"}:
                return run
            if latest["status"] == "completed":
                selected = list(latest.get("output_artifact_ids") or [])
                updated = self.store.update_image_run(
                    project_id,
                    image_run_id,
                    status="completed",
                    selected_output_artifact_ids=selected,
                )
                if run.get("page_id") and run.get("purpose") == "full_slide_reference" and selected:
                    self._apply_visual_artifact(project_id, run["page_id"], selected[0], image_run_id)
                    self._refresh_plan_visual_status(project_id, run["page_id"])
                return updated or run
            if latest["status"] in {"failed", "submission_unknown"}:
                updated = self.store.update_image_run(project_id, image_run_id, status="awaiting_user_decision")
                return updated or run
        settings, profile_id, provider_snapshot = self._image_settings_for(project_id, run["purpose"], (values or {}).get("profile_id") or None)
        if settings.api_key:
            adapter = OpenAIImageAdapter()
        elif self.settings.test_fixtures_enabled and profile_id == "runtime-default":
            adapter = DeterministicImageAdapter()
        else:
            raise ConflictError("No image provider is configured")
        previous_attempts = self.store.list_image_attempts(project_id, image_run_id)
        attempt_number = len(previous_attempts) + 1
        attempt = self.store.create_image_attempt(image_run_id, {
            "profile_id": profile_id,
            "provider_snapshot": provider_snapshot,
            "endpoint_mode": settings.endpoint_mode.value,
            "model": settings.model,
            "attempt_number": attempt_number,
            "retry_of_attempt_id": previous_attempts[-1]["image_attempt_id"] if previous_attempts else None,
            "idempotency_key": f"image:{image_run_id}:attempt:{attempt_number}",
            "prompt_artifact_id": run["prompt_artifact_id"],
            "input_summary": [
                {"artifact_id": artifact_id, "sha256": input_hash, "size_bytes": (self.store.get_artifact(project_id, artifact_id) or {}).get("size_bytes"), "media_type": (self.store.get_artifact(project_id, artifact_id) or {}).get("media_type")}
                for index, artifact_id in enumerate(run["input_artifact_ids"])
                for input_hash in [run["input_hashes"][index] if index < len(run["input_hashes"]) else ""]
            ],
        })
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, attempt["usage_request_id"], "openai_images", settings.model, price, reserved)
        self.store.update_usage(attempt["usage_request_id"], "submitted")
        self.store.update_image_run(project_id, image_run_id, status="running")
        self.store.update_image_attempt(attempt["image_attempt_id"], status="submitted")
        try:
            prompt_payload = self._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8")
            prompt_artifact = self.store.get_artifact(project_id, run["prompt_artifact_id"])
            if prompt_artifact and prompt_artifact.get("kind") == "prompt_envelope":
                envelope = json.loads(prompt_payload)
                prompt = provider_prompt(envelope)
                if sha256_json(prompt) != envelope.get("prompt_digest"):
                    raise ConflictError("Saved image PromptEnvelope digest does not match the provider request")
            else:
                prompt = prompt_payload
            inputs = tuple(self._artifact_bytes(project_id, artifact_id) for artifact_id in run["input_artifact_ids"])
            input_media_types = tuple(
                str((self.store.get_artifact(project_id, artifact_id) or {}).get("media_type") or "application/octet-stream")
                for artifact_id in run["input_artifact_ids"]
            )
            result = asyncio.run(adapter.generate(settings, ImageRequest(prompt, inputs, input_media_types=input_media_types, metadata={"image_run_id": image_run_id})))
            artifact_ids: list[str] = []
            hashes: list[str] = []
            for image in result.images:
                media_type = OpenAIImageAdapter._image_media_type(image)
                artifact = self._record_artifact(project_id, "generated_image", image, media_type)
                artifact_ids.append(artifact["artifact_id"])
                hashes.append(artifact["sha256"])
            self.store.update_usage(attempt["usage_request_id"], "settled", settled={"usage": result.usage, "amount": 0, "currency": "CNY"})
            self.store.update_image_attempt(attempt["image_attempt_id"], status="completed", provider_request_id=result.provider_request_id, output_artifact_ids=artifact_ids, output_hashes=hashes, output_digest=sha256_json(hashes))
            updated = self.store.update_image_run(project_id, image_run_id, status="completed", selected_output_artifact_ids=artifact_ids)
            if run.get("page_id") and run.get("purpose") == "full_slide_reference":
                self._apply_visual_artifact(project_id, run["page_id"], artifact_ids[0], image_run_id)
                self._refresh_plan_visual_status(project_id, run["page_id"])
            self.store.emit_event("image.completed", project_id=project_id, page_id=run.get("page_id"), payload={"image_run_id": image_run_id, "artifact_ids": artifact_ids})
            return updated or run
        except ImageAdapterError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(attempt["usage_request_id"], status, error=str(exc))
            self.store.update_image_attempt(attempt["image_attempt_id"], status=status, error={"code": exc.code, "message": str(exc)})
            updated = self.store.update_image_run(project_id, image_run_id, status="awaiting_user_decision")
            self.store.emit_event("image.user_decision.required", project_id=project_id, page_id=run.get("page_id"), payload={"image_run_id": image_run_id, "attempt_id": attempt["image_attempt_id"], "error": exc.code})
            return updated or run
        except (ConflictError, NotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError, TypeError, ValueError) as exc:
            self.store.update_usage(attempt["usage_request_id"], "failed", error="artifact_validation_failed")
            self.store.update_image_attempt(
                attempt["image_attempt_id"],
                status="failed",
                error={"code": "artifact_validation_failed", "message": str(exc), "retryable": False},
            )
            updated = self.store.update_image_run(project_id, image_run_id, status="awaiting_user_decision")
            self.store.emit_event(
                "image.user_decision.required",
                project_id=project_id,
                page_id=run.get("page_id"),
                payload={"image_run_id": image_run_id, "attempt_id": attempt["image_attempt_id"], "error": "artifact_validation_failed"},
            )
            return updated or run

    def _apply_visual_artifact(self, project_id: str, page_id: str, artifact_id: str, image_run_id: str | None) -> None:
        page = self.store.get_page(project_id, page_id)
        artifact = self.store.get_artifact(project_id, artifact_id)
        if not page or not artifact or not str(artifact.get("media_type", "")).startswith("image/"):
            raise ConflictError("Generated visual is not a registered page image Artifact")
        version = self.store.create_page_version(project_id, page_id, {
            "operation_id": page.get("operation_id"),
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "quick_preview_artifact_id": page.get("quick_preview_artifact_id"),
            "visual_preview_artifact_id": artifact_id,
            "svg_artifact_id": None,
            "editable_level": "visual",
            "status": "previewing",
            "qa": {"visual_preview": "available", "visual_preview_media_type": artifact["media_type"], "full_slide_raster": False, "reconstruction": "not_started"},
        })
        contract = self._page_contract(project_id, self.store.get_page(project_id, page_id) or page)
        self.store.upsert_page_production_state(project_id, page_id, {
            "contract_revision": contract.contract_revision,
            "current_image_run_id": image_run_id,
            "selected_visual_artifact_id": artifact_id,
            "reconstruction_status": "pending",
        })
        if version:
            self.store.emit_event("page.version.created", project_id=project_id, page_id=page_id, version_id=version["version_id"], payload={"visual_reference": True})

    def _refresh_plan_visual_status(self, project_id: str, page_id: str) -> None:
        page = self.store.get_page(project_id, page_id)
        plan_id = page.get("operation_id") if page else None
        if not plan_id:
            return
        plan = self.store.get_plan(project_id, plan_id)
        if not plan or plan["status"] != "generating_visuals":
            return
        pages = [item for item in self.store.list_pages(project_id) if item.get("operation_id") == plan_id]
        if not pages or any(not item.get("visual_preview_artifact_id") for item in pages):
            return
        representative = bool(plan["structured_plan"].get("representativePreflight")) and len(pages) < len(plan["structured_plan"].get("pageDrafts") or [])
        status = "awaiting_representative_confirmation" if representative else "awaiting_visual_confirmation"
        structured = dict(plan["structured_plan"])
        structured.update({"generationStage": status, "nextAction": "confirm_representatives" if representative else "confirm_visuals", "generatedPageIds": [item["page_id"] for item in pages]})
        self.store.update_plan(project_id, plan_id, status=status, structured_plan=structured, confirmed=True)
        self.store.emit_event("confirmation.required", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id, "page_ids": structured["generatedPageIds"], "reasons": ["representative_visuals" if representative else "visuals"]})

    def approve_visual(self, owner_id: str, project_id: str, page_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        page = self.store.get_page(project_id, page_id)
        if not page:
            raise NotFoundError("Page not found")
        artifact = self.store.get_artifact(project_id, str(values.get("visual_artifact_id") or ""))
        if not artifact or not str(artifact.get("media_type", "")).startswith("image/") or artifact.get("sha256") != values.get("visual_sha256"):
            raise ConflictError("Visual artifact hash does not match the approval request")
        if page.get("visual_preview_artifact_id") != artifact["artifact_id"]:
            raise ConflictError("Only the current page visual can be approved")
        contract_revision = int(values.get("contract_revision", 1))
        contract = self._page_contract(project_id, page)
        if contract_revision != contract.contract_revision:
            raise ConflictError("Visual approval contract revision does not match the current PageContract")
        existing = next((item for item in self.store.list_visual_approvals(project_id, page_id) if item.get("actor_id") == owner_id and item.get("decision") == "approved" and item.get("visual_artifact_id") == artifact["artifact_id"] and item.get("visual_sha256") == artifact["sha256"] and int(item.get("contract_revision", 0)) == contract_revision), None)
        if existing:
            return existing
        result = self.store.create_visual_approval(project_id, {**values, "page_id": page_id, "actor_id": owner_id, "decision": "approved"})
        self.store.upsert_page_production_state(project_id, page_id, {"contract_revision": contract_revision, "selected_visual_artifact_id": values["visual_artifact_id"], "visual_approval_id": result["visual_approval_id"], "reconstruction_status": "failed"})
        self.store.emit_event("visual.approved", project_id=project_id, page_id=page_id, payload={"visual_approval_id": result["visual_approval_id"]})
        return result

    def reject_visual(self, owner_id: str, project_id: str, page_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if not self.store.get_page(project_id, page_id):
            raise NotFoundError("Page not found")
        artifact = self.store.get_artifact(project_id, str(values.get("visual_artifact_id") or ""))
        if not artifact or not str(artifact.get("media_type", "")).startswith("image/") or artifact.get("sha256") != values.get("visual_sha256"):
            raise ConflictError("Visual artifact hash does not match the rejection request")
        existing = next((item for item in self.store.list_visual_approvals(project_id, page_id) if item.get("actor_id") == owner_id and item.get("decision") == "rejected" and item.get("visual_artifact_id") == artifact["artifact_id"] and item.get("visual_sha256") == artifact["sha256"]), None)
        if existing:
            return existing
        result = self.store.create_visual_approval(project_id, {**values, "page_id": page_id, "actor_id": owner_id, "decision": "rejected"})
        self.store.emit_event("visual.rejected", project_id=project_id, page_id=page_id, payload={"visual_approval_id": result["visual_approval_id"]})
        return result

    def create_reconstruction_manifest(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        normalized = {
            **values,
            "schema_version": values.get("schema_version", SCHEMA_VERSION),
            "source_import_manifest_id": values.get("source_import_manifest_id"),
            "objects": list(values.get("objects") or []),
            "unresolved_items": list(values.get("unresolved_items") or []),
            "qa_report_id": values.get("qa_report_id") or "qa_pending",
        }
        validate_reconstruction_manifest(normalized)
        page_id = str(normalized["page_id"])
        page = self.store.get_page(project_id, page_id)
        if not page:
            raise NotFoundError("Page not found")
        version = self.store.get_version(project_id, str(normalized["version_id"]))
        if not version or version.get("page_id") != page_id:
            raise ConflictError("Reconstruction version does not belong to the page")
        contract_artifact = self.store.get_artifact(project_id, str(normalized["page_contract_artifact_id"]))
        if not contract_artifact or contract_artifact.get("media_type") != "application/json":
            raise ConflictError("Reconstruction PageContract Artifact is unavailable")
        qa_artifact = self.store.get_artifact(project_id, str(normalized["qa_report_id"]))
        if not qa_artifact or qa_artifact.get("media_type") != "application/json":
            raise ConflictError("Reconstruction QA report Artifact is unavailable")
        approvals = self.store.list_visual_approvals(project_id, page_id)
        approval = next((item for item in approvals if item["visual_approval_id"] == normalized["visual_approval_id"]), None)
        visual_artifact = self.store.get_artifact(project_id, str(approval.get("visual_artifact_id")) if approval else "")
        if not approval or approval.get("decision") != "approved" or not visual_artifact or approval.get("visual_sha256") != visual_artifact.get("sha256"):
            raise ConflictError("Reconstruction requires a matching approved visual Artifact")
        if int(approval.get("contract_revision", 0)) != int(normalized.get("contract_revision", approval.get("contract_revision", 0))):
            raise ConflictError("Visual approval contract revision does not match reconstruction")
        canonical = {key: normalized.get(key) for key in ("page_id", "version_id", "page_contract_artifact_id", "visual_approval_id", "source_import_manifest_id", "objects", "unresolved_items", "qa_report_id", "schema_version")}
        expected_aggregate = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if normalized.get("aggregate_sha256") != expected_aggregate:
            raise ConflictError("Reconstruction aggregate hash does not match its contents")
        if normalized.get("unresolved_items"):
            status = "partial"
        else:
            status = "ready"
        normalized["reconstruction_manifest_id"] = normalized.get("reconstruction_manifest_id") or new_id("reconstruction")
        manifest_artifact = self._record_artifact(project_id, "reconstruction_manifest", json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        result = self.store.create_reconstruction_manifest(project_id, {**normalized, "artifact_id": manifest_artifact["artifact_id"]})
        self.store.upsert_page_production_state(project_id, page_id, {"contract_revision": normalized.get("contract_revision", 1), "visual_approval_id": normalized["visual_approval_id"], "reconstruction_manifest_id": result["reconstruction_manifest_id"], "reconstruction_status": status})
        self.store.emit_event("reconstruction.completed" if status == "ready" else "reconstruction.needs_review", project_id=project_id, page_id=page_id, payload={"reconstruction_manifest_id": result["reconstruction_manifest_id"], "status": status})
        return result | {"status": status}

    def create_deck_revision(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        ordered = values.get("ordered_pages") or []
        if not ordered:
            raise ValueError("DeckRevision requires ordered_pages")
        source_session_id = str(values.get("source_session_id") or "")
        source_mode = str(values.get("source_mode") or "")
        if not source_session_id or source_mode not in {item.value for item in WorkflowMode}:
            raise ValueError("DeckRevision source session and mode are required")
        page_ids = [item.get("page_id") for item in ordered]
        if len(page_ids) != len(set(page_ids)) or any(not self.store.get_page(project_id, page_id) for page_id in page_ids):
            raise ConflictError("DeckRevision contains an invalid or duplicate page")
        for item in ordered:
            if not item.get("version_id") or not item.get("page_contract_artifact_id") or not item.get("reconstruction_manifest_artifact_id"):
                raise ValueError("DeckRevision page locks are incomplete")
            version = self.store.get_version(project_id, str(item["version_id"]))
            if not version or version.get("page_id") != item.get("page_id") or version.get("status") not in {"ready", "completed"}:
                raise ConflictError("DeckRevision version lock is unavailable")
            page_contract_artifact = self.store.get_artifact(project_id, str(item["page_contract_artifact_id"]))
            reconstruction_artifact = self.store.get_artifact(project_id, str(item["reconstruction_manifest_artifact_id"]))
            if not page_contract_artifact or page_contract_artifact.get("media_type") != "application/json" or not reconstruction_artifact or reconstruction_artifact.get("media_type") != "application/json":
                raise ConflictError("DeckRevision references an unavailable Artifact")
        status = str(values.get("status", "ready"))
        if status not in {"building", "ready", "superseded", "archived"}:
            raise ValueError("DeckRevision status is invalid")
        aggregate = hashlib.sha256(json.dumps(ordered, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if values.get("aggregate_sha256") and values["aggregate_sha256"] != aggregate:
            raise ConflictError("DeckRevision aggregate hash does not match its page locks")
        parent = values.get("parent_revision_id")
        if parent and not self.store.get_deck_revision(project_id, str(parent)):
            raise ConflictError("DeckRevision parent is unavailable")
        result = self.store.create_deck_revision(project_id, {**values, "source_session_id": source_session_id, "source_mode": source_mode, "aggregate_sha256": aggregate, "created_by": owner_id, "status": status})
        self.store.emit_event("deck.revision.created", project_id=project_id, payload={"deck_revision_id": result["deck_revision_id"], "aggregate_sha256": result["aggregate_sha256"]})
        return result

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
        if suffix == ".pptx":
            def register_media(media_content: bytes, media_type: str, _name: str) -> dict[str, str]:
                media_artifact = self._record_artifact(project_id, "pptx_import_media", media_content, media_type)
                return {
                    "artifact_id": media_artifact["artifact_id"],
                    "sha256": media_artifact["sha256"],
                    "media_type": media_artifact["media_type"],
                }

            manifest = extract_pptx_import_manifest(
                content,
                source_artifact_id=snapshot["artifact_id"],
                source_sha256=digest,
                register_media=register_media,
            )
            self.store.create_pptx_import_manifest(project_id, document["document_id"], manifest)
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
        source_findings = detect_untrusted_source_instructions(parsed.text)
        if source_findings:
            scan_artifact = self._record_artifact(
                project_id,
                "source_security_scan",
                json.dumps({"document_id": document_id, "findings": source_findings}, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                "application/json",
            )
            self.store.audit(owner_id, "source.untrusted_instruction_detected", project_id=project_id, entity_type="document", entity_id=document_id, detail={"artifact_id": scan_artifact["artifact_id"], "finding_types": sorted({item["kind"] for item in source_findings}), "count": len(source_findings)})
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

    def ingest_image_asset(self, owner_id: str, project_id: str, file_name: str, role: str, content: bytes, media_type: str, *, scope: str = "project", page_id: str | None = None) -> dict[str, Any]:
        self._project(owner_id, project_id)
        roles = {"finished_slide", "content_reference", "visual_reference", "layout_reference", "color_reference", "edit_target", "local_asset"}
        if role not in roles:
            raise ValueError("Image role is invalid")
        if scope not in {"project", "page"} or (scope == "page" and not page_id):
            raise ValueError("Image scope must be project or page, with page_id for page scope")
        if page_id and not self.store.get_page(project_id, page_id):
            raise NotFoundError("Page not found")
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
        asset = self.store.add_project_asset(project_id, artifact["artifact_id"], clean_name, role, media_type, artifact["sha256"], owner_id, scope=scope, page_id=page_id)
        self.store.audit(owner_id, "asset.ingest", project_id=project_id, entity_type="asset", entity_id=asset["asset_id"], detail={"role": role, "sha256": artifact["sha256"]})
        return asset

    def create_session(
        self,
        owner_id: str,
        project_id: str,
        workflow_mode: str,
        source_document_ids: list[str],
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._project(owner_id, project_id)
        mode = WorkflowMode(workflow_mode)
        documents = {item["document_id"]: item for item in self.store.list_documents(project_id)}
        known = set(documents)
        if set(source_document_ids).difference(known):
            raise ValueError("Session references an unknown document")
        session_options = dict(options or {})
        content_mode = str(session_options.get("content_mode") or "strict_preserve")
        if content_mode not in {"strict_preserve", "assisted"}:
            raise ValueError("content_mode must be strict_preserve or assisted")
        improvement_mode = str(session_options.get("improvement_mode") or "redesign")
        if improvement_mode not in {"redesign", "high_fidelity"}:
            raise ValueError("improvement_mode must be redesign or high_fidelity")
        representative_preflight = session_options.get("representative_preflight", False)
        if not isinstance(representative_preflight, bool):
            raise ValueError("representative_preflight must be boolean")
        if mode == WorkflowMode.DOCUMENT_CREATE and not source_document_ids:
            raise ValueError("document_create requires at least one source document")
        if mode == WorkflowMode.PPTX_IMPROVE:
            if len(source_document_ids) != 1 or not documents[source_document_ids[0]]["file_name"].casefold().endswith(".pptx"):
                raise ValueError("pptx_improve requires exactly one PPTX source")
        language = str(session_options.get("language") or "").strip()
        if len(language) > 35:
            raise ValueError("language is too long")
        audience = str(session_options.get("audience") or "").strip()
        purpose = str(session_options.get("purpose") or "").strip()
        user_instruction = str(session_options.get("user_instruction") or "").strip()
        if len(audience) > 500 or len(purpose) > 500 or len(user_instruction) > 4000:
            raise ValueError("audience, purpose, or user_instruction exceeds its limit")
        page_count = dict(session_options.get("page_count") or {"mode": "auto", "exact": None, "min": None, "max": None})
        page_mode = str(page_count.get("mode") or "auto")
        if page_mode not in {"exact", "range", "auto"}:
            raise ValueError("page_count.mode must be exact, range, or auto")
        normalized_page_count = {"mode": page_mode, "exact": None, "min": None, "max": None}
        if page_mode == "exact":
            exact = page_count.get("exact")
            if not isinstance(exact, int) or isinstance(exact, bool) or not 1 <= exact <= 100:
                raise ValueError("page_count.exact must be an integer from 1 to 100")
            normalized_page_count["exact"] = exact
        elif page_mode == "range":
            minimum, maximum = page_count.get("min"), page_count.get("max")
            if any(not isinstance(item, int) or isinstance(item, bool) for item in (minimum, maximum)) or not 1 <= minimum <= maximum <= 100:
                raise ValueError("page_count range must satisfy 1 <= min <= max <= 100")
            normalized_page_count.update({"min": minimum, "max": maximum})
        logic_enabled = session_options.get("logic_diagnosis_enabled", False)
        if not isinstance(logic_enabled, bool):
            raise ValueError("logic_diagnosis_enabled must be boolean")
        output_formats = list(session_options.get("output_formats") or ["markdown"])
        if not output_formats or any(item not in {"markdown", "txt", "docx"} for item in output_formats):
            raise ValueError("output_formats may contain markdown, txt, and docx")
        session_options.update({
            "content_mode": content_mode,
            "improvement_mode": improvement_mode,
            "representative_preflight": representative_preflight,
            "language": language,
            "audience": audience,
            "purpose": purpose,
            "page_count": normalized_page_count,
            "logic_diagnosis_enabled": logic_enabled,
            "output_formats": list(dict.fromkeys(output_formats)),
            "user_instruction": user_instruction,
        })
        return self.store.create_work_session(project_id, mode.value, source_document_ids, owner_id, session_options)

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

    @staticmethod
    def _infer_language(drafts: list[dict[str, Any]]) -> str:
        text = "".join(f"{item.get('title', '')}{item.get('body', '')}" for item in drafts)
        if not text:
            return "zh-CN"
        cjk = sum("\u4e00" <= character <= "\u9fff" for character in text)
        return "zh-CN" if cjk >= max(1, len(text) // 20) else "en-US"

    @staticmethod
    def _apply_page_count_policy(drafts: list[dict[str, Any]], policy: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        mode = str(policy.get("mode") or "auto")
        if mode == "exact":
            target = int(policy["exact"])
            reason = f"The user requested exactly {target} pages."
        elif mode == "range":
            minimum, maximum = int(policy["min"]), int(policy["max"])
            target = min(max(len(drafts), minimum), maximum)
            reason = f"The source-derived plan was clamped to the requested {minimum}-{maximum} page range."
        else:
            target = len(drafts)
            reason = f"AI suggestion retained {target} source-derived pages based on the document structure."
        bounded = [dict(item) for item in drafts[:target]]
        while len(bounded) < target:
            source = max(bounded or drafts, key=lambda item: len(str(item.get("body") or "")), default={"title": "Continuation", "body": ""})
            body = str(source.get("body") or "")
            lines = [line for line in body.splitlines() if line.strip()]
            if len(lines) > 1:
                midpoint = max(1, len(lines) // 2)
                source["body"] = "\n".join(lines[:midpoint])
                continuation_body = "\n".join(lines[midpoint:])
            else:
                continuation_body = body
            bounded.append({
                **source,
                "title": f"{source.get('title') or 'Continuation'} ({len(bounded) + 1})",
                "body": continuation_body,
            })
        return bounded, reason

    def _agent_output(self, project_id: str, run: dict[str, Any]) -> dict[str, Any]:
        output_ids = list(run.get("output_artifact_ids") or [])
        if not output_ids:
            raise ConflictError("Completed AgentRun is missing its OutputArtifact")
        try:
            value = json.loads(self._artifact_bytes(project_id, output_ids[0]).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConflictError("Agent OutputArtifact is not valid JSON") from exc
        if not isinstance(value, dict):
            raise ConflictError("Agent OutputArtifact must contain a JSON object")
        return value

    def _render_docx_qa(self, content: bytes) -> dict[str, Any]:
        base = {
            "schema_version": SCHEMA_VERSION,
            "check": "docx_render",
            "required": True,
            "docx_sha256": hashlib.sha256(content).hexdigest(),
            "checked_at": datetime.now(UTC).isoformat(),
        }
        if os.name != "nt":
            if self.settings.production:
                raise ConflictError("DOCX export requires an available render backend")
            return {**base, "status": "unavailable", "renderer": None, "release_blocking": True, "reason": "Microsoft Word COM is available only on Windows"}
        try:
            import pythoncom
            import win32com.client
            from pypdf import PdfReader
        except ImportError as exc:
            if self.settings.production:
                raise ConflictError("DOCX export requires the Windows render dependencies") from exc
            return {**base, "status": "unavailable", "renderer": None, "release_blocking": True, "reason": "Windows render dependencies are unavailable"}

        pythoncom.CoInitialize()
        word = None
        document = None
        try:
            try:
                word = win32com.client.DispatchEx("Word.Application")
            except Exception as exc:
                if self.settings.production:
                    raise ConflictError("DOCX export requires Microsoft Word for render QA") from exc
                return {**base, "status": "unavailable", "renderer": None, "release_blocking": True, "reason": "Microsoft Word COM is unavailable"}
            word.Visible = False
            word.DisplayAlerts = 0
            word.AutomationSecurity = 3
            with tempfile.TemporaryDirectory(dir=self.settings.temp_dir) as temp_name:
                root = Path(temp_name)
                docx_path = root / "outline.docx"
                pdf_path = root / "outline.pdf"
                docx_path.write_bytes(content)
                try:
                    document = word.Documents.Open(
                        str(docx_path),
                        ConfirmConversions=False,
                        ReadOnly=True,
                        AddToRecentFiles=False,
                        Visible=False,
                        OpenAndRepair=False,
                        NoEncodingDialog=True,
                    )
                    document.Repaginate()
                    word_page_count = int(document.ComputeStatistics(2))
                    document.ExportAsFixedFormat(str(pdf_path), 17, OpenAfterExport=False)
                    document.Close(False)
                    document = None
                except Exception as exc:
                    raise ConflictError("Generated DOCX failed Microsoft Word render QA") from exc
                if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
                    raise ConflictError("Generated DOCX render QA did not produce a PDF")
                pdf_content = pdf_path.read_bytes()
                try:
                    pdf_page_count = len(PdfReader(io.BytesIO(pdf_content)).pages)
                except Exception as exc:
                    raise ConflictError("Generated DOCX render QA produced an unreadable PDF") from exc
                if word_page_count < 1 or pdf_page_count != word_page_count:
                    raise ConflictError("Generated DOCX render QA page counts do not match")
                return {
                    **base,
                    "status": "passed",
                    "renderer": "Microsoft Word COM",
                    "renderer_version": str(word.Version),
                    "word_page_count": word_page_count,
                    "pdf_page_count": pdf_page_count,
                    "pdf_sha256": hashlib.sha256(pdf_content).hexdigest(),
                    "release_blocking": False,
                }
        finally:
            if document is not None:
                try:
                    document.Close(False)
                except Exception:
                    pass
            if word is not None:
                try:
                    word.Quit()
                except Exception:
                    pass
            pythoncom.CoUninitialize()

    def _content_plan_exports(self, project_id: str, plan: dict[str, Any], output_formats: list[str]) -> tuple[dict[str, str], dict[str, str]]:
        exports: dict[str, str] = {}
        qa_artifacts: dict[str, str] = {}
        for output_format in output_formats:
            content, media_type, file_name = render_content_plan(plan, output_format)
            if output_format == "docx":
                parsed = parse_document(file_name, content)
                expected_titles = [str(item.get("title") or "") for item in plan.get("pageDrafts") or []]
                if any(title and title not in parsed.text for title in expected_titles):
                    raise ConflictError("Generated DOCX content-plan export failed its read-back check")
                qa = self._render_docx_qa(content)
                qa_artifact = self._record_artifact(project_id, "content_plan_docx_render_qa", json.dumps(qa, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
                qa_artifacts[output_format] = qa_artifact["artifact_id"]
            artifact = self._record_artifact(project_id, f"content_plan_{output_format}", content, media_type)
            exports[output_format] = artifact["artifact_id"]
        return exports, qa_artifacts

    def export_content_plan(self, owner_id: str, project_id: str, plan_id: str, output_format: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        content, media_type, file_name = render_content_plan(plan["structured_plan"], output_format)
        if output_format == "docx":
            parsed = parse_document(file_name, content)
            if "Content plan" not in parsed.text:
                raise ConflictError("Generated DOCX content-plan export failed its read-back check")
            qa = self._render_docx_qa(content)
            qa_artifact = self._record_artifact(project_id, "content_plan_docx_render_qa", json.dumps(qa, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        else:
            qa = None
            qa_artifact = None
        artifact = self._record_artifact(project_id, f"content_plan_{output_format}", content, media_type)
        self.store.audit(owner_id, "content_plan.export", project_id=project_id, entity_type="plan", entity_id=plan_id, detail={"format": output_format, "artifact_id": artifact["artifact_id"], "qa_artifact_id": (qa_artifact or {}).get("artifact_id")})
        return {"plan_id": plan_id, "format": output_format, "file_name": file_name, "artifact_id": artifact["artifact_id"], "sha256": artifact["sha256"], "media_type": media_type, "qa": qa, "qa_artifact_id": (qa_artifact or {}).get("artifact_id")}

    def update_generation_plan_content(
        self,
        owner_id: str,
        project_id: str,
        plan_id: str,
        page_drafts: list[dict[str, Any]],
        *,
        storyline: list[str] | None = None,
        confirm_invalidation: bool = False,
    ) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] == "cancelled":
            raise ConflictError("Cancelled plan cannot be edited")
        if not 1 <= len(page_drafts) <= 100:
            raise ValueError("Content-plan edits require between 1 and 100 pages")
        structured = dict(plan["structured_plan"])
        existing = [dict(item) for item in structured.get("pageDrafts") or []]
        existing_by_id = {str(item.get("page_draft_id")): item for item in existing}
        post_confirmation = plan["status"] != "awaiting_content_confirmation"
        if post_confirmation and not confirm_invalidation:
            page_count_changed = len(page_drafts) != len(existing)
            return {
                "plan_id": plan_id,
                "status": plan["status"],
                "confirmation_required": True,
                "confirmation_reasons": [
                    "content_change_invalidates_generated_pages",
                    *(("page_count_change",) if page_count_changed else ()),
                    "restart_recommended",
                ],
                "generated_draft_ids": list(structured.get("generatedDraftIds") or []),
            }
        known_facts = {item["fact_id"] for item in self.store.list_facts(project_id)}
        generated = set(structured.get("generatedDraftIds") or [])
        source_hashes = list(dict.fromkeys(str(value) for item in existing for value in item.get("source_hashes") or []))
        requested_drafts: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        changed_ids: list[str] = []
        for index, requested in enumerate(page_drafts):
            supplied_id = str(requested.get("page_draft_id") or "")
            draft_id = supplied_id if supplied_id in existing_by_id else new_id("page_draft")
            if draft_id in seen_ids:
                raise ValueError("Content-plan draft IDs must be unique")
            seen_ids.add(draft_id)
            original = existing_by_id.get(draft_id, {})
            title = " ".join(str(requested.get("title") or "").split())
            body = str(requested.get("body") or "").strip()
            central_claim = str(requested.get("central_claim") or requested.get("core_point") or "").strip()
            conclusion = str(requested.get("conclusion") or original.get("conclusion") or "").strip()
            visual_suggestion = str(requested.get("visual_suggestion") or "").strip()
            fact_ids = [str(item) for item in requested.get("fact_ids") or []]
            verbatim_text = list(dict.fromkeys(str(item) for item in requested.get("verbatim_text", original.get("verbatim_text", [])) or [] if str(item)))
            if not title or len(title) > 160 or len(body) > 5000 or len(central_claim) > 500 or len(conclusion) > 500 or len(visual_suggestion) > 1000:
                raise ValueError(f"Content-plan draft {draft_id} exceeds its field bounds")
            if any(item not in known_facts for item in fact_ids):
                raise ConflictError("Content-plan edit references a fact outside the current project")
            updated = {
                **original,
                "page_draft_id": draft_id,
                "order_index": index,
                "title": title,
                "body": body,
                "central_claim": central_claim,
                "core_point": central_claim,
                "conclusion": conclusion,
                "fact_ids": list(dict.fromkeys(fact_ids)),
                "verbatim_text": verbatim_text,
                "visual_suggestion": visual_suggestion,
                "page_type": str(requested.get("page_type") or original.get("page_type") or ("cover" if index == 0 else "content")),
                "source_hashes": list(original.get("source_hashes") or source_hashes),
            }
            if not original or any(updated.get(key) != original.get(key) for key in ("order_index", "title", "body", "central_claim", "conclusion", "fact_ids", "verbatim_text", "visual_suggestion", "page_type")):
                changed_ids.append(draft_id)
            requested_drafts.append(updated)

        removed_ids = [draft_id for draft_id in existing_by_id if draft_id not in seen_ids]
        revised = list(requested_drafts)
        if post_confirmation and generated:
            revised = [existing_by_id[item["page_draft_id"]] if item["page_draft_id"] in generated else item for item in revised]
            revised = [item for item in revised if item["page_draft_id"] not in generated]
            for original_index, original in enumerate(existing):
                if original["page_draft_id"] in generated:
                    revised.insert(min(original_index, len(revised)), original)
            for index, item in enumerate(revised):
                item["order_index"] = index
            changed_ids.extend(draft_id for draft_id in generated if draft_id in seen_ids and requested_drafts[[item["page_draft_id"] for item in requested_drafts].index(draft_id)] != existing_by_id[draft_id])
        changed_ids.extend(removed_ids)
        changed_ids = list(dict.fromkeys(changed_ids))
        if storyline is not None:
            if len(storyline) > 100 or any(not isinstance(item, str) or len(item) > 500 for item in storyline):
                raise ValueError("storyline is invalid")
            structured["storyline"] = [item.strip() for item in storyline if item.strip()]
        else:
            structured["storyline"] = [item["title"] for item in revised]
        structured["pageDrafts"] = revised
        previous_page_count = int((structured.get("pageCount") or {}).get("value") or len(existing))
        structured["pageCount"] = {
            **dict(structured.get("pageCount") or {}),
            "mode": "exact",
            "value": len(revised),
            "min": None,
            "max": None,
            "reason": f"The user edited the content plan from {previous_page_count} to {len(revised)} pages.",
        }
        structured["contentRevision"] = int(structured.get("contentRevision") or 0) + 1
        if post_confirmation and generated and (changed_ids or len(revised) != len(existing)):
            structured["consistencyStatus"] = "mixed_content"
        structured["contentExportArtifactIds"], structured["contentExportQaArtifactIds"] = self._content_plan_exports(
            project_id,
            structured,
            list(structured.get("outputFormats") or ["markdown"]),
        )
        pending_generation = [item for item in revised if item["page_draft_id"] not in generated]
        can_generate_pending = (
            post_confirmation
            and bool(generated)
            and bool(pending_generation)
            and isinstance(structured.get("designSnapshot"), dict)
            and plan["status"] in {"generating_visuals", "awaiting_visual_confirmation", "reconstructing", "completed"}
        )
        if can_generate_pending:
            selection_id = structured.get("designSelectionId")
            snapshot = dict(structured["designSnapshot"])
            pending_generation = [
                {**self._apply_design_snapshot(dict(item), snapshot), "design_selection_id": selection_id}
                for item in pending_generation
            ]
            pending_by_id = {item["page_draft_id"]: item for item in pending_generation}
            structured["pageDrafts"] = [pending_by_id.get(item["page_draft_id"], item) for item in revised]
            structured.update({"generationStage": "generating_visuals", "nextAction": "wait_for_visuals"})
            self.store.update_plan(project_id, plan_id, status="generating_visuals", structured_plan=structured, confirmed=True)
            created_pages = self.materialize_pages(
                owner_id,
                project_id,
                pending_generation,
                operation_id=plan_id,
                preview_only=True,
                create_visual_reference=self.settings.test_fixtures_enabled,
            )
            self._queue_visual_runs(owner_id, project_id, created_pages)
            generated.update(item["page_draft_id"] for item in pending_generation)
            generated_page_ids = list(dict.fromkeys([*(structured.get("generatedPageIds") or []), *(item["page_id"] for item in created_pages)]))
            next_status = "awaiting_visual_confirmation" if self.settings.test_fixtures_enabled else "generating_visuals"
            structured.update({
                "generatedDraftIds": sorted(generated),
                "generatedPageIds": generated_page_ids,
                "generationStage": next_status,
                "nextAction": "confirm_visuals" if self.settings.test_fixtures_enabled else "wait_for_visuals",
            })
            self.store.update_plan(project_id, plan_id, status=next_status, structured_plan=structured, confirmed=True)
        else:
            self.store.update_plan(project_id, plan_id, status=plan["status"], structured_plan=structured, confirmed=post_confirmation)
        self.store.audit(owner_id, "content_plan.edit", project_id=project_id, entity_type="plan", entity_id=plan_id, detail={"changed_draft_ids": changed_ids, "removed_draft_ids": removed_ids, "generated_draft_ids_preserved": sorted(generated.intersection(existing_by_id)), "page_count": len(revised), "consistency_status": structured.get("consistencyStatus")})
        return self.store.get_plan(project_id, plan_id) or plan

    @staticmethod
    def _audit_zip(files: dict[str, Any]) -> bytes:
        output = io.BytesIO()
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            for name, value in sorted(files.items()):
                info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                payload = json.dumps(redact_sensitive(value), ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
                archive.writestr(info, payload)
        return output.getvalue()

    @staticmethod
    def _audit_digest(value: Any) -> str:
        text = str(value or "")
        if not text:
            return ""
        return text if text.startswith("sha256:") else f"sha256:{text}"

    def _provider_binding(
        self,
        project_id: str,
        *,
        run: dict[str, Any],
        run_kind: str,
        prompt_artifact_id: str | None,
        input_artifact_ids: list[str],
        output_artifact_ids: list[str],
        usage_request_id: str | None,
    ) -> dict[str, Any] | None:
        """Create a redacted, internally cross-linked evidence attestation."""
        def artifact_binding(artifact_id: str | None) -> dict[str, Any] | None:
            if not artifact_id:
                return None
            artifact = self.store.get_artifact(project_id, str(artifact_id))
            if not artifact:
                return None
            try:
                self._artifact_bytes(project_id, str(artifact_id))
            except (ConflictError, NotFoundError, OSError):
                return None
            return {
                "artifact_id": artifact["artifact_id"],
                "sha256": self._audit_digest(artifact.get("sha256")),
                "media_type": artifact.get("media_type"),
                "size_bytes": int(artifact.get("size_bytes") or 0),
                "kind": artifact.get("kind"),
            }

        prompt = artifact_binding(prompt_artifact_id)
        inputs = [artifact_binding(item) for item in input_artifact_ids]
        outputs = [artifact_binding(item) for item in output_artifact_ids]
        usage = self.store.usage_by_request(str(usage_request_id or "")) if usage_request_id else None
        if not prompt or any(item is None for item in [*inputs, *outputs]) or not usage:
            return None
        binding: dict[str, Any] = {
            "binding_version": "1.0",
            "project_id": project_id,
            "run": {
                "run_id": run.get("agent_run_id") or run.get("image_attempt_id") or run.get("image_run_id"),
                "run_kind": run_kind,
                "status": run.get("status"),
                "provider_request_id": run.get("provider_request_id"),
                "prompt_artifact_id": prompt_artifact_id,
                "input_artifact_ids": list(input_artifact_ids),
                "output_artifact_ids": list(output_artifact_ids),
                "usage_request_id": usage_request_id,
            },
            "prompt_artifact": prompt,
            "input_artifacts": [item for item in inputs if item is not None],
            "output_artifacts": [item for item in outputs if item is not None],
            "usage": {
                "request_id": usage.get("request_id"),
                "project_id": usage.get("project_id"),
                "submission_status": usage.get("submission_status"),
            },
        }
        binding["binding_digest"] = sha256_json(binding)
        return binding

    def _provider_evidence_for_agent_run(self, project_id: str, run: dict[str, Any]) -> dict[str, Any] | None:
        if run.get("status") != "completed":
            return None
        provider = dict(run.get("provider_snapshot") or {})
        backend = str(provider.get("backend") or "")
        endpoint_mode = str(provider.get("endpoint_mode") or "")
        if backend == "codex" and endpoint_mode == "relay":
            evidence_type = "real_codex_relay_structured_agent_call"
        elif backend == "codex":
            evidence_type = "real_codex_structured_agent_call"
        elif backend:
            evidence_type = f"{backend}_structured_agent_call"
        else:
            evidence_type = "agent_call_completed"
        input_ids = [str(item) for item in run.get("input_artifact_ids") or []]
        input_hashes = []
        for artifact_id in input_ids:
            artifact = self.store.get_artifact(project_id, artifact_id)
            if artifact:
                input_hashes.append(self._audit_digest(artifact.get("sha256")))
        usage = self.store.usage_by_request(str(run.get("usage_request_id") or ""))
        binding = self._provider_binding(
            project_id,
            run=run,
            run_kind="agent_run",
            prompt_artifact_id=run.get("prompt_artifact_id"),
            input_artifact_ids=input_ids,
            output_artifact_ids=list(run.get("output_artifact_ids") or []),
            usage_request_id=run.get("usage_request_id"),
        )
        if not binding:
            return None
        return {
            "evidence_type": evidence_type,
            "schema_version": SCHEMA_VERSION,
            "project_id": project_id,
            "agent_run_id": run.get("agent_run_id"),
            "role": run.get("role"),
            "status": run.get("status"),
            "provider_snapshot": provider,
            "provider_request_id": run.get("provider_request_id"),
            "prompt_artifact_id": run.get("prompt_artifact_id"),
            "context_manifest_artifact_id": run.get("context_manifest_artifact_id"),
            "truncation_report_artifact_id": run.get("truncation_report_artifact_id"),
            "input_artifact_ids": input_ids,
            "input_artifact_hashes": input_hashes,
            "input_context_digest": self._audit_digest(run.get("input_context_digest") or run.get("context_digest")),
            "prompt_digest": self._audit_digest(run.get("prompt_digest")),
            "output_artifact_ids": list(run.get("output_artifact_ids") or []),
            "output_digest": self._audit_digest(run.get("output_digest")),
            "usage_request_id": run.get("usage_request_id"),
            "usage": [usage] if usage else [],
            "binding": binding,
            "binding_digest": binding["binding_digest"],
            "redaction": {"full_prompt": "omitted", "raw_response": "omitted", "credentials": "omitted"},
        }

    def _provider_evidence_for_image_attempt(self, project_id: str, image_run: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any] | None:
        if attempt.get("status") != "completed":
            return None
        provider = dict(attempt.get("provider_snapshot") or {})
        model = str(attempt.get("model") or provider.get("model") or "")
        endpoint_mode = str(attempt.get("endpoint_mode") or provider.get("endpoint_mode") or "")
        has_inputs = bool(image_run.get("input_artifact_ids") or attempt.get("input_summary"))
        if model == "gpt-image-2" and endpoint_mode == "relay":
            evidence_type = "real_gpt_image2_edit" if has_inputs else "real_gpt_image2_generation"
        else:
            evidence_type = "image_edit_completed" if has_inputs else "image_generation_completed"
        input_summary = list(attempt.get("input_summary") or [])
        input_ids = [str(item) for item in image_run.get("input_artifact_ids") or []]
        input_hashes = [self._audit_digest(item.get("sha256")) for item in input_summary if isinstance(item, dict) and item.get("sha256")]
        if not input_hashes:
            input_hashes = [self._audit_digest(item) for item in image_run.get("input_hashes") or []]
        envelope: dict[str, Any] = {}
        prompt_artifact_id = attempt.get("prompt_artifact_id") or image_run.get("prompt_artifact_id")
        if prompt_artifact_id:
            try:
                envelope = json.loads(self._artifact_bytes(project_id, str(prompt_artifact_id)).decode("utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ConflictError):
                envelope = {}
        usage = self.store.usage_by_request(str(attempt.get("usage_request_id") or ""))
        binding = self._provider_binding(
            project_id,
            run={**attempt, "image_run_id": image_run.get("image_run_id")},
            run_kind="image_attempt",
            prompt_artifact_id=prompt_artifact_id,
            input_artifact_ids=input_ids,
            output_artifact_ids=list(attempt.get("output_artifact_ids") or []),
            usage_request_id=attempt.get("usage_request_id"),
        )
        if not binding:
            return None
        return {
            "evidence_type": evidence_type,
            "schema_version": SCHEMA_VERSION,
            "project_id": project_id,
            "image_run_id": image_run.get("image_run_id"),
            "image_attempt_id": attempt.get("image_attempt_id"),
            "purpose": image_run.get("purpose"),
            "status": attempt.get("status"),
            "provider_snapshot": provider,
            "provider_request_id": attempt.get("provider_request_id"),
            "prompt_artifact_id": prompt_artifact_id,
            "input_artifact_ids": input_ids,
            "input_artifact_hashes": input_hashes,
            "input_context_digest": self._audit_digest(envelope.get("input_context_digest")),
            "prompt_digest": self._audit_digest(envelope.get("prompt_digest")),
            "output_artifact_ids": list(attempt.get("output_artifact_ids") or []),
            "output_digest": self._audit_digest(attempt.get("output_digest")),
            "usage_request_id": attempt.get("usage_request_id"),
            "usage": [usage] if usage else [],
            "binding": binding,
            "binding_digest": binding["binding_digest"],
            "redaction": {"full_prompt": "omitted", "raw_response": "omitted", "credentials": "omitted"},
        }

    def _provider_evidence_files(self, project_id: str, agent_runs: list[dict[str, Any]], image_runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        files: dict[str, dict[str, Any]] = {}
        for run in agent_runs:
            evidence = self._provider_evidence_for_agent_run(project_id, run)
            if evidence:
                files[f"provider_evidence/agent-{run['agent_run_id']}.json"] = evidence
        for image_run in image_runs:
            for attempt in self.store.list_image_attempts(project_id, image_run["image_run_id"]):
                evidence = self._provider_evidence_for_image_attempt(project_id, image_run, attempt)
                if evidence:
                    files[f"provider_evidence/image-{attempt['image_attempt_id']}.json"] = evidence
        return files

    def export_audit_package(self, owner_id: str, project_id: str) -> tuple[bytes, str]:
        project = self._project(owner_id, project_id)
        agent_runs = self.store.list_agent_runs(project_id)
        image_runs = self.store.list_image_runs(project_id)
        files: dict[str, Any] = {
            "manifest.json": {
                "schema_version": SCHEMA_VERSION,
                "project_id": project_id,
                "generated_at": datetime.now(UTC).isoformat(),
                "redaction": "credentials and secret references removed",
                "excluded": ["private_design_pack_resources", "api_keys", "authorization_values"],
            },
            "project.json": {key: project.get(key) for key in ("project_id", "name", "status", "created_at", "updated_at")},
            "plans.json": self.store.list_plans(project_id),
            "agent_runs.json": agent_runs,
            "image_runs.json": image_runs,
            "image_attempts.json": [attempt for run in image_runs for attempt in self.store.list_image_attempts(project_id, run["image_run_id"])],
            "audit_log.json": self.store.list_project_audit(project_id),
        }
        files.update(self._provider_evidence_files(project_id, agent_runs, image_runs))
        for envelope_row in self.store.list_prompt_envelopes(project_id, active_only=True):
            task_id = envelope_row["agent_run_id"]
            try:
                files[f"prompt_envelopes/{task_id}.json"] = json.loads(self._artifact_bytes(project_id, envelope_row["prompt_artifact_id"]).decode("utf-8"))
                context = self.store.get_context_manifest(project_id, task_id)
                truncation = self.store.get_truncation_report(project_id, task_id)
                if context:
                    files[f"context_manifests/{task_id}.json"] = json.loads(self._artifact_bytes(project_id, context["artifact_id"]).decode("utf-8"))
                if truncation:
                    truncation_payload = json.loads(self._artifact_bytes(project_id, truncation["artifact_id"]).decode("utf-8"))
                    files[f"truncation_reports/{task_id}.json"] = truncation_payload
                    summary_artifact_id = truncation_payload.get("summary_artifact_id")
                    if summary_artifact_id:
                        files[f"context_summaries/{task_id}.json"] = json.loads(self._artifact_bytes(project_id, str(summary_artifact_id)).decode("utf-8"))
                run = self.store.get_agent_run(project_id, task_id)
                for index, artifact_id in enumerate((run or {}).get("output_artifact_ids") or []):
                    try:
                        files[f"agent_outputs/{task_id}-{index + 1}.json"] = json.loads(self._artifact_bytes(project_id, artifact_id).decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ConflictError):
                continue
        content = self._audit_zip(files)
        self.store.audit(owner_id, "audit_package.export", project_id=project_id, entity_type="project", entity_id=project_id, detail={"size_bytes": len(content), "active_prompt_count": len(self.store.list_prompt_envelopes(project_id, active_only=True))})
        return content, f"fastppt-{project_id}-audit.zip"

    @staticmethod
    def _source_chunks(text: str, *, characters: int = 25_000) -> list[str]:
        return [text[index:index + characters] for index in range(0, len(text), characters)] or [""]

    def _source_analysis_run(
        self,
        owner_id: str,
        project_id: str,
        session: dict[str, Any],
        source_artifacts: list[str],
        facts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        sources: list[dict[str, Any]] = []
        findings: list[dict[str, str]] = []
        for document_id in session["source_document_ids"]:
            document = self.store.get_document(project_id, document_id)
            if not document:
                continue
            parsed = parse_document(document["file_name"], self._artifact_bytes(project_id, document["artifact_id"]))
            sources.append({"document_id": document_id, "sha256": document["sha256"], "text": parsed.text})
            findings.extend(detect_untrusted_source_instructions(parsed.text))
        total_tokens = estimate_tokens([item["text"] for item in sources])
        session_options = dict(session.get("options") or {})
        session_options["workflow_mode"] = session.get("workflow_mode")
        common = {
            "source_count": len(source_artifacts),
            "fact_count": len(facts),
            "coverage_hashes": ["sha256:" + item["sha256"] for item in sources],
            "untrusted_source_instructions": findings,
            "user_options": {
                key: session_options.get(key)
                for key in (
                    "language",
                    "audience",
                    "purpose",
                    "page_count",
                    "content_mode",
                    "user_instruction",
                    "workflow_mode",
                )
                if key == "page_count" or session_options.get(key) not in (None, "")
            },
        }
        if total_tokens < 100_000:
            return self._record_stage_agent_run(owner_id, project_id, role="source_analyst", session_id=session["session_id"], input_artifact_ids=source_artifacts, summary={**common, "estimated_tokens": total_tokens})
        chunk_runs: list[dict[str, Any]] = []
        for source in sources:
            for chunk_index, chunk in enumerate(self._source_chunks(source["text"]), 1):
                chunk_artifact = self._record_artifact(project_id, "source_chunk", chunk.encode("utf-8"), "text/plain")
                chunk_runs.append(self._record_stage_agent_run(
                    owner_id,
                    project_id,
                    role="source_analyst",
                    session_id=session["session_id"],
                    input_artifact_ids=[chunk_artifact["artifact_id"]],
                    summary={
                        **common,
                        "hierarchical_stage": "chunk",
                        "document_id": source["document_id"],
                        "chunk_index": chunk_index,
                        "chunk_sha256": "sha256:" + chunk_artifact["sha256"],
                    },
                ))
        if not chunk_runs:
            raise ConflictError("Long-context source did not produce analyzable chunks")
        aggregate = self._record_stage_agent_run(
            owner_id,
            project_id,
            role="source_analyst",
            session_id=session["session_id"],
            parent_run_id=chunk_runs[0]["agent_run_id"],
            input_artifact_ids=[artifact_id for run in chunk_runs for artifact_id in run["output_artifact_ids"]],
            summary={**common, "hierarchical_stage": "aggregate", "chunk_count": len(chunk_runs), "estimated_tokens": total_tokens},
        )
        self.store.audit(
            owner_id,
            "agent.output.applied",
            project_id=project_id,
            entity_type="agent_context",
            entity_id=aggregate["agent_run_id"],
            detail={
                "agent_run_id": aggregate["agent_run_id"],
                "source_run_ids": [item["agent_run_id"] for item in chunk_runs],
                "fields": ["chunk_output_artifact_ids", "coverage_hashes"],
                "next_stage": "source_analyst.aggregate",
            },
        )
        return aggregate

    @staticmethod
    def _fact_context_rows(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        fields = ("fact_id", "kind", "value", "normalized_value", "source_document_id", "source_locator", "confidence", "locked", "conflict_key")
        return [{key: fact.get(key) for key in fields} for fact in facts]

    def _page_writer_plan_drafts(
        self,
        owner_id: str,
        project_id: str,
        session_id: str,
        drafts: list[dict[str, Any]],
        facts: list[dict[str, Any]],
        parent_run_id: str,
        content_mode: str,
        language: str,
        audience: str,
    ) -> list[dict[str, Any]]:
        known_facts = {item["fact_id"] for item in facts}
        written: list[dict[str, Any]] = []
        for draft in drafts:
            fact_ids = self._draft_fact_ids(project_id, draft, facts)
            page_facts = [item for item in facts if item["fact_id"] in fact_ids]
            locked_facts = [item for item in page_facts if item.get("locked")]
            locked_fact_ids = [item["fact_id"] for item in locked_facts]
            required_verbatim = list(dict.fromkeys(str(item) for item in draft.get("verbatim_text") or [] if str(item)))
            candidate = {
                **draft,
                "fact_ids": fact_ids,
                "locked_fact_ids": locked_fact_ids,
                "locked_fact_values": [str(item.get("value") or "") for item in locked_facts],
                "verbatim_text": required_verbatim,
            }
            draft_artifact = self._record_artifact(project_id, "page_draft", json.dumps(candidate, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
            run = self._record_stage_agent_run(
                owner_id,
                project_id,
                role="page_writer",
                session_id=session_id,
                parent_run_id=parent_run_id,
                input_artifact_ids=[draft_artifact["artifact_id"]],
                summary={
                    "page_drafts": [candidate],
                    "reviewed_facts": self._fact_context_rows(page_facts),
                    "locked_facts": self._fact_context_rows(locked_facts),
                    "verbatim_text": required_verbatim,
                    "content_mode": content_mode,
                    "language": language,
                    "audience": audience,
                },
            )
            output = self._agent_output(project_id, run)
            if output.get("splitRecommended"):
                raise ConflictError("Page Writer recommends splitting an over-dense page; revise the page-count policy")
            output_fact_ids = [str(item) for item in output.get("factIds") or fact_ids]
            if any(item not in known_facts for item in output_fact_ids):
                raise ConflictError("Page Writer referenced a fact outside the current project")
            if set(locked_fact_ids).difference(output_fact_ids):
                raise ConflictError("Page Writer dropped a locked fact reference")
            paragraphs = [str(item).strip() for item in output.get("bodyParagraphs") or [] if str(item).strip()]
            body = "\n".join(paragraphs) or str(draft.get("body") or "")
            title = " ".join(str(output.get("title") or draft.get("title") or "").split())
            conclusion = str(output.get("conclusion") or "")[:500]
            output_verbatim = [str(item) for item in output.get("verbatimText") or [] if str(item)]
            preserved_verbatim = list(dict.fromkeys([*required_verbatim, *output_verbatim]))
            preservation_surface = "\n".join([title, body, conclusion, *preserved_verbatim])
            missing_locked_values = [str(item.get("value") or "") for item in locked_facts if str(item.get("value") or "") not in preservation_surface]
            if missing_locked_values:
                raise ConflictError("Page Writer changed or omitted a locked fact value")
            if not title or len(title) > 160 or len(body) > 5000:
                raise ConflictError("Page Writer output exceeds the content-plan bounds")
            written.append({
                **draft,
                "title": title,
                "central_claim": str(output.get("centralClaim") or (paragraphs[0] if paragraphs else title))[:500],
                "core_point": str(output.get("centralClaim") or (paragraphs[0] if paragraphs else title))[:500],
                "body": body,
                "conclusion": conclusion,
                "verbatim_text": preserved_verbatim,
                "fact_ids": list(dict.fromkeys(output_fact_ids)),
                "visual_suggestion": str(output.get("visualNotes") or draft.get("visual_suggestion") or "")[:1000],
                "page_writer_run_id": run["agent_run_id"],
                "page_writer_output_artifact_id": run["output_artifact_ids"][0],
            })
        return written

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
        options = dict(session.get("options") or {})
        page_drafts, page_count_reason = self._apply_page_count_policy(page_drafts, dict(options.get("page_count") or {"mode": "auto"}))
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
            cleaned.append({
                "page_draft_id": f"draft_{index + 1:03d}",
                "order_index": index,
                "title": title,
                "body": body,
                "central_claim": str(item.get("central_claim") or item.get("core_point") or "")[:500],
                "conclusion": str(item.get("conclusion") or "")[:500],
                "fact_ids": list(dict.fromkeys(str(value) for value in item.get("fact_ids") or [])),
                "verbatim_text": list(dict.fromkeys(str(value) for value in item.get("verbatim_text") or [] if str(value))),
                "visual_suggestion": str(item.get("visual_suggestion") or "")[:1000],
                "page_type": str(item.get("page_type") or ("cover" if index == 0 else "content")),
                "source_hashes": list(source_hashes),
            })
        if not cleaned:
            raise ValueError("At least one page draft is required")
        source_artifacts = [document["artifact_id"] for document_id in session["source_document_ids"] if (document := self.store.get_document(project_id, document_id))]
        facts = self.store.list_facts(project_id)
        fact_context = self._fact_context_rows(facts)
        locked_fact_context = self._fact_context_rows([item for item in facts if item.get("locked")])
        fact_conflicts = self.store.list_fact_conflicts(project_id)
        selection = self.store.get_session_design_selection(project_id, session_id)
        if selection:
            selected_style, selected_template = self._selection_packs(owner_id, selection)
            planning_design_snapshot = design_snapshot(selected_style, selected_template)
        else:
            planning_design_snapshot = design_snapshot(None, None)
        workflow_mode = session["workflow_mode"]
        high_fidelity = workflow_mode == WorkflowMode.PPTX_IMPROVE.value and options.get("improvement_mode") == "high_fidelity"
        inferred_language = options.get("language") or self._infer_language(cleaned)
        audience = options.get("audience") or "待确认受众"
        purpose = options.get("purpose") or "待确认演示目的"
        outline_parent_run_id: str | None = None
        outline_input_artifact_ids: list[str] = []
        source_summaries: list[dict[str, Any]] = []
        reviewed_facts: dict[str, Any] = {}
        import_run: dict[str, Any] | None = None
        if workflow_mode == WorkflowMode.PAGE_ENTRY.value:
            self._record_not_required_agent_run(project_id, role="source_analyst", session_id=session_id, reason="page_entry content is supplied directly by the user")
            self._record_not_required_agent_run(project_id, role="fact_reviewer", session_id=session_id, reason="page_entry has no extracted source facts to review")
        elif workflow_mode == WorkflowMode.PPTX_IMPROVE.value:
            document_id = session["source_document_ids"][0]
            import_manifest = self.store.get_pptx_import_manifest(project_id, document_id) or {}
            import_run = self._record_stage_agent_run(
                owner_id,
                project_id,
                role="import_analyst",
                session_id=session_id,
                input_artifact_ids=source_artifacts,
                summary={
                    "page_drafts": cleaned,
                    "import_manifest": import_manifest,
                    "improvement_mode": options.get("improvement_mode"),
                    "editable_boundary": "native_partial",
                },
            )
            imported_output = self._agent_output(project_id, import_run)
            source_summaries = [imported_output]
            outline_input_artifact_ids = list(import_run["output_artifact_ids"])
            imported_drafts = imported_output.get("pageDrafts")
            if isinstance(imported_drafts, list) and imported_drafts:
                mapped_imports: list[dict[str, Any]] = []
                for index, item in enumerate(imported_drafts[:len(cleaned)]):
                    if not isinstance(item, dict):
                        continue
                    fallback = cleaned[index]
                    mapped_imports.append({**fallback, **item, "title": str(item.get("title") or fallback["title"])[:160], "body": str(item.get("body") if item.get("body") is not None else fallback["body"])[:5000], "source_hashes": fallback["source_hashes"]})
                if mapped_imports:
                    cleaned = mapped_imports
            self.store.audit(
                owner_id,
                "agent.output.applied",
                project_id=project_id,
                entity_type="agent_context",
                entity_id=import_run["agent_run_id"],
                detail={
                    "agent_run_id": import_run["agent_run_id"],
                    "output_artifact_ids": list(import_run.get("output_artifact_ids") or []),
                    "next_stage": "fact_reviewer" if facts and not high_fidelity else "outline_planner",
                    "fields": ["summary", "pageDrafts", "importedObjects", "editableBoundary"],
                },
            )
            self._record_not_required_agent_run(project_id, role="source_analyst", session_id=session_id, reason="pptx_improve uses Import Analyst for the registered PPTX source")
            if high_fidelity:
                self._record_not_required_agent_run(project_id, role="fact_reviewer", session_id=session_id, reason="high_fidelity reconstruction preserves imported content without fact rewriting")
                self._record_not_required_agent_run(project_id, role="outline_planner", session_id=session_id, reason="high_fidelity reconstruction preserves imported page order and narrative")
            elif facts:
                fact_run = self._record_stage_agent_run(
                    owner_id,
                    project_id,
                    role="fact_reviewer",
                    session_id=session_id,
                    parent_run_id=import_run["agent_run_id"],
                    input_artifact_ids=list(import_run["output_artifact_ids"]),
                    summary={
                        "source_summaries": source_summaries,
                        "candidate_facts": fact_context,
                        "locked_facts": locked_fact_context,
                        "fact_conflicts": fact_conflicts,
                    },
                )
                reviewed_facts = self._agent_output(project_id, fact_run)
                outline_parent_run_id = fact_run["agent_run_id"]
                self.store.audit(
                    owner_id,
                    "agent.output.applied",
                    project_id=project_id,
                    entity_type="agent_context",
                    entity_id=fact_run["agent_run_id"],
                    detail={
                        "agent_run_id": fact_run["agent_run_id"],
                        "output_artifact_ids": list(fact_run.get("output_artifact_ids") or []),
                        "next_stage": "outline_planner",
                        "fields": ["retainedFacts", "pendingFacts", "conflicts", "recommendations"],
                    },
                )
            else:
                self._record_not_required_agent_run(project_id, role="fact_reviewer", session_id=session_id, reason="the imported PPTX contains no extracted facts or conflicts")
                outline_parent_run_id = import_run["agent_run_id"]
        else:
            source_run = self._source_analysis_run(owner_id, project_id, session, source_artifacts, facts)
            source_summaries = [self._agent_output(project_id, source_run)]
            outline_input_artifact_ids = list(source_run["output_artifact_ids"])
            fact_run = self._record_stage_agent_run(
                owner_id,
                project_id,
                role="fact_reviewer",
                session_id=session_id,
                parent_run_id=source_run["agent_run_id"],
                input_artifact_ids=list(source_run["output_artifact_ids"]),
                summary={
                    "source_summaries": source_summaries,
                    "candidate_facts": fact_context,
                    "locked_facts": locked_fact_context,
                    "fact_conflicts": fact_conflicts,
                },
            )
            reviewed_facts = self._agent_output(project_id, fact_run)
            outline_parent_run_id = fact_run["agent_run_id"]
            self.store.audit(
                owner_id,
                "agent.output.applied",
                project_id=project_id,
                entity_type="agent_context",
                entity_id=fact_run["agent_run_id"],
                detail={
                    "agent_run_id": source_run["agent_run_id"],
                    "output_artifact_ids": list(source_run.get("output_artifact_ids") or []),
                    "next_stage": "fact_reviewer",
                    "fields": ["source_summaries", "coverage_hashes", "untrusted_source_instructions"],
                },
            )
            self.store.audit(
                owner_id,
                "agent.output.applied",
                project_id=project_id,
                entity_type="agent_context",
                entity_id=fact_run["agent_run_id"],
                detail={
                    "agent_run_id": fact_run["agent_run_id"],
                    "output_artifact_ids": list(fact_run.get("output_artifact_ids") or []),
                    "next_stage": "outline_planner",
                    "fields": ["retainedFacts", "pendingFacts", "conflicts", "recommendations"],
                },
            )
        outline_run: dict[str, Any] | None = None
        if high_fidelity:
            outline_output = {"storyline": [item["title"] for item in cleaned], "pageDrafts": cleaned}
        else:
            outline_run = self._record_stage_agent_run(
                owner_id,
                project_id,
                role="outline_planner",
                session_id=session_id,
                parent_run_id=outline_parent_run_id,
                input_artifact_ids=outline_input_artifact_ids,
                summary={
                    "source_summaries": source_summaries,
                    "reviewed_facts": reviewed_facts,
                    "locked_facts": locked_fact_context,
                    "fact_conflicts": fact_conflicts,
                    "page_drafts": cleaned,
                    "design_snapshot": planning_design_snapshot,
                    "user_options": {
                        "page_count": dict(options.get("page_count") or {"mode": "auto"}),
                        "workflow_mode": workflow_mode,
                        "audience": audience,
                        "purpose": purpose,
                        "language": inferred_language,
                        "content_mode": options.get("content_mode", "strict_preserve"),
                        "user_instruction": options.get("user_instruction", ""),
                    },
                },
                design_selection_id=(selection or {}).get("design_selection_id"),
            )
            outline_output = self._agent_output(project_id, outline_run)
            proposed = outline_output.get("pageDrafts")
            if isinstance(proposed, list) and proposed:
                by_id = {item["page_draft_id"]: item for item in cleaned}
                mapped: list[dict[str, Any]] = []
                for index, item in enumerate(proposed):
                    if not isinstance(item, dict):
                        continue
                    fallback = by_id.get(str(item.get("page_draft_id") or ""), cleaned[min(index, len(cleaned) - 1)])
                    title = " ".join(str(item.get("title") or fallback["title"]).split())
                    body = str(item.get("body") if item.get("body") is not None else fallback["body"]).strip()
                    mapped.append({**fallback, **item, "title": title[:160], "body": body[:5000], "source_hashes": fallback["source_hashes"]})
                if mapped:
                    cleaned = mapped
        logic_artifact_ids: list[str] = []
        logic_summary: dict[str, Any] | None = None
        logic_run: dict[str, Any] | None = None
        if options.get("logic_diagnosis_enabled") and not high_fidelity:
            if not outline_run:
                raise ConflictError("Logic diagnosis requires an outline result")
            logic_run = self._record_stage_agent_run(owner_id, project_id, role="content_logic_reviewer", session_id=session_id, parent_run_id=outline_run["agent_run_id"], input_artifact_ids=list(outline_run["output_artifact_ids"]), summary={"page_drafts": cleaned, "audience": audience, "purpose": purpose})
            logic_output = self._agent_output(project_id, logic_run)
            logic_artifact_id = logic_run["output_artifact_ids"][0]
            logic_artifact_ids.append(logic_artifact_id)
            logic_summary = logic_output
            for draft in cleaned:
                draft["logic_analysis"] = logic_summary
        if high_fidelity:
            self._record_not_required_agent_run(project_id, role="page_writer", session_id=session_id, reason="high_fidelity reconstruction preserves imported slide text verbatim")
            for draft in cleaned:
                draft.update({
                    "central_claim": str(draft.get("central_claim") or draft.get("body") or draft["title"]).splitlines()[0][:500],
                    "core_point": str(draft.get("core_point") or draft.get("body") or draft["title"]).splitlines()[0][:500],
                    "fact_ids": self._draft_fact_ids(project_id, draft, facts),
                    "visual_suggestion": str(draft.get("visual_suggestion") or "Preserve the imported slide composition and object relationships."),
                    "page_writer_status": "not_required",
                    "import_analyst_run_id": import_run["agent_run_id"] if import_run else None,
                })
        else:
            writer_parent = logic_run["agent_run_id"] if logic_run else outline_run["agent_run_id"]
            cleaned = self._page_writer_plan_drafts(
                owner_id,
                project_id,
                session_id,
                cleaned,
                facts,
                writer_parent,
                str(options.get("content_mode") or "strict_preserve"),
                inferred_language,
                audience,
            )
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
            "estimatedUsage": {"imageUnits": 0, "amount": 0, "currency": "CNY", "billingMode": "disabled"},
            "pageDrafts": cleaned,
            "pageCount": {
                "mode": options.get("page_count", {}).get("mode", "auto"),
                "value": len(cleaned),
                "min": options.get("page_count", {}).get("min"),
                "max": options.get("page_count", {}).get("max"),
                "reason": page_count_reason,
            },
            "audience": audience,
            "purpose": purpose,
            "language": inferred_language,
            "storyline": list(outline_output.get("storyline") or [item["title"] for item in cleaned]),
            "visualDirection": dict(outline_output.get("visualDirection") or {}),
            "logicAnalysisArtifactIds": logic_artifact_ids,
            "logicDiagnosisSummary": logic_summary,
            "outputFormats": list(options.get("output_formats") or ["markdown"]),
            "designSelectionId": (selection or {}).get("design_selection_id"),
            "designSelectionDraft": {
                "design_selection_id": (selection or {}).get("design_selection_id"),
                "selection_source": planning_design_snapshot.get("selection_source", "none"),
                "style_pack_id": planning_design_snapshot.get("style_pack_id"),
                "style_version": planning_design_snapshot.get("style_version"),
                "style_content_hash": planning_design_snapshot.get("style_content_hash"),
                "template_pack_id": planning_design_snapshot.get("template_pack_id"),
                "template_version": planning_design_snapshot.get("template_version"),
                "template_content_hash": planning_design_snapshot.get("template_content_hash"),
            },
            "designSnapshot": None,
            "representativeDraftIds": [item["page_draft_id"] for item in cleaned[: min(2, len(cleaned))]],
            "contentMode": session.get("options", {}).get("content_mode", "strict_preserve"),
            "improvementMode": session.get("options", {}).get("improvement_mode", "redesign"),
            "representativePreflight": bool(session.get("options", {}).get("representative_preflight", False)),
            "generationStage": "awaiting_content_confirmation",
            "nextAction": "confirm_content",
            "consistencyStatus": "consistent",
        }
        plan["contentExportArtifactIds"], plan["contentExportQaArtifactIds"] = self._content_plan_exports(
            project_id,
            plan,
            list(options.get("output_formats") or ["markdown"]),
        )
        created = self.store.create_plan(project_id, session_id, plan, True, owner_id)
        if logic_run:
            self.store.create_logic_analysis(project_id, session_id, created["plan_id"], logic_run["agent_run_id"], logic_artifact_ids[0])
            self.store.audit(
                owner_id,
                "agent.output.applied",
                project_id=project_id,
                entity_type="agent_context",
                entity_id=created["plan_id"],
                detail={
                    "agent_run_id": logic_run["agent_run_id"],
                    "output_artifact_ids": list(logic_run.get("output_artifact_ids") or []),
                    "next_stage": "page_writer",
                    "fields": ["logicType", "logicEvidence", "pageRhythm", "densityLevel", "layoutCandidates"],
                },
            )
        if outline_run:
            self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="plan", entity_id=created["plan_id"], detail={"agent_run_id": outline_run["agent_run_id"], "fields": ["storyline", "pageDrafts", "pageCount", "visualDirection"]})
        for draft in cleaned:
            if draft.get("page_writer_run_id"):
                self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="plan_page_draft", entity_id=draft["page_draft_id"], detail={"agent_run_id": draft["page_writer_run_id"], "fields": ["title", "central_claim", "body", "fact_ids", "visual_suggestion"]})
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
        if plan["status"] in {"awaiting_design_confirmation", "generating_visuals", "awaiting_representative_confirmation", "awaiting_visual_confirmation", "reconstructing", "completed"}:
            return {"plan_id": plan_id, "status": plan["status"], "pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in existing], "next_action": plan["structured_plan"].get("nextAction")}
        if plan["status"] != "awaiting_content_confirmation":
            raise ConflictError("Content plan is not awaiting confirmation")
        structured = dict(plan["structured_plan"])
        session_id = str(plan.get("session_id") or "")
        selection = self.store.get_session_design_selection(project_id, session_id) if session_id else None
        style, template = self._selection_packs(owner_id, selection) if selection else (None, None)
        snapshot = design_snapshot(style, template)
        structured.pop("designSelectionDraft", None)
        structured.update({"designSelectionId": (selection or {}).get("design_selection_id"), "designSnapshot": snapshot})
        if selection and selection.get("status") == "draft":
            used = self.store.use_design_selection(project_id, selection["design_selection_id"], plan_id, snapshot)
            if not used:
                raise ConflictError("Design selection changed before content confirmation")
            self.store.audit(owner_id, "design_selection.used", project_id=project_id, entity_type="design_selection", entity_id=selection["design_selection_id"], detail={"plan_id": plan_id, "snapshot_hash": sha256_json(snapshot)})
        structured.update({"generationStage": "awaiting_design_confirmation", "nextAction": "confirm_design"})
        self.store.update_plan(project_id, plan_id, status="awaiting_design_confirmation", structured_plan=structured, confirmed=True)
        self.store.emit_event("design.plan.ready", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id})
        self.store.emit_event("confirmation.required", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id, "reasons": ["design_direction", "page_size", "font_policy"]})
        return {"plan_id": plan_id, "status": "awaiting_design_confirmation", "next_action": "confirm_design", "structured_plan": structured}

    def confirm_generation_design(self, owner_id: str, project_id: str, plan_id: str, values: dict[str, Any] | None = None) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] in {"generating_visuals", "awaiting_representative_confirmation", "awaiting_visual_confirmation"}:
            pages = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
            return {"plan_id": plan_id, "status": plan["status"], "pages": self._page_summaries(pages)}
        if plan["status"] != "awaiting_design_confirmation":
            raise ConflictError("Design plan is not awaiting confirmation")
        settings = dict(values or {})
        representative = settings.get("representative_preflight", plan["structured_plan"].get("representativePreflight", False))
        if not isinstance(representative, bool):
            raise ValueError("representative_preflight must be boolean")
        drafts = [dict(item) for item in plan["structured_plan"]["pageDrafts"]]
        snapshot = dict(plan["structured_plan"].get("designSnapshot") or design_snapshot(None, None))
        selection_id = plan["structured_plan"].get("designSelectionId")
        if selection_id:
            selection = self.store.get_design_selection(project_id, str(selection_id))
            style, template = self._selection_packs(owner_id, selection)
            current_snapshot = design_snapshot(style, template)
            if sha256_json(current_snapshot) != sha256_json(snapshot):
                raise ConflictError("The selected Design Pack changed before generation")
        drafts = [
            {**self._apply_design_snapshot(draft, snapshot), "design_selection_id": selection_id}
            for draft in drafts
        ]
        page_size = settings.get("page_size")
        if page_size is not None:
            if not isinstance(page_size, dict) or not all(isinstance(page_size.get(key), (int, float)) and page_size[key] > 0 for key in ("width", "height")) or page_size.get("unit") not in {"inch", "cm", "emu"}:
                raise ValueError("page_size must contain positive width, height, and unit")
            for draft in drafts:
                draft.update({"page_width": page_size["width"], "page_height": page_size["height"], "page_unit": page_size["unit"]})
        font_policy = settings.get("font_policy")
        if font_policy is not None:
            if not isinstance(font_policy, dict) or not str(font_policy.get("zh_family", "")).strip() or not str(font_policy.get("latin_family", "")).strip():
                raise ValueError("font_policy requires zh_family and latin_family")
            for draft in drafts:
                draft.update({"zh_font": font_policy["zh_family"], "latin_font": font_policy["latin_family"], "font_fallbacks": list(font_policy.get("fallback_families") or [])})
        selected_ids = set(plan["structured_plan"].get("representativeDraftIds") or []) if representative else {item["page_draft_id"] for item in drafts}
        selected = [item for item in drafts if item["page_draft_id"] in selected_ids]
        if not self.settings.test_fixtures_enabled and not self.settings.image.api_key:
            raise ConflictError("No image provider is configured")
        structured = dict(plan["structured_plan"])
        structured.update({"pageDrafts": drafts, "representativePreflight": representative, "generationStage": "generating_visuals", "nextAction": "wait_for_visuals"})
        self.store.update_plan(project_id, plan_id, status="generating_visuals", structured_plan=structured, confirmed=True)
        pages = self.materialize_pages(owner_id, project_id, selected, operation_id=plan_id, preview_only=True, create_visual_reference=self.settings.test_fixtures_enabled)
        self._queue_visual_runs(owner_id, project_id, pages)
        status = "awaiting_representative_confirmation" if representative else "awaiting_visual_confirmation"
        if not self.settings.test_fixtures_enabled:
            status = "generating_visuals"
        structured.update({"generationStage": status, "nextAction": "confirm_representatives" if representative else "confirm_visuals", "generatedPageIds": [item["page_id"] for item in pages], "generatedDraftIds": sorted(selected_ids), "consistencyStatus": structured.get("consistencyStatus") or "consistent"})
        self.store.update_plan(project_id, plan_id, status=status, structured_plan=structured, confirmed=True)
        self.store.emit_event("confirmation.required" if status != "generating_visuals" else "image.submitted", project_id=project_id, session_id=plan.get("session_id"), payload={"plan_id": plan_id, "page_ids": structured["generatedPageIds"], "reasons": ["representative_visuals" if representative else "visuals"]})
        return {"plan_id": plan_id, "status": status, "pages": self._page_summaries(pages), "next_action": structured["nextAction"]}

    def confirm_generation_samples(self, owner_id: str, project_id: str, plan_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if plan["status"] == "awaiting_visual_confirmation":
            existing = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
            return {"plan_id": plan_id, "status": plan["status"], "pages": self._page_summaries(existing)}
        if plan["status"] != "awaiting_representative_confirmation":
            raise ConflictError("Representative pages are not awaiting confirmation")
        existing = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
        for page in existing:
            state = self.store.get_page_production_state(project_id, page["page_id"])
            if not state or not state.get("visual_approval_id"):
                raise ConflictError("Approve every representative visual before continuing")
            approvals = self.store.list_visual_approvals(project_id, page["page_id"])
            if not any(item["visual_approval_id"] == state["visual_approval_id"] and item["decision"] == "approved" for item in approvals):
                raise ConflictError("A representative visual was not approved")
        self.store.update_plan(project_id, plan_id, status="generating_visuals", confirmed=True)
        drafts = plan["structured_plan"]["pageDrafts"]
        representative_ids = set(plan["structured_plan"].get("representativeDraftIds") or [])
        remaining = [draft for draft in drafts if draft["page_draft_id"] not in representative_ids]
        created = self.materialize_pages(owner_id, project_id, remaining, operation_id=plan_id, preview_only=True, create_visual_reference=self.settings.test_fixtures_enabled)
        self._queue_visual_runs(owner_id, project_id, created)
        pages = [page for page in self.store.list_pages(project_id) if page.get("operation_id") == plan_id]
        if len(pages) != len(drafts):
            raise ConflictError("Plan did not materialize every page")
        structured = dict(plan["structured_plan"])
        status = "awaiting_visual_confirmation" if self.settings.test_fixtures_enabled else "generating_visuals"
        structured.update({"generationStage": status, "nextAction": "confirm_visuals" if status == "awaiting_visual_confirmation" else "wait_for_visuals", "generatedPageIds": [item["page_id"] for item in pages], "generatedDraftIds": [item["page_draft_id"] for item in drafts]})
        self.store.update_plan(project_id, plan_id, status=status, structured_plan=structured, confirmed=True)
        return {"plan_id": plan_id, "status": status, "pages": self._page_summaries(pages), "next_action": structured["nextAction"]}

    def _page_summaries(self, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for item in pages:
            page = self.store.get_page(str(item.get("project_id") or ""), item["page_id"]) if item.get("project_id") else None
            current = page or item
            summaries.append({
                "page_id": current["page_id"],
                "version_id": current.get("current_version_id") or current.get("version_id"),
                "order_index": current["order_index"],
                "page_type": current["page_type"],
                "visual_artifact_id": current.get("visual_preview_artifact_id"),
            })
        return summaries

    def _queue_visual_runs(self, owner_id: str, project_id: str, pages: list[dict[str, Any]]) -> None:
        if not self.settings.test_fixtures_enabled and not self.settings.image.api_key:
            raise ConflictError("No image provider is configured")
        for page in pages:
            current = self.store.get_page(project_id, page["page_id"]) or page
            contract = self._page_contract(project_id, current)
            if current.get("visual_preview_artifact_id"):
                self.store.upsert_page_production_state(project_id, page["page_id"], {
                    "contract_revision": contract.contract_revision,
                    "selected_visual_artifact_id": current["visual_preview_artifact_id"],
                    "reconstruction_status": "pending",
                })
                continue
            parent_run_id = str((current.get("qa") or {}).get("visual_director_run_id") or "") or None
            self._create_visual_image_run(owner_id, project_id, current, contract, parent_run_id=parent_run_id)

    def _create_visual_image_run(
        self,
        owner_id: str,
        project_id: str,
        page: dict[str, Any],
        contract: PageContract,
        *,
        parent_run_id: str | None = None,
    ) -> dict[str, Any]:
        prompt = (
            "Generate exactly one complete presentation slide reference image from the supplied PageContract. "
            "Preserve every Chinese character, number, proper name, label, locked fact, and verbatim string. "
            "Do not create a multi-slide collage and do not introduce facts."
        )
        input_ids = list(dict.fromkeys((*contract.template_artifact_ids, *contract.image_artifact_ids)))
        input_hashes: list[str] = []
        for artifact_id in input_ids:
            artifact = self.store.get_artifact(project_id, artifact_id)
            if not artifact or not str(artifact.get("media_type") or "").startswith("image/"):
                raise ConflictError("Image Prompt references an unavailable project image Artifact")
            input_hashes.append(artifact["sha256"])
        image_run_id = new_id("image_run")
        page_plan = self.store.get_plan(project_id, str(page.get("operation_id") or "")) if page.get("operation_id") else None
        page_operation = self.store.get_operation(project_id, str(page.get("operation_id") or "")) if page.get("operation_id") else None
        source_session_id = (page_plan or {}).get("session_id") or (page_operation or {}).get("session_id") or (page_operation or {}).get("structured_plan", {}).get("_sessionId")
        resolved = self.context_resolver.resolve(
            project_id=project_id,
            role="image_prompt",
            task_id=image_run_id,
            session_id=source_session_id,
            parent_run_id=parent_run_id,
            input_artifact_ids=[page["page_contract_artifact_id"], *input_ids],
            user_prompt=prompt,
            output_schema={"type": "image", "allowed_media_types": ["image/png", "image/jpeg", "image/webp"]},
            provider_snapshot=self._image_settings_for(project_id, "full_slide_reference")[2],
            explicit_context={"design_snapshot": contract.design_snapshot},
        )
        _envelope_payload, prompt_artifacts = self._persist_resolved_prompt(project_id, image_run_id, resolved)
        prompt_artifact = prompt_artifacts["prompt"]
        run = self.create_image_run(owner_id, project_id, {
            "image_run_id": image_run_id,
            "page_id": page["page_id"],
            "purpose": "full_slide_reference",
            "prompt_artifact_id": prompt_artifact["artifact_id"],
            "input_artifact_ids": input_ids,
            "input_hashes": input_hashes,
        })
        self.store.upsert_page_production_state(project_id, page["page_id"], {
            "contract_revision": contract.contract_revision,
            "current_image_run_id": run["image_run_id"],
            "visual_approval_id": None,
            "reconstruction_manifest_id": None,
            "reconstruction_status": "pending",
        })
        return run

    def reconstruction_preflight(self, owner_id: str, project_id: str, page_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        page = self.store.get_page(project_id, page_id)
        if not page:
            raise NotFoundError("Page not found")
        contract = self._page_contract(project_id, page)
        visual_artifact = self.store.get_artifact(project_id, str(page.get("visual_preview_artifact_id") or ""))
        if not visual_artifact:
            raise ConflictError("Generate a visual reference before reconstruction preflight")
        state = self.store.get_page_production_state(project_id, page_id)
        approvals = self.store.list_visual_approvals(project_id, page_id)
        approved = next((item for item in approvals if state and item["visual_approval_id"] == state.get("visual_approval_id") and item["decision"] == "approved" and item["visual_sha256"] == visual_artifact["sha256"]), None)
        if not approved:
            raise ConflictError("Approve the current visual reference before reconstruction preflight")
        categories = {"text": 0, "shape": 0, "svg_icon": 0, "image": 0, "table": 0, "chart": 0, "smartart": 0, "ole": 0, "video": 0, "animation": 0, "unknown": 0}
        unsupported: list[dict[str, Any]] = []
        source_manifest_id = None
        if page.get("operation_id"):
            plan = self.store.get_plan(project_id, page["operation_id"])
            session = self.store.get_work_session(project_id, plan["session_id"]) if plan and plan.get("session_id") else None
            for document_id in session.get("source_document_ids", []) if session else []:
                manifest = self.store.get_pptx_import_manifest(project_id, document_id)
                if not manifest:
                    continue
                source_manifest_id = manifest["manifest_id"]
                source_page = next((item for item in manifest["pages"] if item.get("order_index") == page.get("order_index")), None)
                for item in source_page.get("objects", []) if source_page else []:
                    kind = str(item.get("type") or "unknown")
                    categories[kind if kind in categories else "unknown"] += 1
                    if item.get("support_level") == "unsupported":
                        unsupported.append({"object_id": item.get("object_id"), "type": kind, "reason": "unsupported_import_object"})
                break
        if not any(categories.values()):
            categories["text"] = max(1, len(contract.content_blocks) + 1)
            categories["shape"] = 1
            categories["image"] = len(contract.image_artifact_ids)
        object_count = sum(categories.values())
        disclosure = {
            "page_id": page_id,
            "contract_revision": contract.contract_revision,
            "visual_artifact_id": visual_artifact["artifact_id"],
            "visual_sha256": visual_artifact["sha256"],
            "estimated_wait_seconds": max(20, min(300, 15 + object_count * 3)),
            "estimated_agent_calls": 1,
            "estimated_image_calls": 0,
            "fastppt_billing_mode": "disabled",
            "supplier_fee_risk": True,
            "visual_difference_risk": "The editable result can differ from the approved raster reference.",
            "editable_boundary": "Text, basic shapes, and SVG icons remain editable; approved complex regions may remain registered local images.",
            "object_categories": categories,
            "unsupported_items": unsupported,
            "source_import_manifest_id": source_manifest_id,
        }
        disclosure_sha256 = hashlib.sha256(json.dumps(disclosure, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        return {**disclosure, "disclosure_sha256": disclosure_sha256, "requires_reconstruction_decision": bool(unsupported)}

    def request_reconstruction(self, owner_id: str, project_id: str, page_id: str, values: dict[str, Any]) -> dict[str, Any]:
        preflight = self.reconstruction_preflight(owner_id, project_id, page_id)
        if values.get("disclosure_sha256") != preflight["disclosure_sha256"]:
            raise ConflictError("Reconstruction disclosure changed; review the current preflight before continuing")
        required_acceptances = ("accept_wait_time", "accept_supplier_fee_risk", "accept_visual_difference", "accept_editable_boundary")
        if any(values.get(key) is not True for key in required_acceptances):
            raise ConflictError("Reconstruction requires acceptance of time, supplier fee, visual difference, and editable-boundary disclosures")
        unsupported_ids = {str(item.get("object_id")) for item in preflight["unsupported_items"]}
        accepted_ids = {str(item) for item in values.get("accepted_unsupported_object_ids", [])}
        if unsupported_ids.difference(accepted_ids):
            raise ConflictError("Every unsupported imported object requires an explicit reconstruction decision")
        page = self.store.get_page(project_id, page_id)
        if not page:
            raise NotFoundError("Page not found")
        production_state = self.store.get_page_production_state(project_id, page_id)
        reconstruction_ready = bool(
            production_state
            and production_state.get("reconstruction_status") == "ready"
            and production_state.get("reconstruction_manifest_id")
        )
        plan_id = page.get("operation_id")
        if plan_id:
            plan = self.store.get_plan(project_id, plan_id)
            active_statuses = {"awaiting_visual_confirmation", "reconstructing", "partial", "failed"}
            if plan and plan["status"] not in active_statuses and not (plan["status"] == "completed" and reconstruction_ready):
                raise ConflictError("The generation plan is not ready for reconstruction")
            if plan and not (plan["status"] == "completed" and reconstruction_ready):
                structured = dict(plan["structured_plan"])
                structured.update({"generationStage": "reconstructing", "nextAction": "wait_for_reconstruction"})
                self.store.update_plan(project_id, plan_id, status="reconstructing", structured_plan=structured, confirmed=True)
        idempotency_key = str(values.get("idempotency_key") or f"reconstruct:{page_id}:{preflight['disclosure_sha256']}")
        job = self.store.enqueue_job(project_id, "reconstruct_page", {"owner_id": owner_id, "page_id": page_id, "disclosure_sha256": preflight["disclosure_sha256"]}, idempotency_key)
        self.store.audit(owner_id, "reconstruction.disclosure.accepted", project_id=project_id, entity_type="page", entity_id=page_id, detail={"disclosure_sha256": preflight["disclosure_sha256"], "unsupported_object_ids": sorted(unsupported_ids)})
        self.store.emit_event("reconstruction.started", project_id=project_id, page_id=page_id, payload={"job_id": job["job_id"], "disclosure_sha256": preflight["disclosure_sha256"]})
        return {"job_id": job["job_id"], "page_id": page_id, "status": job["status"], "disclosure_sha256": preflight["disclosure_sha256"]}

    def execute_reconstruction(self, owner_id: str, project_id: str, page_id: str, disclosure_sha256: str) -> dict[str, Any]:
        current = self.reconstruction_preflight(owner_id, project_id, page_id)
        if current["disclosure_sha256"] != disclosure_sha256:
            raise ConflictError("Reconstruction preflight changed after consent")
        manifest_artifact_id = self._ensure_page_reconstruction(owner_id, project_id, {"page_id": page_id})
        revision = self._finalize_plan_if_ready(owner_id, project_id, page_id)
        production_state = self.store.get_page_production_state(project_id, page_id) or {}
        return {"page_id": page_id, "status": production_state.get("reconstruction_status", "partial"), "reconstruction_manifest_artifact_id": manifest_artifact_id, "deck_revision_id": revision.get("deck_revision_id") if revision else None}

    def _finalize_plan_if_ready(self, owner_id: str, project_id: str, page_id: str) -> dict[str, Any] | None:
        page = self.store.get_page(project_id, page_id)
        plan_id = page.get("operation_id") if page else None
        if not plan_id:
            return None
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            return None
        pages = [item for item in self.store.list_pages(project_id) if item.get("operation_id") == plan_id]
        if len(pages) != len(plan["structured_plan"].get("pageDrafts") or []):
            return None
        ordered_pages: list[dict[str, Any]] = []
        for item in pages:
            state = self.store.get_page_production_state(project_id, item["page_id"])
            if not state or state.get("reconstruction_status") != "ready" or not state.get("reconstruction_manifest_id"):
                return None
            manifest = self.store.get_reconstruction_manifest(project_id, state["reconstruction_manifest_id"])
            current = self.store.get_page(project_id, item["page_id"])
            if not manifest or not manifest.get("artifact_id") or not current:
                return None
            ordered_pages.append({"order_index": current["order_index"], "page_id": current["page_id"], "version_id": current["current_version_id"], "page_contract_artifact_id": current["page_contract_artifact_id"], "reconstruction_manifest_artifact_id": manifest["artifact_id"]})
        existing = next(
            (
                item
                for item in self.store.list_deck_revisions(project_id)
                if item.get("source_session_id") == plan.get("session_id")
                and item.get("status") == "ready"
                and item.get("ordered_pages") == ordered_pages
            ),
            None,
        )
        revision = existing or self.create_deck_revision(owner_id, project_id, {"source_session_id": plan.get("session_id") or "", "source_mode": plan["structured_plan"].get("workflowMode", "page_entry"), "ordered_pages": ordered_pages, "status": "ready"})
        structured = dict(plan["structured_plan"])
        structured.update({"generationStage": "completed", "nextAction": "edit_or_export", "deckRevisionId": revision["deck_revision_id"]})
        self.store.update_plan(project_id, plan_id, status="completed", structured_plan=structured, confirmed=True)
        return revision

    def _ensure_page_reconstruction(self, owner_id: str, project_id: str, page: dict[str, Any]) -> str:
        """Build an editable page only from an explicitly approved visual."""
        page = {**(self.store.get_page(project_id, page["page_id"]) or {}), **page}
        visual_artifact_id = page.get("visual_preview_artifact_id")
        visual_artifact = self.store.get_artifact(project_id, str(visual_artifact_id or ""))
        if not visual_artifact or not str(visual_artifact.get("media_type", "")).startswith("image/"):
            raise ConflictError("Page has no visual reference Artifact")
        contract = self._page_contract(project_id, page)
        state = self.store.get_page_production_state(project_id, page["page_id"])
        approval = next(
            (
                item
                for item in self.store.list_visual_approvals(project_id, page["page_id"])
                if item.get("decision") == "approved"
                and (not state or item.get("visual_approval_id") == state.get("visual_approval_id"))
                and item.get("visual_artifact_id") == visual_artifact_id
                and item.get("visual_sha256") == visual_artifact.get("sha256")
                and int(item.get("contract_revision", 0)) == contract.contract_revision
            ),
            None,
        )
        if not approval:
            raise ConflictError("Approve the current visual reference before reconstruction")

        # Reconstruction jobs are leased and may be delivered more than once.
        # Reuse the ready manifest instead of appending another page version.
        if state and state.get("reconstruction_status") in {"ready", "partial"} and state.get("reconstruction_manifest_id"):
            existing_manifest = self.store.get_reconstruction_manifest(project_id, str(state["reconstruction_manifest_id"]))
            if existing_manifest and existing_manifest.get("artifact_id"):
                return str(existing_manifest["artifact_id"])

        source_manifest_id = None
        source_import_manifest: dict[str, Any] = {}
        session_id = None
        design_selection_id = None
        if page.get("operation_id"):
            plan = self.store.get_plan(project_id, page["operation_id"])
            operation = self.store.get_operation(project_id, page["operation_id"]) if not plan else None
            session_id = plan.get("session_id") if plan else None
            if not session_id and operation:
                session_id = operation.get("session_id") or operation.get("structured_plan", {}).get("_sessionId")
            design_selection_id = (plan or {}).get("structured_plan", {}).get("designSelectionId") or (operation or {}).get("structured_plan", {}).get("_designSelectionId")
            session = self.store.get_work_session(project_id, session_id) if session_id else None
            for document_id in session.get("source_document_ids", []) if session else []:
                import_manifest = self.store.get_pptx_import_manifest(project_id, document_id)
                if import_manifest:
                    source_manifest_id = import_manifest["manifest_id"]
                    source_import_manifest = import_manifest
                    break

        svg = self._render_contract_svg(project_id, contract, self._contract_body(contract), int(page["order_index"]) + 1)
        svg_artifact = self._record_artifact(project_id, "svg", svg, "image/svg+xml")
        with tempfile.TemporaryDirectory(prefix="fastppt-reconstruction-") as temp_name:
            svg_path = Path(temp_name) / "page.svg"
            pptx_path = Path(temp_name) / "page.pptx"
            svg_path.write_bytes(svg)
            conversion = self.adapter.convert(ConversionRequest((svg_path,), pptx_path, f"reconstruct-{page['page_id']}"))
            pptx_artifact = self._record_artifact(project_id, "reconstruction_pptx", pptx_path.read_bytes(), "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        page_width = float(contract.page_size.get("width", 13.333))
        page_height = float(contract.page_size.get("height", 7.5))
        page_unit = str(contract.page_size.get("unit", "inch"))
        fallback_objects = [
            {
                "object_id": f"object_{page['page_id']}_title",
                "source_object_id": None,
                "type": "text",
                "bounds": {"x": 0, "y": 0, "width": page_width, "height": min(page_height, page_height * 0.18), "unit": page_unit},
                "z_index": 1,
                "artifact_id": None,
                "editable_level": "text_native",
                "recognition_confidence": 1.0,
                "requires_user_confirmation": False,
            },
            {
                "object_id": f"object_{page['page_id']}_body",
                "source_object_id": None,
                "type": "shape",
                "bounds": {"x": 0, "y": page_height * 0.18, "width": page_width, "height": page_height * 0.82, "unit": page_unit},
                "z_index": 2,
                "artifact_id": None,
                "editable_level": "native_structure",
                "recognition_confidence": 1.0,
                "requires_user_confirmation": False,
            },
        ]
        planner = self._record_stage_agent_run(
            owner_id,
            project_id,
            role="reconstruction_planner",
            session_id=session_id,
            input_artifact_ids=[page["page_contract_artifact_id"], str(visual_artifact_id)],
            summary={"page_id": page["page_id"], "objects": fallback_objects, "import_manifest": source_import_manifest},
            design_selection_id=design_selection_id,
        )
        planner_output = self._agent_output(project_id, planner)
        planner_objects = planner_output.get("objects")
        planner_unresolved = planner_output.get("unresolvedItems")
        editable_boundary = str(planner_output.get("editableBoundary") or "")
        planner_adopted = (
            isinstance(planner_objects, list)
            and bool(planner_objects)
            and all(isinstance(item, dict) for item in planner_objects)
            and isinstance(planner_unresolved, list)
            and all(isinstance(item, dict) for item in planner_unresolved)
            and editable_boundary in {"text_native", "native_structure", "native_partial"}
        )
        objects = list(planner_objects) if planner_adopted else fallback_objects
        unresolved_items = [dict(item) | {"source": "reconstruction_planner"} for item in planner_unresolved] if planner_adopted else []
        editable_level = editable_boundary if planner_adopted else "native_structure"

        provisional = {
            "page_id": page["page_id"],
            "version_id": "version_validation",
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "visual_approval_id": approval["visual_approval_id"],
            "source_import_manifest_id": source_manifest_id,
            "objects": objects,
            "unresolved_items": unresolved_items,
            "qa_report_id": "qa_pending",
            "schema_version": SCHEMA_VERSION,
        }
        provisional_canonical = {key: provisional.get(key) for key in ("page_id", "version_id", "page_contract_artifact_id", "visual_approval_id", "source_import_manifest_id", "objects", "unresolved_items", "qa_report_id", "schema_version")}
        provisional["aggregate_sha256"] = hashlib.sha256(json.dumps(provisional_canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        validation_error: ContractValidationError | None = None
        if planner_adopted:
            try:
                validate_reconstruction_manifest(provisional)
            except ContractValidationError as exc:
                validation_error = exc
        if not planner_adopted or validation_error is not None:
            planner_adopted = False
            objects = fallback_objects
            unresolved_items = []
            editable_level = "native_structure"
            self.store.audit(owner_id, "agent.output.not_adopted", project_id=project_id, entity_type="reconstruction_manifest", entity_id=page["page_id"], detail={"agent_run_id": planner["agent_run_id"], "reason": "invalid_reconstruction_objects", "errors": list(validation_error.errors) if validation_error else ["planner output shape or editable boundary is invalid"]})
        else:
            self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="reconstruction_manifest", entity_id=page["page_id"], detail={"agent_run_id": planner["agent_run_id"], "fields": ["objects", "unresolved_items", "editable_boundary"]})

        created_version = self.store.create_page_version(project_id, page["page_id"], {
            "operation_id": page.get("operation_id"),
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "quick_preview_artifact_id": page.get("quick_preview_artifact_id"),
            "visual_preview_artifact_id": visual_artifact_id,
            "svg_artifact_id": svg_artifact["artifact_id"],
            "editable_level": editable_level,
            "status": "ready",
            "qa": {"status": "pending_agent_review", "svg_qa_status": conversion.svg_qa_status, "pptx_qa_status": conversion.pptx_qa_status},
        })
        if not created_version:
            raise ConflictError("Reconstruction could not create an editable page version")
        version_id = created_version["version_id"]

        manifest_candidate = {
            "schema_version": SCHEMA_VERSION,
            "page_id": page["page_id"],
            "version_id": version_id,
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "visual_approval_id": approval["visual_approval_id"],
            "source_import_manifest_id": source_manifest_id,
            "objects": objects,
            "unresolved_items": unresolved_items,
            "editable_boundary": editable_level,
        }
        manifest_candidate_artifact = self._record_artifact(project_id, "reconstruction_manifest", json.dumps(manifest_candidate, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        qa_candidate = {
            "schema_version": SCHEMA_VERSION,
            "page_id": page["page_id"],
            "visual_approval_id": approval["visual_approval_id"],
            "svg_artifact_id": svg_artifact["artifact_id"],
            "svg_sha256": svg_artifact["sha256"],
            "svg_qa_status": conversion.svg_qa_status,
            "svg_qa_sha256": conversion.svg_qa_sha256,
            "pptx_artifact_id": pptx_artifact["artifact_id"],
            "pptx_sha256": pptx_artifact["sha256"],
            "pptx_qa_status": conversion.pptx_qa_status,
            "pptx_advisories": list(conversion.advisories),
            "full_slide_raster": False,
            "unconfirmed_text": any(bool(item.get("requires_user_confirmation")) and not item.get("confirmed_at") for item in objects),
        }
        qa_candidate_artifact = self._record_artifact(project_id, "reconstruction_qa_candidate", json.dumps(qa_candidate, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        qa_run = self._record_stage_agent_run(
            owner_id,
            project_id,
            role="qa_reviewer",
            session_id=session_id,
            parent_run_id=planner["agent_run_id"],
            input_artifact_ids=[page["page_contract_artifact_id"], manifest_candidate_artifact["artifact_id"], qa_candidate_artifact["artifact_id"], svg_artifact["artifact_id"], pptx_artifact["artifact_id"]],
            summary=qa_candidate,
            design_selection_id=design_selection_id,
        )
        qa_output = self._agent_output(project_id, qa_run)
        qa_issues = [dict(item) | {"source": "qa_reviewer"} for item in qa_output.get("issues", [])]
        if not qa_output.get("passed") and not qa_issues:
            qa_issues.append({"code": "qa_reviewer_failed", "message": "QA Reviewer did not pass the reconstruction", "source": "qa_reviewer"})
        if conversion.svg_qa_status != "passed":
            qa_issues.append({"code": "svg_qa_failed", "status": conversion.svg_qa_status, "source": "svg_qa"})
        if conversion.pptx_qa_status not in {"passed", "passed-with-advisories"}:
            qa_issues.append({"code": "pptx_qa_failed", "status": conversion.pptx_qa_status, "source": "pptx_qa"})
        for item in objects:
            if item.get("requires_user_confirmation") and not item.get("confirmed_at"):
                qa_issues.append({"code": "object_confirmation_required", "object_id": item.get("object_id"), "source": "reconstruction_planner"})
        unresolved_items.extend(qa_issues)
        qa_report = qa_candidate | {
            "qa_reviewer_run_id": qa_run["agent_run_id"],
            "qa_reviewer_passed": bool(qa_output.get("passed")),
            "issues": qa_issues,
            "recommendations": list(qa_output.get("recommendations") or []),
            "status": "passed" if not unresolved_items else "needs_review",
        }
        qa_artifact = self._record_artifact(project_id, "reconstruction_qa", json.dumps(qa_report, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="reconstruction_qa", entity_id=page["page_id"], detail={"agent_run_id": qa_run["agent_run_id"], "fields": ["passed", "issues", "recommendations"], "issue_count": len(qa_issues)})
        manifest_values: dict[str, Any] = {
            "page_id": page["page_id"],
            "version_id": version_id,
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "visual_approval_id": approval["visual_approval_id"],
            "source_import_manifest_id": source_manifest_id,
            "objects": objects,
            "unresolved_items": unresolved_items,
            "qa_report_id": qa_artifact["artifact_id"],
            "schema_version": SCHEMA_VERSION,
            "contract_revision": contract.contract_revision,
        }
        canonical = {key: manifest_values.get(key) for key in ("page_id", "version_id", "page_contract_artifact_id", "visual_approval_id", "source_import_manifest_id", "objects", "unresolved_items", "qa_report_id", "schema_version")}
        manifest_values["aggregate_sha256"] = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        manifest = self.create_reconstruction_manifest(owner_id, project_id, manifest_values)
        authority = self.store.create_render_authority_record(project_id, {
            "page_id": page["page_id"],
            "version_id": version_id,
            "pptx_artifact_id": pptx_artifact["artifact_id"],
            "pptx_sha256": pptx_artifact["sha256"],
            "render_worker": "pending" if self.settings.render_backend == "powerpoint" else "unavailable",
            "status": "degraded",
            "qa_report_id": qa_artifact["artifact_id"],
            "reason": "PowerPoint render is pending" if self.settings.render_backend == "powerpoint" else "PowerPoint render worker is unavailable",
        })
        self.store.upsert_page_production_state(project_id, page["page_id"], {"render_authority_record_id": authority["render_authority_record_id"]})
        return str(manifest["artifact_id"])

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

    def restart_generation_plan(self, owner_id: str, project_id: str, plan_id: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        structured = dict(plan["structured_plan"])
        replacement_id = structured.get("supersededByPlanId")
        if replacement_id:
            replacement = self.store.get_plan(project_id, str(replacement_id))
            if replacement:
                return replacement
        if plan["status"] == "cancelled":
            raise ConflictError("Cancelled plan cannot be restarted")
        if structured.get("consistencyStatus") not in {"mixed_content", "mixed_design"}:
            raise ConflictError("Restart from scratch is available only for a mixed content or design plan")
        session_id = str(plan.get("session_id") or "")
        session = self.store.get_work_session(project_id, session_id) if session_id else None
        if not session:
            raise ConflictError("Plan session is unavailable")

        replacement_session = self.create_session(
            owner_id,
            project_id,
            session["workflow_mode"],
            list(session.get("source_document_ids") or []),
            dict(session.get("options") or {}),
        )
        current_selection = self.store.get_session_design_selection(project_id, session_id)
        if current_selection:
            if current_selection.get("style_pack_id"):
                self.select_design_pack(owner_id, project_id, replacement_session["session_id"], str(current_selection["style_pack_id"]), "style")
            if current_selection.get("template_pack_id"):
                self.select_design_pack(owner_id, project_id, replacement_session["session_id"], str(current_selection["template_pack_id"]), "template")

        replacement = self.create_generation_plan(
            owner_id,
            project_id,
            replacement_session["session_id"],
            [dict(item) for item in structured.get("pageDrafts") or []],
        )
        replacement_structured = dict(replacement["structured_plan"])
        replacement_structured["restartOfPlanId"] = plan_id
        self.store.update_plan(
            project_id,
            replacement["plan_id"],
            status=replacement["status"],
            structured_plan=replacement_structured,
            confirmed=False,
        )

        archived_pages = self.store.archive_pages_for_operation(project_id, plan_id)
        structured.update({
            "supersededByPlanId": replacement["plan_id"],
            "generationStage": "superseded",
            "nextAction": "open_replacement_plan",
        })
        self.store.update_plan(project_id, plan_id, status="superseded", structured_plan=structured, confirmed=True)
        self.store.audit(
            owner_id,
            "plan.restart_from_scratch",
            project_id=project_id,
            entity_type="plan",
            entity_id=replacement["plan_id"],
            detail={"restart_of_plan_id": plan_id, "archived_page_count": archived_pages},
        )
        self.store.emit_event(
            "plan.restarted",
            project_id=project_id,
            session_id=replacement_session["session_id"],
            payload={"plan_id": replacement["plan_id"], "restart_of_plan_id": plan_id, "archived_page_count": archived_pages},
        )
        return self.store.get_plan(project_id, replacement["plan_id"]) or replacement

    def _draft_fact_ids(self, project_id: str, draft: dict[str, Any], facts: list[dict[str, Any]]) -> list[str]:
        # An empty field is the normalized representation of an omitted hint;
        # only a non-empty explicit list should bypass content-based matching.
        if draft.get("fact_ids"):
            known = {item["fact_id"] for item in facts}
            explicit = [str(item) for item in draft.get("fact_ids") or []]
            if any(item not in known for item in explicit):
                raise ConflictError("Page draft references a fact outside the current project")
            return list(dict.fromkeys(explicit))
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

    def materialize_pages(
        self,
        owner_id: str,
        project_id: str,
        drafts: list[dict[str, Any]],
        *,
        operation_id: str | None = None,
        preview_only: bool = False,
        create_visual_reference: bool = True,
    ) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        existing = self.store.list_pages(project_id)
        operation_plan = self.store.get_plan(project_id, operation_id) if operation_id else None
        production_session_id = operation_plan.get("session_id") if operation_plan else None
        production_design_selection_id = (operation_plan or {}).get("structured_plan", {}).get("designSelectionId")
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
            draft_payload = {
                **dict(draft),
                "page_id": page_id,
                "fact_ids": fact_ids,
                "locked_fact_ids": [item["fact_id"] for item in facts if item["fact_id"] in fact_ids and item.get("locked")],
            }
            page_facts = [item for item in facts if item["fact_id"] in fact_ids]
            locked_page_facts = [item for item in page_facts if item.get("locked")]
            required_verbatim = list(dict.fromkeys(str(item) for item in draft_payload.get("verbatim_text") or [] if str(item)))
            draft_artifact = self._record_artifact(
                project_id,
                "page_draft",
                json.dumps(draft_payload, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                "application/json",
            )
            page_writer_run = self.store.get_agent_run(project_id, str(draft.get("page_writer_run_id") or "")) if draft.get("page_writer_run_id") else None
            if page_writer_run:
                if page_writer_run.get("status") != "completed" or draft.get("page_writer_output_artifact_id") not in page_writer_run.get("output_artifact_ids", []):
                    raise ConflictError("Confirmed Page Writer provenance is unavailable")
                writer_output = {
                    "title": draft.get("title"),
                    "bodyParagraphs": str(draft.get("body") or "").splitlines(),
                    "conclusion": draft.get("conclusion"),
                    "verbatimText": draft.get("verbatim_text") or [],
                    "visualNotes": draft.get("visual_suggestion"),
                    "splitRecommended": False,
                }
                writer_parent_run_id = page_writer_run["agent_run_id"]
            elif draft.get("page_writer_status") == "not_required":
                writer_output = {
                    "title": draft.get("title"),
                    "bodyParagraphs": str(draft.get("body") or "").splitlines(),
                    "conclusion": draft.get("conclusion"),
                    "verbatimText": draft.get("verbatim_text") or [],
                    "visualNotes": draft.get("visual_suggestion"),
                    "splitRecommended": False,
                }
                writer_parent_run_id = str(draft.get("import_analyst_run_id") or "") or None
            else:
                page_writer_run = self._record_stage_agent_run(
                    owner_id,
                    project_id,
                    role="page_writer",
                    session_id=production_session_id,
                    input_artifact_ids=[draft_artifact["artifact_id"]],
                    summary={
                        "page_drafts": [draft_payload],
                        "reviewed_facts": self._fact_context_rows(page_facts),
                        "locked_facts": self._fact_context_rows(locked_page_facts),
                        "verbatim_text": required_verbatim,
                        "content_mode": draft.get("content_mode", "strict_preserve"),
                        "language": (operation_plan or {}).get("structured_plan", {}).get("language"),
                        "audience": (operation_plan or {}).get("structured_plan", {}).get("audience"),
                    },
                )
                writer_output = self._agent_output(project_id, page_writer_run)
                writer_parent_run_id = page_writer_run["agent_run_id"]
            if writer_output.get("splitRecommended"):
                raise ConflictError("Page Writer recommends splitting an over-dense page; content confirmation is required")
            writer_title = " ".join(str(writer_output.get("title") or draft["title"]).split())
            paragraphs = [str(item).strip() for item in writer_output.get("bodyParagraphs", []) if str(item).strip()]
            writer_body = "\n".join(paragraphs) or str(draft.get("body") or "")
            writer_conclusion = str(writer_output.get("conclusion") or "")
            preserved_verbatim = list(dict.fromkeys([*required_verbatim, *(str(item) for item in writer_output.get("verbatimText", []) if str(item))]))
            preservation_surface = "\n".join([writer_title, writer_body, writer_conclusion, *preserved_verbatim])
            if any(str(item.get("value") or "") not in preservation_surface for item in locked_page_facts):
                raise ConflictError("Page Writer changed or omitted a locked fact value")
            if not writer_title or len(writer_title) > 160 or len(writer_body) > 5000:
                raise ConflictError("Page Writer output exceeds the confirmed page bounds")
            conclusion, compressible_content = self._body_contract_fields(writer_body)
            design_snapshot = dict(draft.get("design_snapshot") or {
                "style_pack_id": None,
                "template_pack_id": None,
                "selection_source": "none",
                "capability_matrix": {},
            })
            contract = PageContract(
                page_id=page_id,
                page_type=page_type,
                purpose="Present the approved page draft",
                title=writer_title,
                conclusion=str(writer_conclusion or conclusion)[:300],
                required_fact_ids=tuple(fact_ids),
                verbatim_text=tuple(preserved_verbatim),
                compressible_content=compressible_content,
                visual_direction=str(draft.get("visual_direction") or writer_output.get("visualNotes") or "quiet editorial workspace"),
                layout_intent=str(draft.get("layout_intent") or "title_body"),
                density=str(draft.get("density") or "balanced"),
                hierarchy_style=str(draft.get("hierarchy_style") or "standard"),
                accent_color=str(draft.get("accent_color") or "#D14D3F"),
                background_color=str(draft.get("background_color") or "#F7F8FA"),
                image_artifact_ids=(assets[offset % len(assets)]["artifact_id"],) if assets else (),
                source_hashes=tuple(str(value) for value in draft.get("source_hashes", [])),
                contract_revision=1,
                content_blocks=({"block_id": f"block_{page_id}_body", "kind": "paragraph", "content": {"text": writer_body}, "source_hashes": list(str(value) for value in draft.get("source_hashes", []))},),
                speaker_notes=str(draft.get("speaker_notes") or ""),
                page_size={"width": float(draft.get("page_width", 13.333)), "height": float(draft.get("page_height", 7.5)), "unit": str(draft.get("page_unit", "inch"))},
                font_policy={"zh_family": str(draft.get("zh_font") or "Microsoft YaHei"), "latin_family": str(draft.get("latin_font") or "Arial"), "fallback_families": list(draft.get("font_fallbacks") or [])},
                template_artifact_ids=tuple(str(value) for value in draft.get("template_artifact_ids", [])),
                design_snapshot=design_snapshot,
            )
            validate_page_contract(contract.to_dict())
            candidate_contract_artifact = self._record_artifact(project_id, "contract_candidate", json.dumps(contract.to_dict(), ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
            visual_run = self._record_stage_agent_run(
                owner_id,
                project_id,
                role="visual_director",
                session_id=production_session_id,
                parent_run_id=writer_parent_run_id,
                input_artifact_ids=[candidate_contract_artifact["artifact_id"]],
                summary={
                    "page_id": page_id,
                    "layout_intent": contract.layout_intent,
                    "hierarchy_style": contract.hierarchy_style,
                    "accent_color": contract.accent_color,
                    "background_color": contract.background_color,
                    "visual_direction": contract.visual_direction,
                    "image_required": bool(contract.image_artifact_ids),
                    "design_snapshot": design_snapshot,
                    "logic_analysis": draft.get("logic_analysis") or {},
                },
                design_selection_id=str(draft.get("design_selection_id") or production_design_selection_id or "") or None,
            )
            visual_output = self._agent_output(project_id, visual_run)
            has_design = bool(design_snapshot.get("style_pack_id") or design_snapshot.get("template_pack_id"))
            if visual_output.get("designMode") == "selected" and not has_design:
                raise ConflictError("Visual Director attempted to apply a design pack when design_mode must be none")
            contract = replace(
                contract,
                visual_direction=str(visual_output["visualDirection"]),
                layout_intent=str(visual_output["layoutIntent"]),
                hierarchy_style=str(visual_output["hierarchyStyle"]),
                accent_color=str(visual_output["accentColor"]),
                background_color=str(visual_output["backgroundColor"]),
            )
            validate_page_contract(contract.to_dict())
            contract_content = json.dumps(contract.to_dict(), ensure_ascii=False, indent=2, default=str).encode("utf-8")
            contract_artifact = self._record_artifact(project_id, "contract", contract_content, "application/json")
            if page_writer_run:
                self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="page_contract", entity_id=page_id, detail={"agent_run_id": page_writer_run["agent_run_id"], "fields": ["title", "conclusion", "compressible_content", "verbatim_text"]})
            self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="page_contract", entity_id=page_id, detail={"agent_run_id": visual_run["agent_run_id"], "fields": ["visual_direction", "layout_intent", "hierarchy_style", "accent_color", "background_color"]})
            svg = self._render_contract_svg(project_id, contract, writer_body, offset + 1)
            quick_artifact = self._record_artifact(project_id, "quick_preview", svg, "image/svg+xml")
            visual_artifact = None
            if create_visual_reference:
                visual = self._render_contract_visual(project_id, contract, writer_body, offset + 1)
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
                    "visual_preview_artifact_id": visual_artifact["artifact_id"] if visual_artifact else None,
                    "svg_artifact_id": svg_artifact["artifact_id"] if svg_artifact else None,
                    "editable_level": "visual" if preview_only else "native_structure",
                    "status": ("previewing" if preview_only else "ready") if visual_artifact else "awaiting_visual_generation",
                    "qa": {"quick_preview": "available", "visual_preview": "available" if visual_artifact else "pending", "visual_preview_media_type": "image/png" if visual_artifact else None, "representative": preview_only, "authoritative_render": "pending" if self.settings.render_backend == "powerpoint" else "unavailable", "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "full_slide_raster": False, "page_writer_run_id": page_writer_run["agent_run_id"] if page_writer_run else None, "visual_director_run_id": visual_run["agent_run_id"]},
                },
                page_id=page_id,
            )
            self.store.emit_event("preview.quick.ready", project_id=project_id, page_id=page_id, version_id=page["version_id"], payload={"artifact_id": quick_artifact["artifact_id"]})
            if visual_artifact:
                self.store.emit_event("preview.visual.ready", project_id=project_id, page_id=page_id, version_id=page["version_id"], payload={"artifact_id": visual_artifact["artifact_id"], "representative": preview_only})
            self.store.emit_event("page.version.created", project_id=project_id, page_id=page_id, version_id=page["version_id"])
            created.append(self.store.get_page(project_id, page["page_id"]) or {**page, "project_id": project_id})
        self.store.update_project(owner_id, project_id, status="degraded" if self.settings.render_backend == "unavailable" else "processing")
        return created

    def _reconstruct_sample_pages(self, owner_id: str, project_id: str, operation_id: str) -> None:
        self._project(owner_id, project_id)
        plan = self.store.get_plan(project_id, operation_id)
        session_id = plan.get("session_id") if plan else None
        design_selection_id = (plan or {}).get("structured_plan", {}).get("designSelectionId")
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
                planner = self._record_stage_agent_run(owner_id, project_id, role="reconstruction_planner", session_id=session_id, input_artifact_ids=[page["page_contract_artifact_id"], page["visual_preview_artifact_id"]], summary={"page_id": page["page_id"], "objects": [{"type": "background"}, {"type": "text"}, {"type": "shape"}]}, design_selection_id=design_selection_id)
                self._record_stage_agent_run(owner_id, project_id, role="qa_reviewer", session_id=session_id, parent_run_id=planner["agent_run_id"], input_artifact_ids=[svg_artifact["artifact_id"]], summary={"page_id": page["page_id"], "status": "passed", "full_slide_raster": False}, design_selection_id=design_selection_id)
                self.store.emit_event("page.version.created", project_id=project_id, operation_id=operation_id, page_id=page["page_id"], version_id=version["version_id"], payload={"representative_approved": True})

    def _page_contract(self, project_id: str, page: dict[str, Any]) -> PageContract:
        payload = json.loads(self._artifact_bytes(project_id, page["page_contract_artifact_id"]).decode("utf-8"))
        payload["page_type"] = PageType(payload["page_type"])
        for key in ("required_fact_ids", "verbatim_text", "compressible_content", "prohibited_content", "image_artifact_ids", "source_hashes"):
            payload[key] = tuple(payload.get(key, ()))
        payload["template_artifact_ids"] = tuple(payload.get("template_artifact_ids", ()))
        payload["content_blocks"] = tuple(dict(item) for item in payload.get("content_blocks", ()))
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
        # The Edit Planner must see the exact current contract, design snapshot,
        # and revision chain that its change proposal will target.
        page_versions = []
        for page in selected:
            versions = self.store.versions_for_page(project_id, page["page_id"])
            page_versions.append({
                "page_id": page["page_id"],
                "current_version_id": page.get("current_version_id"),
                "versions": [
                    {
                        "version_id": item.get("version_id"),
                        "parent_version_id": item.get("parent_version_id"),
                        "operation_id": item.get("operation_id"),
                        "page_contract_artifact_id": item.get("page_contract_artifact_id"),
                        "status": item.get("status"),
                        "editable_level": item.get("editable_level"),
                        "created_at": item.get("created_at"),
                    }
                    for item in versions
                ],
            })
        snapshots = [dict(contract.design_snapshot or {}) for contract in contracts]
        design_context = snapshots[0] if snapshots and all(item == snapshots[0] for item in snapshots[1:]) else {
            "design_mode": "mixed",
            "page_snapshots": {contract.page_id: dict(contract.design_snapshot or {}) for contract in contracts},
        }
        edit_session_id = None
        design_selection_id = None
        source_plan_ids = {str(page.get("operation_id")) for page in selected if page.get("operation_id")}
        if len(source_plan_ids) == 1:
            source_plan = self.store.get_plan(project_id, next(iter(source_plan_ids)))
            if source_plan:
                edit_session_id = source_plan.get("session_id")
                design_selection_id = source_plan.get("structured_plan", {}).get("designSelectionId")
        selection_ids = {str(page.get("design_selection_id")) for page in selected if page.get("design_selection_id")}
        if not design_selection_id and len(selection_ids) == 1:
            design_selection_id = next(iter(selection_ids))
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
        prompt = compose_planning_prompt(
            instruction=instruction,
            workflow_mode=mode,
            target_scope=scope,
            page_contracts=contracts,
            facts=facts,
            design_snapshot=design_context,
            page_versions=page_versions,
        )
        edit_run, agent_settings, rendered_prompt = self._prepare_agent_run(
            project_id,
            role="edit_planner",
            session_id=edit_session_id,
            parent_run_id=None,
            input_artifact_ids=[page["page_contract_artifact_id"] for page in selected],
            user_prompt=prompt,
            output_schema=PLAN_OUTPUT_SCHEMA,
            explicit_context={
                "user_options": {"instruction": instruction, "target_scope": scope.value, "workflow_mode": mode.value},
                "locked_facts": [item.__dict__ if hasattr(item, "__dict__") else asdict(item) for item in facts if item.locked],
                "page_contracts": [asdict(item) for item in contracts],
                "design_snapshot": design_context,
                "page_versions": page_versions,
            },
            profile_id=None,
            idempotency_key=None,
            design_selection_id=design_selection_id,
        )
        usage_request_id = edit_run["usage_request_id"]
        price, reserved_usage = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, usage_request_id, agent_settings.backend.value, agent_settings.model, price, reserved_usage)
        self.store.update_usage(usage_request_id, "submitted")
        self.store.update_agent_run(project_id, edit_run["agent_run_id"], status="running")
        try:
            result = await self.harness.run(
                agent_settings,
                AgentRequest(rendered_prompt, PLAN_OUTPUT_SCHEMA, {"role": "edit_planner", "task_id": edit_run["agent_run_id"], "page_ids": resolved, "target_scope": scope.value, "workflow_mode": mode.value}),
                production=self.settings.agent_production,
            )
            planned_output = validate_stage_output(
                "edit_planner",
                result.output,
                strict=agent_settings.backend != AgentBackend.DETERMINISTIC_TEST,
            )
            change_kinds = {str(item.get("kind")) for item in planned_output.get("changes", []) if isinstance(item, dict)}
            invalidation_reasons: list[str] = []
            if change_kinds.intersection({"rewrite_text", "preserve_fact"}) or any(planned_output.get("pageDelta", {}).get(key) for key in ("add", "remove", "split", "merge")):
                invalidation_reasons.append("content_change_invalidates_generated_pages")
            if change_kinds.intersection({"layout_change", "hierarchy_change", "color_change", "image_change"}):
                invalidation_reasons.append("design_change_invalidates_visual_approval")
            if invalidation_reasons:
                planned_output["requiresConfirmation"] = True
                planned_output["confirmationReasons"] = list(dict.fromkeys([*planned_output.get("confirmationReasons", []), *invalidation_reasons, "restart_recommended"]))
            validated = validate_plan(planned_output, known)
        except AgentError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(usage_request_id, status, error=exc.code)
            self.store.update_agent_run(project_id, edit_run["agent_run_id"], status=status, error={"code": exc.code, "message": str(exc), "retryable": exc.retryable})
            raise
        except (ContractValidationError, TypeError, ValueError) as exc:
            self.store.update_usage(usage_request_id, "failed", error="output_contract_violation")
            self.store.update_agent_run(project_id, edit_run["agent_run_id"], status="failed", error={"code": "output_contract_violation", "message": str(exc), "retryable": False})
            raise ConflictError(f"Edit Planner output contract violation: {exc}") from exc

        # Validate image references before persisting any successful output or
        # settling usage.  An image_change is an output-impact claim, so both
        # project ownership and the immutable Artifact bytes must be present.
        assets = {str(item.get("artifact_id")) for item in self.store.list_project_assets(project_id)}
        invalid_image_reference: str | None = None
        for change in planned_output.get("changes", []):
            if not isinstance(change, dict) or change.get("kind") != "image_change":
                continue
            value = change.get("value")
            artifact_id = value.get("artifactId") if isinstance(value, dict) else None
            artifact_id = str(artifact_id) if artifact_id else ""
            artifact = self.store.get_artifact(project_id, artifact_id) if artifact_id else None
            if (
                not artifact_id
                or artifact_id not in assets
                or not artifact
                or not str(artifact.get("media_type") or "").startswith("image/")
            ):
                invalid_image_reference = artifact_id or "missing"
                break
            try:
                self._artifact_bytes(project_id, artifact_id)
            except (ConflictError, NotFoundError, OSError):
                invalid_image_reference = artifact_id
                break
        if invalid_image_reference is not None:
            error_code = "unregistered_image_artifact"
            error_message = "Image changes must reference an image registered in this project"
            self.store.update_usage(usage_request_id, "failed", error=error_code)
            self.store.update_agent_run(
                project_id,
                edit_run["agent_run_id"],
                status="failed",
                error={"code": error_code, "message": error_message, "retryable": False},
            )
            self.store.emit_event(
                "agent.run.failed",
                project_id=project_id,
                payload={"agent_run_id": edit_run["agent_run_id"], "reason": error_code},
            )
            raise ConflictError(error_message)

        output_artifact = self._record_artifact(project_id, "agent_output", json.dumps(result.output, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        self.store.update_agent_run(project_id, edit_run["agent_run_id"], status="completed", provider_request_id=result.thread_id, output_artifact_ids=[output_artifact["artifact_id"]], output_digest="sha256:" + output_artifact["sha256"])
        self.store.update_usage(usage_request_id, "settled", settled={"usage": result.usage or {}, "amount": 0, "currency": "CNY"})
        mixed_state = None
        if scope != TargetScope.GLOBAL and len(resolved) < len(pages):
            mixed_state = "mixed_content" if change_kinds.intersection({"rewrite_text", "preserve_fact"}) else "mixed_design"
        plan_payload = planned_output | {
            "requiresConfirmation": validated.requires_confirmation,
            "confirmationReasons": list(validated.confirmation_reasons),
            "_instruction": instruction,
            "_promptArtifactId": edit_run["prompt_artifact_id"],
            "_agent": {"agent_run_id": edit_run["agent_run_id"], "backend": result.backend, "model": result.model, "thread_id": result.thread_id, "usage": result.usage},
            "_usageRequestId": usage_request_id,
            "_mixedState": mixed_state,
            "_sessionId": edit_session_id,
            "_designSelectionId": design_selection_id,
            "_designSnapshot": design_context,
        }
        operation = self.store.create_operation(project_id, edit_session_id, plan_payload)
        self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="operation", entity_id=operation["operation_id"], detail={"agent_run_id": edit_run["agent_run_id"], "fields": ["changes", "pageDelta", "factImpact", "confirmationReasons"]})
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
        operation_session_id = operation.get("session_id") or operation["structured_plan"].get("_sessionId")
        operation_design_selection_id = operation["structured_plan"].get("_designSelectionId")
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
                    contract_revision=contract.contract_revision + 1,
                    content_blocks=({"block_id": f"block_{contract.page_id}_body", "kind": "paragraph", "content": {"text": body}, "source_hashes": list(contract.source_hashes)},),
                    speaker_notes=contract.speaker_notes,
                    page_size=contract.page_size,
                    font_policy=contract.font_policy,
                    template_artifact_ids=contract.template_artifact_ids,
                    design_snapshot=contract.design_snapshot,
                )
                validate_page_contract(revised.to_dict())
                candidate_artifact = self._record_artifact(project_id, "contract_candidate", json.dumps(revised.to_dict(), ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
                visual_change = bool(set(executed).intersection({"layout_change", "hierarchy_change", "color_change", "image_change"}))
                visual_run = None
                if visual_change:
                    visual_run = self._record_stage_agent_run(owner_id, project_id, role="visual_director", session_id=operation_session_id, input_artifact_ids=[candidate_artifact["artifact_id"]], summary={"page_id": page_id, "layout_intent": revised.layout_intent, "hierarchy_style": revised.hierarchy_style, "accent_color": revised.accent_color, "background_color": revised.background_color, "visual_direction": revised.visual_direction, "design_snapshot": revised.design_snapshot}, design_selection_id=operation_design_selection_id)
                    visual_output = self._agent_output(project_id, visual_run)
                    revised = replace(revised, visual_direction=str(visual_output["visualDirection"]), layout_intent=str(visual_output["layoutIntent"]), hierarchy_style=str(visual_output["hierarchyStyle"]), accent_color=str(visual_output["accentColor"]), background_color=str(visual_output["backgroundColor"]))
                    validate_page_contract(revised.to_dict())
                contract_artifact = self._record_artifact(project_id, "contract", json.dumps(revised.to_dict(), ensure_ascii=False, indent=2, default=str).encode("utf-8"), "application/json")
                svg = self._render_contract_svg(project_id, revised, self._contract_body(revised) or instruction, int(page["order_index"]) + 1)
                quick_artifact = self._record_artifact(project_id, "quick_preview", svg, "image/svg+xml")
                visual = self._render_contract_visual(project_id, revised, self._contract_body(revised) or instruction, int(page["order_index"]) + 1)
                visual_artifact = self._record_artifact(project_id, "visual_preview", visual, "image/png")
                svg_artifact = self._record_artifact(project_id, "svg", svg, "image/svg+xml")
                version = self.store.create_page_version(project_id, page_id, {"operation_id": operation_id, "page_contract_artifact_id": contract_artifact["artifact_id"], "prompt_snapshot_artifact_id": operation["structured_plan"].get("_promptArtifactId"), "quick_preview_artifact_id": quick_artifact["artifact_id"], "visual_preview_artifact_id": visual_artifact["artifact_id"], "svg_artifact_id": svg_artifact["artifact_id"], "editable_level": "native_partial" if image_ids else "native_structure", "status": "ready", "qa": {"quick_preview": "available", "visual_preview": "provisional", "visual_preview_media_type": "image/png", "executed_changes": executed, "reconstruction": "provisional", "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "full_slide_raster": False, "visual_director_run_id": visual_run["agent_run_id"] if visual_run else None}})
                if not version:
                    raise ConflictError("Page version could not be created")
                current_page = self.store.get_page(project_id, page_id)
                if not current_page:
                    raise ConflictError("Edited page is unavailable before Image Prompt creation")
                parent_run_id = visual_run["agent_run_id"] if visual_run else str(operation["structured_plan"].get("_agent", {}).get("agent_run_id") or "") or None
                image_run = self._create_visual_image_run(owner_id, project_id, current_page, revised, parent_run_id=parent_run_id)
                reconstruction_run = self._record_stage_agent_run(owner_id, project_id, role="reconstruction_planner", session_id=operation_session_id, parent_run_id=visual_run["agent_run_id"] if visual_run else None, input_artifact_ids=[contract_artifact["artifact_id"], visual_artifact["artifact_id"]], summary={"page_id": page_id, "objects": [{"type": "background"}, {"type": "text"}, {"type": "shape"}], "provisional_visual": True, "design_snapshot": revised.design_snapshot}, design_selection_id=operation_design_selection_id)
                qa_run = self._record_stage_agent_run(owner_id, project_id, role="qa_reviewer", session_id=operation_session_id, parent_run_id=reconstruction_run["agent_run_id"], input_artifact_ids=[contract_artifact["artifact_id"], svg_artifact["artifact_id"]], summary={"page_id": page_id, "status": "provisional", "full_slide_raster": False, "image_run_id": image_run["image_run_id"]}, design_selection_id=operation_design_selection_id)
                self.store.audit(owner_id, "agent.output.applied", project_id=project_id, entity_type="page_version", entity_id=version["version_id"], detail={"agent_run_id": qa_run["agent_run_id"], "disposition": "provisional_qa_recorded"})
                self.store.set_page_fact_anchors(project_id, page_id, fact_ids)
                result_versions.append(version["version_id"])
                self.store.emit_event("preview.quick.ready", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"], payload={"artifact_id": quick_artifact["artifact_id"]})
                self.store.emit_event("preview.visual.ready", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"], payload={"artifact_id": visual_artifact["artifact_id"], "provisional": True})
                self.store.emit_event("page.version.created", project_id=project_id, operation_id=operation_id, page_id=page_id, version_id=version["version_id"])
                self.store.emit_event("operation.progress", project_id=project_id, operation_id=operation_id, page_id=page_id, payload={"completed": len(result_versions), "total": len(operation["resolved_page_ids"])})
            except Exception as exc:
                page_errors[page_id] = str(exc)
                self.store.emit_event("operation.failed", project_id=project_id, operation_id=operation_id, page_id=page_id, payload={"recoverable": True, "reason": str(exc)})
        status = "completed" if len(result_versions) == len(operation["resolved_page_ids"]) else ("partial" if result_versions else "failed")
        error = {"page_errors": page_errors, "recoverable": bool(page_errors)} if page_errors else {}
        self.store.update_operation_status(project_id, operation_id, status, result_version_ids=result_versions, error=error)
        if status == "completed" and operation["structured_plan"].get("_mixedState"):
            self.store.update_project(owner_id, project_id, status=operation["structured_plan"]["_mixedState"])
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
            design_digests = []
            for version in locked_versions:
                contract_payload = json.loads(self._artifact_bytes(project_id, version["page_contract_artifact_id"]).decode("utf-8"))
                design_digests.append(sha256_json(contract_payload.get("design_snapshot") or {}))
            consistency_candidates = [str((plan.get("structured_plan") or {}).get("consistencyStatus") or "") for plan in self.store.list_plans(project_id)]
            consistency_status = next((item for item in consistency_candidates if item in {"mixed_content", "mixed_design"}), "mixed_design" if len(set(design_digests)) > 1 else "consistent")
            qa = {"product_version": VERSION, "technical_version": __version__, "schema_version": SCHEMA_VERSION, "pptx_sha256": result.pptx_sha256, "slide_count": result.slide_count, "kernel_version": result.kernel_version, "svg_qa_status": result.svg_qa_status, "svg_qa_sha256": result.svg_qa_sha256, "pptx_qa_status": result.pptx_qa_status, "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "advisories": list(result.advisories), "version_lock": export["version_lock"], "consistency_status": consistency_status, "page_design_digests": design_digests}
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

    # v2 task-one vertical slice -------------------------------------------------
    def task1_preview(self, owner_id: str, project_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        request = validate_task1_request(payload)
        if request["project_id"] != project_id:
            raise ConflictError("Task-one project_id does not match the route project")
        output_dir = self.settings.data_dir / "task1" / project_id / request["idempotency_key"] / "preview"
        result = self.task1_runner.preview(request, output_dir=output_dir)
        snapshot = dict(result.manifest.get("design_snapshot") or {})
        preview_key = request["idempotency_key"] + ":preview"
        self.store.create_v2_design_snapshot(project_id, preview_key, snapshot)
        descriptor = result.manifest.get("preview_artifact")
        if isinstance(descriptor, Mapping):
            self._persist_task1_descriptor(
                project_id,
                output_dir,
                descriptor,
                kind="task1_preview",
                expected_artifact_id=task1_preview_artifact_id(project_id, request["idempotency_key"]),
            )
            self.store.create_v2_artifact_commit(project_id, preview_key, dict(descriptor), status="committed")
        elif result.mode == "style_template":
            raise ConflictError("DESIGN_CONFIRMATION_REQUIRED: preview Artifact was not published")
        return {"status": result.status, "mode": result.mode, "design_snapshot": snapshot, "preview_artifact": descriptor}

    def task1_generate(self, owner_id: str, project_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        request = validate_task1_request(payload)
        if request["project_id"] != project_id:
            raise ConflictError("Task-one project_id does not match the route project")
        preview_snapshot = self._task1_preview_snapshot(project_id, request)
        output_dir = self.settings.data_dir / "task1" / project_id / request["idempotency_key"]
        manifest_path = output_dir / "manifest.json"
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if manifest.get("project_id") == project_id and manifest.get("mode") == request["expected_mode"] and manifest.get("input_hash") == sha256_json(request):
                    reconciled = self._reconcile_task1_manifest(project_id, request["idempotency_key"], output_dir, manifest)
                    return {**reconciled, "status": "completed"}
                if manifest.get("project_id") == project_id:
                    raise ConflictError("IDEMPOTENCY_CONFLICT: task-one key was already used with different input")
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
        try:
            result = self.task1_runner.run(request, output_dir=output_dir, preview_snapshot=preview_snapshot)
        except Exception as exc:
            if getattr(exc, "code", None):
                raise ConflictError(f"{getattr(exc, 'code')}: {exc}") from exc
            raise
        reconciled = self._reconcile_task1_manifest(project_id, request["idempotency_key"], output_dir, result.manifest)
        return {**reconciled, "status": "completed"}

    def task1_recover(self, owner_id: str, project_id: str, idempotency_key: str) -> dict[str, Any]:
        self._project(owner_id, project_id)
        idempotency_key = validate_task1_token(idempotency_key, "idempotency_key")
        output_dir = self.settings.data_dir / "task1" / project_id / idempotency_key
        manifest_path = output_dir / "manifest.json"
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                reconciled = self._reconcile_task1_manifest(project_id, idempotency_key, output_dir, manifest)
                return {"status": "recovered", "manifest": reconciled}
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ConflictError("Task-one manifest is corrupt") from exc
        checkpoint = self.store.get_v2_checkpoint(project_id, idempotency_key)
        if checkpoint:
            return {"status": "recovery_required", "checkpoint": checkpoint.get("checkpoint") or checkpoint}
        raise NotFoundError("Task-one generation checkpoint not found")

    def health(self) -> dict[str, Any]:
        return {
            "api": {"status": "ready"},
            "metadata_store": self.store.health(),
            "artifact_store": self.artifacts.health(),
            "queue": {"status": "ready", "backend": self.settings.queue_backend, "worker": self.store.worker_health("worker")},
            "model": self.harness.probe(self.settings.agent, production=self.settings.agent_production),
            "render_worker": self.store.worker_health("render") | {"backend": self.settings.render_backend},
            "kernel": self.adapter.probe(),
            "task1_startup_reconciliation": self.task1_startup_reconciliation,
            "deployment": self.settings.public_summary(),
        }
