"""Resolve registered artifacts into bounded, role-scoped provider context."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Callable

from fastppt_core.documents import parse_document
from fastppt_core.prompting import (
    ContextBundle,
    PROTECTED_CONTEXT_KEYS,
    ROLE_CONTRACTS,
    PromptEnvelope,
    TrustLabel,
    canonical_json,
    estimate_tokens,
    provider_prompt,
)


@dataclass(frozen=True, slots=True)
class ResolvedPrompt:
    envelope: PromptEnvelope
    provider_prompt: str
    context_bundle: ContextBundle
    context_manifest: dict[str, Any]
    truncation_summary: dict[str, Any] | None


class ContextResolver:
    """The only path from Artifact IDs to content sent to an Agent provider."""

    def __init__(self, store: Any, artifact_bytes: Callable[[str, str], bytes]) -> None:
        self.store = store
        self.artifact_bytes = artifact_bytes

    @staticmethod
    def _artifact_context_key(kind: str, media_type: str, role: str) -> str:
        if kind in {"source", "source_text", "source_chunk"}:
            return "source_documents"
        if kind == "page_draft":
            return "page_drafts"
        if kind in {"contract", "contract_candidate"}:
            return "page_contracts"
        if kind == "agent_output":
            return "parent_outputs"
        if kind == "reconstruction_manifest":
            return "reconstruction_manifest"
        if kind.endswith("qa") or kind == "reconstruction_qa_candidate":
            return "qa_results"
        if kind == "visual_preview" and role == "reconstruction_planner":
            return "approved_visual"
        if kind in {"svg", "reconstruction_pptx", "quick_preview", "visual_preview"}:
            return "render_metadata"
        if media_type.startswith("image/"):
            return "image_metadata"
        return "source_metadata"

    @staticmethod
    def _trust_label(kind: str) -> str:
        if kind in {"source", "source_text", "source_chunk"}:
            return TrustLabel.SOURCE_CONTENT.value
        if kind == "agent_output":
            return TrustLabel.MODEL_OUTPUT.value
        return TrustLabel.REGISTERED_ASSET.value

    def _decode_artifact(self, project_id: str, artifact: dict[str, Any]) -> Any:
        content = self.artifact_bytes(project_id, artifact["artifact_id"])
        media_type = str(artifact.get("media_type") or "")
        if media_type == "application/json" or media_type.endswith("+json"):
            try:
                return json.loads(content.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return {"invalid_json": True, "sha256": artifact["sha256"]}
        if media_type.startswith("text/"):
            return content.decode("utf-8", errors="replace")
        if artifact.get("kind") == "source":
            document = next((item for item in self.store.list_documents(project_id) if item.get("artifact_id") == artifact["artifact_id"]), None)
            if document:
                try:
                    return parse_document(document["file_name"], content).text
                except Exception:
                    return {"file_name": document["file_name"], "sha256": artifact["sha256"], "parse_unavailable": True}
        return {
            "artifact_id": artifact["artifact_id"],
            "kind": artifact.get("kind"),
            "media_type": media_type,
            "sha256": artifact["sha256"],
            "size_bytes": artifact["size_bytes"],
        }

    @staticmethod
    def _truncate_value(value: Any, token_limit: int) -> tuple[Any, int]:
        if estimate_tokens(value) <= token_limit:
            return value, estimate_tokens(value)
        if token_limit <= 0:
            return {}, 0
        serialized = canonical_json(value)
        # The fallback estimate uses 3.5 UTF-8 bytes/token. Shrink until the
        # wrapper itself also fits; a minimum byte slice can exceed tiny budgets.
        retained = serialized.encode("utf-8")[: max(1, int(token_limit * 3.2))].decode("utf-8", errors="ignore")
        bounded = {"summary": retained, "truncated": True}
        while retained and estimate_tokens(bounded) > token_limit:
            if len(retained) == 1:
                break
            retained = retained[: max(1, len(retained) // 2)]
            bounded = {"summary": retained, "truncated": True}
        if estimate_tokens(bounded) > token_limit:
            return {}, 0
        return bounded, estimate_tokens(bounded)

    def resolve(
        self,
        *,
        project_id: str,
        role: str,
        task_id: str,
        session_id: str | None,
        parent_run_id: str | None,
        input_artifact_ids: list[str],
        user_prompt: str,
        output_schema: dict[str, Any],
        provider_snapshot: dict[str, Any],
        explicit_context: dict[str, Any] | None = None,
    ) -> ResolvedPrompt:
        if role not in ROLE_CONTRACTS:
            raise ValueError(f"Unknown Agent role: {role}")
        contract = ROLE_CONTRACTS[role]
        context: dict[str, Any] = {}
        hashes: list[str] = []
        labels: list[str] = []
        manifest_items: list[dict[str, Any]] = []
        unknown_keys: list[str] = []

        for artifact_id in input_artifact_ids:
            artifact = self.store.get_artifact(project_id, artifact_id)
            if not artifact:
                raise ValueError("Agent context references an unavailable or cross-project Artifact")
            key = self._artifact_context_key(str(artifact.get("kind") or ""), str(artifact.get("media_type") or ""), role)
            label = self._trust_label(str(artifact.get("kind") or ""))
            hashes.append("sha256:" + artifact["sha256"])
            labels.append(label)
            item = {
                "artifact_id": artifact_id,
                "sha256": "sha256:" + artifact["sha256"],
                "kind": artifact.get("kind"),
                "media_type": artifact.get("media_type"),
                "trust_label": label,
                "context_key": key,
            }
            if key in contract.allowed_context_keys:
                context.setdefault(key, []).append(self._decode_artifact(project_id, artifact))
                item["included"] = True
            else:
                item["included"] = False
                item["reason"] = "role_not_allowed"
            manifest_items.append(item)

        if parent_run_id:
            parent = self.store.get_agent_run(project_id, parent_run_id)
            if not parent:
                raise ValueError("Agent parent run is unavailable or belongs to another project")
            parent_ids = [str(item) for item in parent.get("output_artifact_ids") or []]
            for artifact_id in parent_ids:
                if artifact_id not in input_artifact_ids and "parent_outputs" in contract.allowed_context_keys:
                    artifact = self.store.get_artifact(project_id, artifact_id)
                    if not artifact:
                        raise ValueError("Parent output Artifact is unavailable")
                    hashes.append("sha256:" + artifact["sha256"])
                    labels.append(TrustLabel.MODEL_OUTPUT.value)
                    context.setdefault("parent_outputs", []).append(self._decode_artifact(project_id, artifact))
                    input_artifact_ids.append(artifact_id)
                    manifest_items.append({
                        "artifact_id": artifact_id,
                        "sha256": "sha256:" + artifact["sha256"],
                        "kind": artifact.get("kind"),
                        "media_type": artifact.get("media_type"),
                        "trust_label": TrustLabel.MODEL_OUTPUT.value,
                        "context_key": "parent_outputs",
                        "included": True,
                        "parent_output": True,
                    })

        for key, value in (explicit_context or {}).items():
            if key in contract.allowed_context_keys:
                context[key] = value
            else:
                unknown_keys.append(key)

        bundle = ContextBundle.create(role=role, values=context, unknown_context_keys=unknown_keys)
        context = bundle.to_rendered_context()
        original_tokens = estimate_tokens({"context": context, "prompt": user_prompt, "schema": output_schema})
        original_context_tokens = estimate_tokens(context)
        long_context = original_tokens >= 100_000
        # Keep the context strictly inside the role contract.  A minimum
        # provider chunk size would silently exceed tiny test or custom
        # budgets, so an exhausted budget is represented as zero and optional
        # fields are dropped while protected fields still fail closed.
        available = max(0, contract.token_budget - estimate_tokens({"prompt": user_prompt, "schema": output_schema}))
        retained_tokens = 0
        dropped_fields: list[str] = []
        summarized_fields: list[str] = []
        field_reports: list[dict[str, Any]] = []
        summary_records: list[dict[str, Any]] = []
        rendered: dict[str, Any] = {}
        for key in sorted(context, key=lambda item: (item not in PROTECTED_CONTEXT_KEYS, item)):
            value = context[key]
            tokens = estimate_tokens(value)
            if key in PROTECTED_CONTEXT_KEYS:
                rendered[key] = value
                retained_tokens += tokens
                continue
            remaining = available - retained_tokens
            if remaining <= 0:
                dropped_fields.append(key)
                serialized = canonical_json(value)
                field_reports.append({
                    "field": key,
                    "action": "dropped",
                    "reason": "role_context_budget_exhausted",
                    "original_length_chars": len(serialized),
                    "original_length_bytes": len(serialized.encode("utf-8")),
                    "retained_length_chars": 0,
                    "retained_length_bytes": 0,
                    "original_estimated_tokens": tokens,
                    "retained_estimated_tokens": 0,
                })
                summary_records.append({
                    "field": key,
                    "action": "dropped",
                    "reason": "role_context_budget_exhausted",
                    "original_digest": "sha256:" + hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
                    "retained_summary": None,
                })
                continue
            bounded, kept = self._truncate_value(value, remaining)
            rendered[key] = bounded
            retained_tokens += kept
            if kept < tokens:
                summarized_fields.append(key)
                original_serialized = canonical_json(value)
                retained_serialized = canonical_json(bounded)
                field_reports.append({
                    "field": key,
                    "action": "summarized",
                    "reason": "role_context_budget",
                    "original_length_chars": len(original_serialized),
                    "original_length_bytes": len(original_serialized.encode("utf-8")),
                    "retained_length_chars": len(retained_serialized),
                    "retained_length_bytes": len(retained_serialized.encode("utf-8")),
                    "original_estimated_tokens": tokens,
                    "retained_estimated_tokens": kept,
                })
                summary_records.append({
                    "field": key,
                    "action": "summarized",
                    "reason": "role_context_budget",
                    "original_digest": "sha256:" + hashlib.sha256(original_serialized.encode("utf-8")).hexdigest(),
                    "retained_summary": bounded,
                })

        if retained_tokens > available:
            # Protected data is never silently removed. The provider call must
            # be split upstream instead of sending an over-budget prompt.
            if any(key in rendered for key in PROTECTED_CONTEXT_KEYS):
                raise ValueError("Protected context exceeds the role token budget and requires hierarchical processing")
            raise ValueError("Context exceeds the role token budget after truncation")
        rendered_serialized = canonical_json(rendered)
        original_serialized = canonical_json(context)
        truncation = {
            "algorithm": "utf8_bytes_div_3.2_bounded:v2",
            "long_context": long_context,
            "threshold_tokens": 100_000,
            "budget_tokens": contract.token_budget,
            "original_estimated_tokens": original_tokens,
            "retained_estimated_tokens": retained_tokens,
            "original_context_estimated_tokens": original_context_tokens,
            "retained_context_estimated_tokens": retained_tokens,
            "original_length_chars": len(original_serialized),
            "original_length_bytes": len(original_serialized.encode("utf-8")),
            "retained_length_chars": len(rendered_serialized),
            "retained_length_bytes": len(rendered_serialized.encode("utf-8")),
            "dropped_fields": dropped_fields,
            "summarized_fields": summarized_fields,
            "field_reports": field_reports,
            "truncation_reason": "role_context_budget" if field_reports else None,
            "summary_artifact_id": None,
            "unknown_context_keys": sorted(unknown_keys),
            "protected_keys": sorted(PROTECTED_CONTEXT_KEYS.intersection(rendered)),
        }
        envelope = PromptEnvelope.create(
            role=role,
            task_id=task_id,
            session_id=session_id,
            parent_run_id=parent_run_id,
            user_prompt=user_prompt,
            rendered_context=rendered,
            input_artifact_ids=input_artifact_ids,
            input_artifact_hashes=hashes,
            input_trust_labels=labels,
            output_schema=output_schema,
            token_budget={"max_context_tokens": contract.token_budget, "estimator": "utf8_bytes_div_3.5:v1"},
            truncation_report=truncation,
            provider_snapshot=provider_snapshot,
        )
        manifest = {
            "role": role,
            "task_id": task_id,
            "allowed_context_keys": sorted(contract.allowed_context_keys),
            "context_bundle": bundle.to_manifest(),
            "artifacts": manifest_items,
            "unknown_context_keys": sorted(unknown_keys),
            "input_context_digest": envelope.input_context_digest,
        }
        truncation_summary = None
        if summary_records:
            truncation_summary = {
                "schema_version": envelope.input_contract_version,
                "role": role,
                "task_id": task_id,
                "algorithm": truncation["algorithm"],
                "records": summary_records,
            }
        return ResolvedPrompt(
            envelope=envelope,
            provider_prompt=provider_prompt(envelope.to_dict()),
            context_bundle=bundle,
            context_manifest=manifest,
            truncation_summary=truncation_summary,
        )
