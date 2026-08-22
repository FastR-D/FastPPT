"""Shared FastPPT application service used by local and server APIs."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import tempfile
import ipaddress
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastppt_agent_harness import AgentBackend, AgentError, AgentHarness, AgentRequest, DeterministicImageAdapter, ImageAdapterError, ImageRequest, OpenAIImageAdapter
from fastppt_core.contracts import ContractValidationError, validate_page_contract, validate_plan, validate_reconstruction_manifest, validate_transition, IMAGE_RUN_TRANSITIONS
from fastppt_core.documents import MEDIA_TYPES, DocumentError, extract_pptx_import_manifest, page_drafts_from_markdown, parse_document, safe_file_name
from fastppt_core.ids import new_id
from fastppt_core.models import AgentRole, FactAnchor, PageContract, PageType, TargetScope, WorkflowMode
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
        price = {"amount": 0, "currency": "CNY", "source": "billing_disabled"}
        reserved = {"requests": 1, "amount": 0, "currency": "CNY"}
        return price, reserved

    async def _run_agent(self, project_id: str, request: AgentRequest) -> tuple[Any, str]:
        if self.settings.agent.backend == AgentBackend.UNCONFIGURED:
            raise ConflictError("No Agent provider is configured")
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
        project = self.store.create_project(owner_id, clean)
        self.store.audit(owner_id, "project.create", project_id=project["project_id"], entity_type="project", entity_id=project["project_id"])
        return project

    @staticmethod
    def _validate_provider_profile(profile: dict[str, Any]) -> dict[str, Any]:
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
        capabilities = profile.get("capability_settings") or {}
        if not isinstance(capabilities, dict):
            raise ValueError("capability_settings must be an object")
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
            settings.validate(production=self.settings.production)
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
            return settings, "runtime-default", {"endpoint_mode": settings.endpoint_mode.value, "protocol": settings.protocol.value, "model": settings.model}
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
        return settings, str(profile["profile_id"]), {"endpoint_mode": settings.endpoint_mode.value, "protocol": settings.protocol.value, "model": settings.model}

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
        # The actual SDK probe is injected by the worker.  Persist a bounded
        # status now so the UI can distinguish untested from configured.
        result = self.store.update_provider_capability_test(profile_id, capability, "ready") or profile
        self.store.audit(actor_id, "provider_profile.test", entity_type="provider_profile", entity_id=profile_id, detail={"capability": capability, "status": "ready"})
        return {"profile": result, "capability": capability, "status": "ready", "detail": "configuration accepted; live probe is queued"}

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
        agent_settings, resolved_profile_id, provider_snapshot = self._agent_settings_for(project_id, str(profile_id) if profile_id else None)
        metadata = dict(values.get("metadata") or {})
        context_digest = values.get("context_digest") or hashlib.sha256(json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        result = self.store.create_agent_run(project_id, {**values, "role": role, "profile_id": resolved_profile_id, "model": values.get("model") or agent_settings.model, "provider_snapshot": values.get("provider_snapshot") or provider_snapshot, "input_artifact_ids": input_artifact_ids, "context_digest": context_digest})
        self.store.enqueue_job(project_id, "agent_run", {"owner_id": owner_id, "agent_run_id": result["agent_run_id"], "profile_id": resolved_profile_id, "prompt": values.get("prompt", ""), "output_schema": values.get("output_schema") or PLAN_OUTPUT_SCHEMA, "metadata": values.get("metadata") or {}}, f"agent:{result['agent_run_id']}")
        self.store.emit_event("agent.run.started", project_id=project_id, session_id=values.get("session_id"), payload={"agent_run_id": result["agent_run_id"], "role": result["role"], "parent_run_id": result.get("parent_run_id")})
        return result

    def _record_stage_agent_run(self, owner_id: str, project_id: str, *, role: str, session_id: str | None, parent_run_id: str | None = None, input_artifact_ids: list[str] | None = None, summary: dict[str, Any] | None = None) -> dict[str, Any]:
        agent_settings, profile_id, provider_snapshot = self._agent_settings_for(project_id)
        if agent_settings.backend == AgentBackend.UNCONFIGURED:
            raise ConflictError("No Agent provider is configured")
        request_id = new_id("request")
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, request_id, agent_settings.backend.value, agent_settings.model, price, reserved)
        self.store.update_usage(request_id, "submitted")
        try:
            result = asyncio.run(
                self.harness.run(
                    agent_settings,
                    AgentRequest(
                        f"You are the {role} stage in a presentation workflow. Return a bounded JSON stage result.",
                        PLAN_OUTPUT_SCHEMA,
                        {"role": role, "session_id": session_id, "summary": summary or {}},
                    ),
                    production=self.settings.production,
                )
            )
        except AgentError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(request_id, status, error=exc.code)
            self.store.create_agent_run(project_id, {"session_id": session_id, "parent_run_id": parent_run_id, "role": role, "profile_id": profile_id, "model": agent_settings.model, "input_artifact_ids": input_artifact_ids or [], "output_artifact_ids": [], "context_digest": hashlib.sha256(json.dumps(summary or {}, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(), "status": status, "usage_request_id": request_id, "provider_snapshot": provider_snapshot, "error": {"code": exc.code, "message": str(exc), "retryable": exc.retryable}, "idempotency_key": f"stage:{project_id}:{session_id}:{role}:{request_id}"})
            raise
        output_payload = result.output if isinstance(result.output, dict) else (summary or {})
        output = self._record_artifact(project_id, "agent_output", json.dumps(output_payload, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        self.store.update_usage(request_id, "settled", settled={"usage": result.usage or {}, "amount": 0, "currency": "CNY"})
        return self.store.create_agent_run(project_id, {"session_id": session_id, "parent_run_id": parent_run_id, "role": role, "profile_id": profile_id, "model": result.model, "input_artifact_ids": input_artifact_ids or [], "output_artifact_ids": [output["artifact_id"]], "context_digest": output["sha256"], "status": "completed", "usage_request_id": request_id, "provider_snapshot": {**provider_snapshot, "backend": result.backend, "model": result.model}, "provider_request_id": result.thread_id, "idempotency_key": f"stage:{project_id}:{session_id}:{role}:{output['sha256']}"})

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
            result = asyncio.run(self.harness.run(agent_settings, AgentRequest(str(payload.get("prompt", "")), dict(payload.get("output_schema") or PLAN_OUTPUT_SCHEMA), dict(payload.get("metadata") or {})), production=self.settings.production))
            output_artifact = self._record_artifact(project_id, "agent_output", json.dumps(result.output, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
            settled = {"usage": result.usage or {}, "amount": 0, "currency": "CNY"}
            self.store.update_usage(run["usage_request_id"], "settled", settled=settled)
            updated = self.store.update_agent_run(project_id, agent_run_id, status="completed", provider_request_id=result.thread_id, output_artifact_ids=[output_artifact["artifact_id"]])
            self.store.emit_event("agent.run.completed", project_id=project_id, payload={"agent_run_id": agent_run_id})
            source_text_id = (payload.get("metadata") or {}).get("source_text_id")
            if source_text_id:
                self.store.emit_event("source.ready", project_id=project_id, payload={"source_text_id": source_text_id, "agent_run_id": agent_run_id, "output_artifact_id": output_artifact["artifact_id"]})
            return updated or run
        except AgentError as exc:
            status = "submission_unknown" if exc.submission_unknown else "failed"
            self.store.update_usage(run["usage_request_id"], status, error=exc.code)
            updated = self.store.update_agent_run(project_id, agent_run_id, status=status, error={"code": exc.code, "message": str(exc), "retryable": exc.retryable})
            self.store.emit_event("agent.run.submission_unknown" if status == "submission_unknown" else "agent.run.failed", project_id=project_id, payload={"agent_run_id": agent_run_id})
            return updated or run

    def list_agent_runs(self, owner_id: str, project_id: str) -> list[dict[str, Any]]:
        self._project(owner_id, project_id)
        return self.store.list_agent_runs(project_id)

    def create_image_run(self, owner_id: str, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        self._project(owner_id, project_id)
        if values.get("status") not in {None, "queued"}:
            raise ValueError("New ImageRun must start in queued status")
        if values.get("page_id") and not self.store.get_page(project_id, str(values["page_id"])):
            raise NotFoundError("Page not found")
        if values.get("purpose") not in {"full_slide_reference", "local_element", "template_variation", "image_edit"}:
            raise ValueError("Image purpose is invalid")
        prompt_artifact = self.store.get_artifact(project_id, str(values.get("prompt_artifact_id") or ""))
        if not prompt_artifact or not str(prompt_artifact.get("media_type", "")).startswith("text/"):
            raise ConflictError("Image prompt must reference a registered text Artifact")
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
        settings, profile_id, provider_snapshot = self._image_settings_for(project_id, run["purpose"], (values or {}).get("profile_id") or None)
        if settings.api_key:
            adapter = OpenAIImageAdapter()
        elif self.settings.test_fixtures_enabled and profile_id == "runtime-default":
            adapter = DeterministicImageAdapter()
        else:
            raise ConflictError("No image provider is configured")
        prompt = self._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8", errors="replace")
        inputs = tuple(self._artifact_bytes(project_id, artifact_id) for artifact_id in run["input_artifact_ids"])
        previous_attempts = self.store.list_image_attempts(project_id, image_run_id)
        attempt = self.store.create_image_attempt(image_run_id, {"profile_id": profile_id, "provider_snapshot": provider_snapshot, "endpoint_mode": settings.endpoint_mode.value, "model": settings.model, "attempt_number": len(previous_attempts) + 1, "retry_of_attempt_id": previous_attempts[-1]["image_attempt_id"] if previous_attempts else None})
        price, reserved = self._usage_reservation(self.settings)
        self.store.reserve_usage(project_id, None, attempt["usage_request_id"], "openai_images", settings.model, price, reserved)
        self.store.update_usage(attempt["usage_request_id"], "submitted")
        self.store.update_image_run(project_id, image_run_id, status="running")
        self.store.update_image_attempt(attempt["image_attempt_id"], status="submitted")
        try:
            result = asyncio.run(adapter.generate(settings, ImageRequest(prompt, inputs, metadata={"image_run_id": image_run_id})))
            artifact_ids: list[str] = []
            hashes: list[str] = []
            for image in result.images:
                artifact = self._record_artifact(project_id, "generated_image", image, "image/png")
                artifact_ids.append(artifact["artifact_id"])
                hashes.append(artifact["sha256"])
            self.store.update_usage(attempt["usage_request_id"], "settled", settled={"usage": result.usage, "amount": 0, "currency": "CNY"})
            self.store.update_image_attempt(attempt["image_attempt_id"], status="completed", provider_request_id=result.provider_request_id, output_artifact_ids=artifact_ids, output_hashes=hashes)
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
        self.store.emit_event("reconstruction.completed" if status == "ready" else "reconstruction.failed", project_id=project_id, page_id=page_id, payload={"reconstruction_manifest_id": result["reconstruction_manifest_id"], "status": status})
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
        session_options.update({
            "content_mode": content_mode,
            "improvement_mode": improvement_mode,
            "representative_preflight": representative_preflight,
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
        source_artifacts = [document["artifact_id"] for document_id in session["source_document_ids"] if (document := self.store.get_document(project_id, document_id))]
        source_run = self._record_stage_agent_run(owner_id, project_id, role="source_analyst", session_id=session_id, input_artifact_ids=source_artifacts, summary={"source_count": len(source_artifacts), "fact_count": len(self.store.list_facts(project_id))})
        fact_run = self._record_stage_agent_run(owner_id, project_id, role="fact_reviewer", session_id=session_id, parent_run_id=source_run["agent_run_id"], input_artifact_ids=source_artifacts, summary={"unresolved_conflicts": len([item for item in self.store.list_fact_conflicts(project_id) if item["status"] == "detected"])})
        self._record_stage_agent_run(owner_id, project_id, role="outline_planner", session_id=session_id, parent_run_id=fact_run["agent_run_id"], input_artifact_ids=source_artifacts, summary={"page_count": len(cleaned), "workflow_mode": session["workflow_mode"]})
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
            "representativeDraftIds": [item["page_draft_id"] for item in cleaned[: min(2, len(cleaned))]],
            "contentMode": session.get("options", {}).get("content_mode", "strict_preserve"),
            "improvementMode": session.get("options", {}).get("improvement_mode", "redesign"),
            "representativePreflight": bool(session.get("options", {}).get("representative_preflight", False)),
            "generationStage": "awaiting_content_confirmation",
            "nextAction": "confirm_content",
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
        if plan["status"] in {"awaiting_design_confirmation", "generating_visuals", "awaiting_representative_confirmation", "awaiting_visual_confirmation", "reconstructing", "completed"}:
            return {"plan_id": plan_id, "status": plan["status"], "pages": [{"page_id": item["page_id"], "version_id": item["current_version_id"], "order_index": item["order_index"], "page_type": item["page_type"]} for item in existing], "next_action": plan["structured_plan"].get("nextAction")}
        if plan["status"] != "awaiting_content_confirmation":
            raise ConflictError("Content plan is not awaiting confirmation")
        structured = dict(plan["structured_plan"])
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
        structured.update({"generationStage": status, "nextAction": "confirm_representatives" if representative else "confirm_visuals", "generatedPageIds": [item["page_id"] for item in pages]})
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
        structured.update({"generationStage": status, "nextAction": "confirm_visuals" if status == "awaiting_visual_confirmation" else "wait_for_visuals", "generatedPageIds": [item["page_id"] for item in pages]})
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
            prompt = (
                "Generate exactly one complete presentation slide reference image. "
                f"Title: {contract.title}\nContent: {self._contract_body(contract)}\n"
                f"Purpose: {contract.purpose}\nVisual direction: {contract.visual_direction}\n"
                f"Layout: {contract.layout_intent}; page size: {contract.page_size}. "
                "Do not create a multi-slide collage. Leave enough space for every required text item."
            )
            prompt_artifact = self._record_artifact(project_id, "image_prompt", prompt.encode("utf-8"), "text/plain; charset=utf-8")
            input_ids = list(dict.fromkeys((*contract.template_artifact_ids, *contract.image_artifact_ids)))
            input_hashes = [self.store.get_artifact(project_id, artifact_id)["sha256"] for artifact_id in input_ids]
            run = self.create_image_run(owner_id, project_id, {
                "page_id": page["page_id"],
                "purpose": "full_slide_reference",
                "prompt_artifact_id": prompt_artifact["artifact_id"],
                "input_artifact_ids": input_ids,
                "input_hashes": input_hashes,
            })
            self.store.upsert_page_production_state(project_id, page["page_id"], {
                "contract_revision": contract.contract_revision,
                "current_image_run_id": run["image_run_id"],
                "reconstruction_status": "pending",
            })

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
        return {"page_id": page_id, "status": "ready", "reconstruction_manifest_artifact_id": manifest_artifact_id, "deck_revision_id": revision.get("deck_revision_id") if revision else None}

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
        existing = next((item for item in self.store.list_deck_revisions(project_id) if item.get("source_session_id") == plan.get("session_id") and item.get("status") == "ready"), None)
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
        if state and state.get("reconstruction_status") == "ready" and state.get("reconstruction_manifest_id"):
            existing_manifest = self.store.get_reconstruction_manifest(project_id, str(state["reconstruction_manifest_id"]))
            if existing_manifest and existing_manifest.get("artifact_id"):
                return str(existing_manifest["artifact_id"])

        svg = self._render_contract_svg(project_id, contract, self._contract_body(contract), int(page["order_index"]) + 1)
        svg_artifact = self._record_artifact(project_id, "svg", svg, "image/svg+xml")
        with tempfile.TemporaryDirectory(prefix="fastppt-reconstruction-") as temp_name:
            svg_path = Path(temp_name) / "page.svg"
            pptx_path = Path(temp_name) / "page.pptx"
            svg_path.write_bytes(svg)
            conversion = self.adapter.convert(ConversionRequest((svg_path,), pptx_path, f"reconstruct-{page['page_id']}"))
            pptx_artifact = self._record_artifact(project_id, "reconstruction_pptx", pptx_path.read_bytes(), "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        qa_report = {
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
            "full_slide_raster": False,
            "unconfirmed_text": False,
            "status": "passed",
        }
        qa_artifact = self._record_artifact(project_id, "reconstruction_qa", json.dumps(qa_report, ensure_ascii=False, sort_keys=True).encode("utf-8"), "application/json")
        created_version = self.store.create_page_version(project_id, page["page_id"], {
            "operation_id": page.get("operation_id"),
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "quick_preview_artifact_id": page.get("quick_preview_artifact_id"),
            "visual_preview_artifact_id": visual_artifact_id,
            "svg_artifact_id": svg_artifact["artifact_id"],
            "editable_level": "native_structure",
            "status": "ready",
            "qa": qa_report,
        })
        if not created_version:
            raise ConflictError("Reconstruction could not create an editable page version")
        version_id = created_version["version_id"]
        page_width = float(contract.page_size.get("width", 13.333))
        page_height = float(contract.page_size.get("height", 7.5))
        page_unit = str(contract.page_size.get("unit", "inch"))
        objects = [
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
        source_manifest_id = None
        if page.get("operation_id"):
            plan = self.store.get_plan(project_id, page["operation_id"])
            session = self.store.get_work_session(project_id, plan["session_id"]) if plan and plan.get("session_id") else None
            for document_id in session.get("source_document_ids", []) if session else []:
                import_manifest = self.store.get_pptx_import_manifest(project_id, document_id)
                if import_manifest:
                    source_manifest_id = import_manifest["manifest_id"]
                    break
        manifest_values: dict[str, Any] = {
            "page_id": page["page_id"],
            "version_id": version_id,
            "page_contract_artifact_id": page["page_contract_artifact_id"],
            "visual_approval_id": approval["visual_approval_id"],
            "source_import_manifest_id": source_manifest_id,
            "objects": objects,
            "unresolved_items": [],
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
                contract_revision=1,
                content_blocks=({"block_id": f"block_{page_id}_body", "kind": "paragraph", "content": {"text": str(draft.get("body", ""))}, "source_hashes": list(str(value) for value in draft.get("source_hashes", []))},),
                speaker_notes=str(draft.get("speaker_notes") or ""),
                page_size={"width": float(draft.get("page_width", 13.333)), "height": float(draft.get("page_height", 7.5)), "unit": str(draft.get("page_unit", "inch"))},
                font_policy={"zh_family": str(draft.get("zh_font") or "Microsoft YaHei"), "latin_family": str(draft.get("latin_font") or "Arial"), "fallback_families": list(draft.get("font_fallbacks") or [])},
                template_artifact_ids=tuple(str(value) for value in draft.get("template_artifact_ids", [])),
            )
            validate_page_contract(contract.to_dict())
            contract_content = json.dumps(contract.to_dict(), ensure_ascii=False, indent=2, default=str).encode("utf-8")
            contract_artifact = self._record_artifact(project_id, "contract", contract_content, "application/json")
            page_writer_run = self._record_stage_agent_run(owner_id, project_id, role="page_writer", session_id=None, input_artifact_ids=[contract_artifact["artifact_id"]], summary={"page_id": page_id, "contract_revision": contract.contract_revision})
            self._record_stage_agent_run(owner_id, project_id, role="visual_director", session_id=None, parent_run_id=page_writer_run["agent_run_id"], input_artifact_ids=[contract_artifact["artifact_id"]], summary={"page_id": page_id, "layout_intent": contract.layout_intent, "image_required": bool(contract.image_artifact_ids)})
            svg = self._render_contract_svg(project_id, contract, str(draft.get("body", "")), offset + 1)
            quick_artifact = self._record_artifact(project_id, "quick_preview", svg, "image/svg+xml")
            visual_artifact = None
            if create_visual_reference:
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
                    "visual_preview_artifact_id": visual_artifact["artifact_id"] if visual_artifact else None,
                    "svg_artifact_id": svg_artifact["artifact_id"] if svg_artifact else None,
                    "editable_level": "visual" if preview_only else "native_structure",
                    "status": ("previewing" if preview_only else "ready") if visual_artifact else "awaiting_visual_generation",
                    "qa": {"quick_preview": "available", "visual_preview": "available" if visual_artifact else "pending", "visual_preview_media_type": "image/png" if visual_artifact else None, "representative": preview_only, "authoritative_render": "pending" if self.settings.render_backend == "powerpoint" else "unavailable", "render_status": "degraded" if self.settings.render_backend == "unavailable" else "pending", "full_slide_raster": False},
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
                planner = self._record_stage_agent_run(owner_id, project_id, role="reconstruction_planner", session_id=None, input_artifact_ids=[page["page_contract_artifact_id"], page["visual_preview_artifact_id"]], summary={"page_id": page["page_id"], "objects": ["background", "text", "shape"]})
                self._record_stage_agent_run(owner_id, project_id, role="qa_reviewer", session_id=None, parent_run_id=planner["agent_run_id"], input_artifact_ids=[svg_artifact["artifact_id"]], summary={"page_id": page["page_id"], "status": "passed", "full_slide_raster": False})
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
                    contract_revision=contract.contract_revision + 1,
                    content_blocks=({"block_id": f"block_{contract.page_id}_body", "kind": "paragraph", "content": {"text": body}, "source_hashes": list(contract.source_hashes)},),
                    speaker_notes=contract.speaker_notes,
                    page_size=contract.page_size,
                    font_policy=contract.font_policy,
                    template_artifact_ids=contract.template_artifact_ids,
                )
                validate_page_contract(revised.to_dict())
                contract_artifact = self._record_artifact(project_id, "contract", json.dumps(revised.to_dict(), ensure_ascii=False, indent=2, default=str).encode("utf-8"), "application/json")
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
