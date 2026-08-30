"""StylePack and TemplatePack manifest contracts."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping


PACK_FIELDS = (
    "color_palette",
    "typography",
    "density",
    "visual_language",
    "layout_blueprints",
    "image_treatment",
    "rendering_constraints",
    "prompt_fragments",
    "supported_page_types",
    "asset_ids",
)
CAPABILITY_STATES = frozenset({"applied", "reference_only", "reserved_not_applied", "rejected"})
_PACK_ID = re.compile(r"^pack_[A-Za-z0-9][A-Za-z0-9._-]{2,119}$")
_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_SENSITIVE_FRAGMENT = re.compile(
    r"(?:api[_-]?key|authorization\s*:|bearer\s+[A-Za-z0-9._-]+|secret_reference|ignore\s+(?:all\s+)?previous|system\s+prompt|(?:powershell|cmd\.exe|bash|sh)\s|https?://)",
    re.IGNORECASE,
)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def pack_content_hash(manifest: Mapping[str, Any], resource_hashes: Mapping[str, str]) -> str:
    normalized = dict(manifest)
    normalized["content_hash"] = ""
    normalized["scope"] = "private"
    normalized["owner_id"] = ""
    normalized["manifest_artifact_id"] = ""
    payload = {"manifest": normalized, "resources": dict(sorted(resource_hashes.items()))}
    return "sha256:" + hashlib.sha256(canonical_json(payload)).hexdigest()


def bundle_content_hash(manifest: Mapping[str, Any]) -> str:
    normalized = dict(manifest)
    normalized["content_hash"] = ""
    return "sha256:" + hashlib.sha256(canonical_json(normalized)).hexdigest()


def validate_pack_manifest(
    payload: Mapping[str, Any],
    *,
    owner_id: str,
    expected_kind: str | None = None,
    expected_hash: str | None = None,
) -> dict[str, Any]:
    required = {
        "schema_version", "pack_id", "pack_kind", "display_name", "description", "version",
        "status", "scope", "owner_id", "license", "manifest_artifact_id", "content_hash", "preview_artifact_ids", "capability_matrix",
        *PACK_FIELDS,
    }
    missing = sorted(required.difference(payload))
    if missing:
        raise ValueError("Pack Manifest is missing: " + ", ".join(missing))
    if payload.get("schema_version") != "1.0":
        raise ValueError("Pack schema_version must be 1.0")
    pack_id = str(payload.get("pack_id") or "")
    if not _PACK_ID.fullmatch(pack_id):
        raise ValueError("pack_id is invalid")
    pack_kind = str(payload.get("pack_kind") or "")
    if pack_kind not in {"style", "template"} or expected_kind and pack_kind != expected_kind:
        raise ValueError("pack_kind is invalid")
    version = str(payload.get("version") or "").strip()
    if not version or len(version) > 80:
        raise ValueError("Pack version is invalid")
    display_name = str(payload.get("display_name") or "").strip()
    if not display_name or len(display_name) > 160:
        raise ValueError("Pack display_name is invalid")
    if payload.get("status") not in {"active", "archived", "invalid"}:
        raise ValueError("Pack status is invalid")
    content_hash = str(payload.get("content_hash") or "")
    if not _HASH.fullmatch(content_hash) or expected_hash and content_hash != expected_hash:
        raise ValueError("Pack content_hash is invalid or does not match the Bundle")
    matrix = payload.get("capability_matrix")
    if not isinstance(matrix, Mapping):
        raise ValueError("capability_matrix must be an object")
    for field in PACK_FIELDS:
        if matrix.get(field) not in CAPABILITY_STATES:
            raise ValueError(f"capability_matrix.{field} must declare a v1.2.0 capability state")
    if matrix.get("prompt_fragments") == "applied":
        raise ValueError("prompt_fragments cannot override v1.2.0 system prompts")
    fragments = payload.get("prompt_fragments")
    if not isinstance(fragments, list) or any(not isinstance(item, str) for item in fragments):
        raise ValueError("prompt_fragments must be an array of strings")
    if any(_SENSITIVE_FRAGMENT.search(item) for item in fragments):
        raise ValueError("prompt_fragments contains credentials, provider configuration, or instruction injection")
    for field in ("preview_artifact_ids", "layout_blueprints", "rendering_constraints", "supported_page_types", "asset_ids"):
        if not isinstance(payload.get(field), list):
            raise ValueError(f"{field} must be an array")
    if any(not isinstance(item, str) or not item.strip() for item in payload.get("preview_artifact_ids", [])):
        raise ValueError("preview_artifact_ids must contain non-empty resource IDs")
    if any(not isinstance(item, str) or not item.strip() for item in payload.get("asset_ids", [])):
        raise ValueError("asset_ids must contain non-empty resource IDs")
    for field in ("color_palette", "typography", "density", "visual_language", "image_treatment"):
        if not isinstance(payload.get(field), Mapping):
            raise ValueError(f"{field} must be an object")
    clean = dict(payload)
    clean.update({
        "pack_id": pack_id,
        "pack_kind": pack_kind,
        "display_name": display_name,
        "version": version,
        "scope": "private",
        "owner_id": owner_id,
        "content_hash": content_hash,
    })
    return clean


def design_snapshot(style: Mapping[str, Any] | None, template: Mapping[str, Any] | None) -> dict[str, Any]:
    packs = [item for item in (style, template) if item]
    applied: dict[str, Any] = {}
    matrix: dict[str, str] = {}
    for pack in packs:
        manifest = dict(pack.get("manifest") or {})
        capability = dict(manifest.get("capability_matrix") or {})
        for field in PACK_FIELDS:
            status = capability.get(field, "reserved_not_applied")
            matrix[f"{pack['pack_id']}:{field}"] = status
            if status == "applied" and field != "prompt_fragments":
                applied[f"{pack['pack_kind']}:{field}"] = manifest.get(field)
    return {
        "style_pack_id": style.get("pack_id") if style else None,
        "style_display_name": style.get("display_name") if style else None,
        "style_version": (style.get("version") or style.get("current_version")) if style else None,
        "style_content_hash": style.get("content_hash") if style else None,
        "template_pack_id": template.get("pack_id") if template else None,
        "template_display_name": template.get("display_name") if template else None,
        "template_version": (template.get("version") or template.get("current_version")) if template else None,
        "template_content_hash": template.get("content_hash") if template else None,
        "selection_source": "private" if any(item.get("scope") == "private" for item in packs) else ("system" if packs else "none"),
        "capability_matrix": matrix,
        "applied_constraints": applied,
    }
