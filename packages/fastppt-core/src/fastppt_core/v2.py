"""FastPPT v2 contracts and deterministic design compilation primitives.

The v2 layer is deliberately independent from Runtime, storage and the
ppt-master kernel.  It accepts JSON-like mappings, validates them fail closed,
and returns immutable snapshots/IR values that can be persisted by callers.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
import hashlib
import json
import re
from types import MappingProxyType
from typing import Any, Mapping, Sequence


V2_SCHEMA_VERSION = "2.0.0"
V2_COMPILER_VERSION = "2.0.0"
V2_MODES = frozenset({"none_none", "style_only", "template_only", "style_template"})
# Capabilities are intentionally enumerated so readers fail closed when a
# producer requires a feature this version does not understand.
KNOWN_V2_CAPABILITIES = frozenset(
    {
        "style_tokens",
        "template_skeleton",
        "template_capacity",
        "protected_assets",
        "page_contract",
        "fact_bindings",
        "native_objects",
        "structured_editable",
        "text_editable",
        "visual_only",
        "svg_regions",
        "svg_qa",
        "pptx_export",
        "pptx_static_qa",
        "powerpoint_render",
        "authoritative_render",
        "artifact_store",
        "recovery",
        "export",
        "image_artifact",
        "connector_objects",
        "chart_objects",
        "table_objects",
    }
)


class V2EditableLevel(StrEnum):
    VISUAL_ONLY = "visual_only"
    TEXT_EDITABLE = "text_editable"
    STRUCTURED_EDITABLE = "structured_editable"
    NATIVE_FULL = "native_full"
_HASH = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{2,119}$")


class V2ContractError(ValueError):
    """A v2 contract is invalid and must not be persisted."""


class DesignConfirmationRequired(V2ContractError):
    code = "DESIGN_CONFIRMATION_REQUIRED"


class TemplateCapacityExceeded(V2ContractError):
    code = "TEMPLATE_CAPACITY_EXCEEDED"


class ProtectedAssetConflict(V2ContractError):
    code = "PROTECTED_ASSET_CONFLICT"


class PackageHashMismatch(V2ContractError):
    code = "PACKAGE_HASH_MISMATCH"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def sha256_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value)).hexdigest()


def _copy(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _copy(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_copy(child) for child in value]
    return value


def _required_common(payload: Mapping[str, Any], *, name: str) -> None:
    if payload.get("schema_version") != V2_SCHEMA_VERSION:
        raise V2ContractError(f"{name}.schema_version must be {V2_SCHEMA_VERSION}")
    required_capabilities = payload.get("required_capabilities")
    if not isinstance(required_capabilities, list) or any(not isinstance(item, str) or not item for item in required_capabilities):
        raise V2ContractError(f"{name}.required_capabilities must be an array of strings")
    content_hash = str(payload.get("content_hash") or "")
    if not _HASH.fullmatch(content_hash):
        raise V2ContractError(f"{name}.content_hash must be a sha256 hash")
    unknown = sorted(set(required_capabilities).difference(KNOWN_V2_CAPABILITIES))
    if unknown:
        raise V2ContractError(f"{name}.required_capabilities contains unknown capabilities: {', '.join(unknown)}")


def _hash_without_content_hash(payload: Mapping[str, Any]) -> str:
    value = _copy(payload)
    value["content_hash"] = ""
    return sha256_json(value)


@dataclass(frozen=True, slots=True)
class StylePackageManifest:
    style_id: str
    version: str
    source: str
    license: str
    tokens: Mapping[str, Any]
    capability_matrix: Mapping[str, str]
    content_hash: str
    required_capabilities: tuple[str, ...] = ()
    transformation_record: tuple[Mapping[str, Any], ...] = ()
    display_name: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)
    schema_version: str = V2_SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        payload = {
            **_copy(self.extra),
            "schema_version": self.schema_version,
            "style_id": self.style_id,
            "version": self.version,
            "source": self.source,
            "license": self.license,
            "transformation_record": _copy(self.transformation_record),
            "tokens": _copy(self.tokens),
            "capability_matrix": _copy(self.capability_matrix),
            "required_capabilities": list(self.required_capabilities),
            "content_hash": self.content_hash,
        }
        if self.display_name:
            payload["display_name"] = self.display_name
        return payload

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "StylePackageManifest":
        _required_common(payload, name="StylePackageManifest@2")
        required = ("style_id", "version", "source", "license", "transformation_record", "tokens", "capability_matrix")
        missing = [key for key in required if key not in payload]
        if missing:
            raise V2ContractError("StylePackageManifest@2 missing: " + ", ".join(missing))
        style_id = str(payload["style_id"])
        if not _ID.fullmatch(style_id):
            raise V2ContractError("style_id is invalid")
        version = str(payload["version"]).strip()
        if not version:
            raise V2ContractError("style version is required")
        if not isinstance(payload["tokens"], Mapping) or not isinstance(payload["capability_matrix"], Mapping):
            raise V2ContractError("style tokens and capability_matrix must be objects")
        if not isinstance(payload["transformation_record"], list):
            raise V2ContractError("transformation_record must be an array")
        content_hash = str(payload["content_hash"])
        if verify_hash and content_hash != _hash_without_content_hash(payload):
            raise PackageHashMismatch("StylePackageManifest content hash does not match bytes")
        known = {"schema_version", "style_id", "version", "source", "license", "transformation_record", "tokens", "capability_matrix", "required_capabilities", "content_hash", "display_name"}
        return cls(
            style_id=style_id,
            version=version,
            source=str(payload["source"]),
            license=str(payload["license"]),
            transformation_record=tuple(_copy(payload["transformation_record"])),
            tokens=MappingProxyType(_copy(payload["tokens"])),
            capability_matrix=MappingProxyType(_copy(payload["capability_matrix"])),
            required_capabilities=tuple(str(item) for item in payload["required_capabilities"]),
            content_hash=content_hash,
            display_name=str(payload.get("display_name") or ""),
            extra=MappingProxyType({str(key): _copy(value) for key, value in payload.items() if key not in known}),
        )


@dataclass(frozen=True, slots=True)
class TemplatePackageManifest:
    template_id: str
    version: str
    source_format: str
    mode: str
    license: str
    skeleton_ref: str
    layouts: tuple[Mapping[str, Any], ...]
    capacity: Mapping[str, Any]
    protected_assets: tuple[Mapping[str, Any], ...]
    content_hash: str
    required_capabilities: tuple[str, ...] = ()
    source: str = ""
    display_name: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)
    schema_version: str = V2_SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            **_copy(self.extra),
            "schema_version": self.schema_version,
            "template_id": self.template_id,
            "version": self.version,
            "source_format": self.source_format,
            "mode": self.mode,
            "license": self.license,
            "source": self.source,
            "skeleton_ref": self.skeleton_ref,
            "layouts": _copy(self.layouts),
            "capacity": _copy(self.capacity),
            "protected_assets": _copy(self.protected_assets),
            "required_capabilities": list(self.required_capabilities),
            "content_hash": self.content_hash,
            **({"display_name": self.display_name} if self.display_name else {}),
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "TemplatePackageManifest":
        _required_common(payload, name="TemplatePackageManifest@2")
        required = ("template_id", "version", "source_format", "mode", "license", "skeleton_ref", "layouts", "capacity", "protected_assets")
        missing = [key for key in required if key not in payload]
        if missing:
            raise V2ContractError("TemplatePackageManifest@2 missing: " + ", ".join(missing))
        template_id = str(payload["template_id"])
        if not _ID.fullmatch(template_id):
            raise V2ContractError("template_id is invalid")
        source_format = str(payload["source_format"]).lower()
        if source_format not in {".pptx", ".potx", "pptx", "potx"}:
            raise V2ContractError("template source_format must be .pptx or .potx")
        if not isinstance(payload["layouts"], list) or not isinstance(payload["capacity"], Mapping) or not isinstance(payload["protected_assets"], list):
            raise V2ContractError("template layouts/capacity/protected_assets have invalid types")
        content_hash = str(payload["content_hash"])
        if verify_hash and content_hash != _hash_without_content_hash(payload):
            raise PackageHashMismatch("TemplatePackageManifest content hash does not match bytes")
        known = {"schema_version", "template_id", "version", "source_format", "mode", "license", "source", "skeleton_ref", "layouts", "capacity", "protected_assets", "required_capabilities", "content_hash", "display_name"}
        return cls(
            template_id=template_id,
            version=str(payload["version"]),
            source_format=source_format,
            mode=str(payload["mode"]),
            license=str(payload["license"]),
            source=str(payload.get("source") or ""),
            skeleton_ref=str(payload["skeleton_ref"]),
            layouts=tuple(_copy(payload["layouts"])),
            capacity=MappingProxyType(_copy(payload["capacity"])),
            protected_assets=tuple(_copy(payload["protected_assets"])),
            required_capabilities=tuple(str(item) for item in payload["required_capabilities"]),
            content_hash=content_hash,
            display_name=str(payload.get("display_name") or ""),
            extra=MappingProxyType({str(key): _copy(value) for key, value in payload.items() if key not in known}),
        )


@dataclass(frozen=True, slots=True)
class PageContractV2:
    page_id: str
    page_type: str
    facts: tuple[Mapping[str, Any], ...]
    text: tuple[str, ...]
    content_blocks: tuple[Mapping[str, Any], ...]
    relations: tuple[Mapping[str, Any], ...] = ()
    datasets: tuple[Mapping[str, Any], ...] = ()
    prohibited_changes: tuple[str, ...] = ()
    content_hash: str = ""
    required_capabilities: tuple[str, ...] = ()
    schema_version: str = V2_SCHEMA_VERSION
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self, *, include_hash: bool = True) -> dict[str, Any]:
        payload = {
            **_copy(self.extra),
            "schema_version": self.schema_version,
            "page_id": self.page_id,
            "page_type": self.page_type,
            "facts": _copy(self.facts),
            "text": list(self.text),
            "content_blocks": _copy(self.content_blocks),
            "relations": _copy(self.relations),
            "datasets": _copy(self.datasets),
            "prohibited_changes": list(self.prohibited_changes),
            "required_capabilities": list(self.required_capabilities),
            "content_hash": self.content_hash if include_hash else "",
        }
        return payload

    def calculated_hash(self) -> str:
        return sha256_json(self.to_dict(include_hash=False))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "PageContractV2":
        _required_common(payload, name="PageContract@2")
        required = ("page_id", "page_type", "facts", "text", "content_blocks", "relations", "datasets", "prohibited_changes")
        missing = [key for key in required if key not in payload]
        if missing:
            raise V2ContractError("PageContract@2 missing: " + ", ".join(missing))
        if not _ID.fullmatch(str(payload["page_id"])):
            raise V2ContractError("page_id is invalid")
        if not isinstance(payload["facts"], list) or not isinstance(payload["text"], list) or any(not isinstance(item, str) for item in payload["text"]):
            raise V2ContractError("facts/text have invalid types")
        for fact in payload["facts"]:
            if not isinstance(fact, Mapping) or not fact.get("fact_id") or "value" not in fact:
                raise V2ContractError("each fact requires fact_id and value")
            fact_id = str(fact["fact_id"])
            if not _ID.fullmatch(fact_id):
                raise V2ContractError("fact_id is invalid")
            source = fact.get("source") if isinstance(fact.get("source"), Mapping) else {}
            source_artifact_id = fact.get("source_artifact_id") or fact.get("source_document_id") or source.get("artifact_id") or source.get("document_id")
            source_locator = fact.get("source_locator") or fact.get("source_location") or fact.get("location") or source.get("locator") or source.get("location")
            if not source_artifact_id or not source_locator:
                raise V2ContractError("each fact requires source artifact and locator")
            source_hash = str(fact.get("source_hash") or "")
            if not _HASH.fullmatch(source_hash):
                raise V2ContractError("each fact requires a sha256 source_hash")
            if not isinstance(fact.get("locked"), bool):
                raise V2ContractError("each fact requires a boolean locked state")
        for field_name in ("content_blocks", "relations", "datasets"):
            if not isinstance(payload[field_name], list):
                raise V2ContractError(f"{field_name} must be an array")
        value = cls(
            page_id=str(payload["page_id"]),
            page_type=str(payload["page_type"]),
            facts=tuple(_copy(payload["facts"])),
            text=tuple(payload["text"]),
            content_blocks=tuple(_copy(payload["content_blocks"])),
            relations=tuple(_copy(payload["relations"])),
            datasets=tuple(_copy(payload["datasets"])),
            prohibited_changes=tuple(str(item) for item in payload["prohibited_changes"]),
            content_hash=str(payload["content_hash"]),
            required_capabilities=tuple(str(item) for item in payload["required_capabilities"]),
            extra=MappingProxyType({str(key): _copy(child) for key, child in payload.items() if key not in {"schema_version", "page_id", "page_type", "facts", "text", "content_blocks", "relations", "datasets", "prohibited_changes", "required_capabilities", "content_hash"}}),
        )
        if verify_hash and value.content_hash != value.calculated_hash():
            raise PackageHashMismatch("PageContract content hash does not match payload")
        return value


@dataclass(frozen=True, slots=True)
class TemplateSkeletonSnapshot:
    snapshot_id: str
    source_artifact_hash: str
    page_width_pt: float
    page_height_pt: float
    theme: Mapping[str, Any]
    masters: tuple[Mapping[str, Any], ...]
    layouts: tuple[Mapping[str, Any], ...]
    placeholders: tuple[Mapping[str, Any], ...]
    fonts: tuple[str, ...]
    colors: Mapping[str, str]
    backgrounds: tuple[Mapping[str, Any], ...]
    protected_assets: tuple[Mapping[str, Any], ...] = ()
    required_capabilities: tuple[str, ...] = ()
    schema_version: str = V2_SCHEMA_VERSION
    content_hash: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self, *, include_hash: bool = True) -> dict[str, Any]:
        payload = {
            **_copy(self.extra),
            "schema_version": self.schema_version,
            "snapshot_id": self.snapshot_id,
            "source_artifact_hash": self.source_artifact_hash,
            "page_width_pt": self.page_width_pt,
            "page_height_pt": self.page_height_pt,
            "theme": _copy(self.theme),
            "masters": _copy(self.masters),
            "layouts": _copy(self.layouts),
            "placeholders": _copy(self.placeholders),
            "fonts": list(self.fonts),
            "colors": _copy(self.colors),
            "backgrounds": _copy(self.backgrounds),
            "protected_assets": _copy(self.protected_assets),
            "required_capabilities": list(self.required_capabilities),
            "content_hash": self.content_hash if include_hash else "",
        }
        return payload

    def calculated_hash(self) -> str:
        return sha256_json(self.to_dict(include_hash=False))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "TemplateSkeletonSnapshot":
        _required_common(payload, name="TemplateSkeletonSnapshot@2")
        for name in ("masters", "layouts", "placeholders", "fonts", "backgrounds", "protected_assets", "required_capabilities"):
            if not isinstance(payload.get(name), list):
                raise V2ContractError(f"TemplateSkeletonSnapshot.{name} must be an array")
        snapshot_id = str(payload.get("snapshot_id") or "")
        source_artifact_hash = str(payload.get("source_artifact_hash") or "")
        page_width_pt = float(payload.get("page_width_pt") or 0)
        page_height_pt = float(payload.get("page_height_pt") or 0)
        if not _ID.fullmatch(snapshot_id):
            raise V2ContractError("TemplateSkeletonSnapshot.snapshot_id is invalid")
        if not _HASH.fullmatch(source_artifact_hash):
            raise V2ContractError("TemplateSkeletonSnapshot.source_artifact_hash is invalid")
        if page_width_pt <= 0 or page_height_pt <= 0:
            raise V2ContractError("TemplateSkeletonSnapshot page dimensions must be positive")
        if not isinstance(payload.get("theme"), Mapping) or not isinstance(payload.get("colors"), Mapping):
            raise V2ContractError("TemplateSkeletonSnapshot.theme/colors must be objects")
        value = cls(
            snapshot_id=snapshot_id,
            source_artifact_hash=source_artifact_hash,
            page_width_pt=page_width_pt,
            page_height_pt=page_height_pt,
            theme=MappingProxyType(_copy(payload.get("theme") or {})),
            masters=tuple(_copy(payload.get("masters") or [])),
            layouts=tuple(_copy(payload.get("layouts") or [])),
            placeholders=tuple(_copy(payload.get("placeholders") or [])),
            fonts=tuple(str(item) for item in payload.get("fonts") or []),
            colors=MappingProxyType(_copy(payload.get("colors") or {})),
            backgrounds=tuple(_copy(payload.get("backgrounds") or [])),
            protected_assets=tuple(_copy(payload.get("protected_assets") or [])),
            required_capabilities=tuple(str(item) for item in payload.get("required_capabilities") or []),
            content_hash=str(payload.get("content_hash")),
            extra=MappingProxyType({str(key): _copy(child) for key, child in payload.items() if key not in {"schema_version", "snapshot_id", "source_artifact_hash", "page_width_pt", "page_height_pt", "theme", "masters", "layouts", "placeholders", "fonts", "colors", "backgrounds", "protected_assets", "required_capabilities", "content_hash"}}),
        )
        if verify_hash and value.content_hash != value.calculated_hash():
            raise PackageHashMismatch("TemplateSkeletonSnapshot content hash does not match payload")
        return value


@dataclass(frozen=True, slots=True)
class DesignSnapshot:
    mode: str
    style_ref: Mapping[str, Any] | None
    template_ref: Mapping[str, Any] | None
    capability_matrix: Mapping[str, Any]
    overrides: tuple[Mapping[str, Any], ...]
    conflict_results: tuple[Mapping[str, Any], ...]
    preview_artifact_hash: str | None = None
    confirmed_by: str | None = None
    confirmed_at: str | None = None
    compiler_version: str = V2_COMPILER_VERSION
    schema_version: str = V2_SCHEMA_VERSION
    required_capabilities: tuple[str, ...] = ()
    content_hash: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self, *, include_hash: bool = True) -> dict[str, Any]:
        return {
            **_copy(self.extra),
            "schema_version": self.schema_version,
            "mode": self.mode,
            "style_ref": _copy(self.style_ref),
            "template_ref": _copy(self.template_ref),
            "capability_matrix": _copy(self.capability_matrix),
            "overrides": _copy(self.overrides),
            "conflict_results": _copy(self.conflict_results),
            "preview_artifact_hash": self.preview_artifact_hash,
            "confirmed_by": self.confirmed_by,
            "confirmed_at": self.confirmed_at,
            "compiler_version": self.compiler_version,
            "required_capabilities": list(self.required_capabilities),
            "content_hash": self.content_hash if include_hash else "",
        }

    def calculated_hash(self) -> str:
        return sha256_json(self.to_dict(include_hash=False))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "DesignSnapshot":
        _required_common(payload, name="DesignSnapshot@2")
        mode = str(payload.get("mode") or "")
        if mode not in V2_MODES:
            raise V2ContractError("DesignSnapshot.mode is invalid")
        for name in ("overrides", "conflict_results", "required_capabilities"):
            if not isinstance(payload.get(name), list):
                raise V2ContractError(f"DesignSnapshot.{name} must be an array")
        style_ref = _copy(payload.get("style_ref")) if payload.get("style_ref") is not None else None
        template_ref = _copy(payload.get("template_ref")) if payload.get("template_ref") is not None else None
        for kind, ref in (("style", style_ref), ("template", template_ref)):
            if ref is None:
                continue
            if not isinstance(ref, Mapping) or not ref.get("id") or not ref.get("version") or not _HASH.fullmatch(str(ref.get("content_hash") or "")) or not isinstance(ref.get("capability_matrix"), Mapping):
                raise V2ContractError(f"DesignSnapshot.{kind}_ref is invalid")
        preview_hash = str(payload.get("preview_artifact_hash")) if payload.get("preview_artifact_hash") else None
        if preview_hash is not None and not _HASH.fullmatch(preview_hash):
            raise V2ContractError("DesignSnapshot.preview_artifact_hash is invalid")
        if bool(payload.get("confirmed_by")) != bool(payload.get("confirmed_at")):
            raise V2ContractError("DesignSnapshot confirmation requires actor and timestamp together")
        value = cls(
            mode=mode,
            style_ref=style_ref,
            template_ref=template_ref,
            capability_matrix=MappingProxyType(_copy(payload.get("capability_matrix") or {})),
            overrides=tuple(_copy(payload.get("overrides") or [])),
            conflict_results=tuple(_copy(payload.get("conflict_results") or [])),
            preview_artifact_hash=preview_hash,
            confirmed_by=str(payload.get("confirmed_by")) if payload.get("confirmed_by") else None,
            confirmed_at=str(payload.get("confirmed_at")) if payload.get("confirmed_at") else None,
            compiler_version=str(payload.get("compiler_version") or V2_COMPILER_VERSION),
            required_capabilities=tuple(str(item) for item in payload.get("required_capabilities") or []),
            content_hash=str(payload.get("content_hash")),
            extra=MappingProxyType({str(key): _copy(child) for key, child in payload.items() if key not in {"schema_version", "mode", "style_ref", "template_ref", "capability_matrix", "overrides", "conflict_results", "preview_artifact_hash", "confirmed_by", "confirmed_at", "compiler_version", "required_capabilities", "content_hash"}}),
        )
        if verify_hash and value.content_hash != value.calculated_hash():
            raise PackageHashMismatch("DesignSnapshot content hash does not match payload")
        if mode == "style_template" and (value.confirmed_by or value.confirmed_at) and not value.preview_artifact_hash:
            raise V2ContractError("confirmed style_template snapshots require a preview artifact hash")
        if mode != "style_template" and (value.confirmed_by or value.confirmed_at or value.preview_artifact_hash):
            raise V2ContractError("preview confirmation fields are only valid for style_template")
        return value

    def confirm(self, actor_id: str, *, confirmed_at: str | None = None) -> "DesignSnapshot":
        if self.mode != "style_template":
            return self
        if not actor_id:
            raise DesignConfirmationRequired("style_template confirmation requires an actor")
        if not self.preview_artifact_hash:
            raise DesignConfirmationRequired("style_template confirmation requires a preview artifact")
        value = datetime.now(UTC).isoformat() if confirmed_at is None else confirmed_at
        updated = replace(self, confirmed_by=actor_id, confirmed_at=value, content_hash="")
        return replace(updated, content_hash=updated.calculated_hash())


def _ref(package: Mapping[str, Any] | None, *, kind: str) -> dict[str, Any] | None:
    if package is None:
        return None
    key = "style_id" if kind == "style" else "template_id"
    value = {"id": package.get(key), "version": package.get("version"), "content_hash": package.get("content_hash"), "capability_matrix": _copy(package.get("capability_matrix") or {})}
    if not value["id"] or not value["version"] or not _HASH.fullmatch(str(value["content_hash"] or "")):
        raise V2ContractError(f"{kind} reference requires id, version and content_hash")
    return value


def create_design_snapshot(style: Mapping[str, Any] | None = None, template: Mapping[str, Any] | None = None, *, preview_artifact_hash: str | None = None, confirmed_by: str | None = None, confirmed_at: str | None = None, compiler_version: str = V2_COMPILER_VERSION) -> DesignSnapshot:
    mode = "style_template" if style and template else "style_only" if style else "template_only" if template else "none_none"
    if mode == "style_template" and not preview_artifact_hash and not confirmed_by:
        # The initial draft is valid, but generation must stop at confirmation.
        pass
    refs = (_ref(style, kind="style"), _ref(template, kind="template"))
    matrix = {"style": _copy((style or {}).get("capability_matrix") or {}), "template": _copy((template or {}).get("capability_matrix") or {})}
    capabilities = tuple(sorted(set(str(item) for item in (style or {}).get("required_capabilities", ())) | set(str(item) for item in (template or {}).get("required_capabilities", ()))))
    unknown = sorted(set(capabilities).difference(KNOWN_V2_CAPABILITIES))
    if unknown:
        raise V2ContractError("DesignSnapshot requires unknown capabilities: " + ", ".join(unknown))
    if preview_artifact_hash is not None and not _HASH.fullmatch(str(preview_artifact_hash)):
        raise V2ContractError("preview_artifact_hash must be a sha256 hash")
    if mode == "style_template" and bool(confirmed_by) != bool(confirmed_at):
        raise V2ContractError("DesignSnapshot confirmation requires actor and timestamp together")
    if mode == "style_template" and (confirmed_by or confirmed_at) and not preview_artifact_hash:
        raise V2ContractError("confirmed style_template snapshots require a preview artifact hash")
    if mode != "style_template" and (confirmed_by or confirmed_at or preview_artifact_hash):
        raise V2ContractError("preview confirmation fields are only valid for style_template")
    resolved = resolve_design_attributes({}, template, style)
    conflicts = tuple({"attribute_path": item["attribute_path"], "result": item["conflict_result"]} for item in resolved["overrides"] if item["source_type"] in {"style", "template"})
    base = DesignSnapshot(mode, refs[0], refs[1], matrix, tuple(resolved["overrides"]), conflicts, preview_artifact_hash, confirmed_by, confirmed_at, compiler_version, V2_SCHEMA_VERSION, capabilities, "")
    return replace(base, content_hash=base.calculated_hash())


class DesignSelectionStateMachine:
    """Pure state machine for draft/validation/preview/confirmation/active."""

    transitions = {
        "draft": {"validating", "incompatible"},
        "validating": {"ready", "preview_required", "incompatible"},
        "preview_required": {"confirmed", "incompatible"},
        "confirmed": {"active"},
        "ready": {"active"},
        "active": set(),
        "incompatible": set(),
    }

    def __init__(self, mode: str = "none_none", state: str = "draft") -> None:
        if mode not in V2_MODES or state not in self.transitions:
            raise V2ContractError("invalid design mode or state")
        self.mode = mode
        self.state = state

    def transition(self, target: str) -> str:
        # Combined selections must surface the confirmation contract before
        # a caller can treat the draft as ready.
        if target == "ready" and self.mode == "style_template":
            raise DesignConfirmationRequired("style_template requires preview confirmation")
        if target not in self.transitions.get(self.state, set()):
            raise V2ContractError(f"invalid design state transition: {self.state} -> {target}")
        self.state = target
        return self.state

    def validate(self, *, compatible: bool = True) -> str:
        self.transition("validating")
        if not compatible:
            return self.transition("incompatible")
        self.transition("preview_required" if self.mode == "style_template" else "ready")
        return self.state

    def confirm(self) -> str:
        if self.mode != "style_template" or self.state != "preview_required":
            raise DesignConfirmationRequired("only an unconfirmed style_template preview can be confirmed")
        self.transition("confirmed")
        return self.transition("active")


ATTRIBUTE_SOURCES = ("page_contract", "template", "style", "fastppt_qa", "default")
_TEMPLATE_ATTRIBUTES = frozenset({"page_size", "orientation", "master", "layout", "placeholder_geometry", "slot_semantics", "capacity", "required_regions", "forbidden_regions", "logo", "trademark", "page_number", "legal_notice"})
_STYLE_ATTRIBUTES = frozenset({"colors", "theme_colors", "accent_color", "font_family", "font_weight", "font_scale", "background", "whitespace", "density", "image_treatment", "chart_visual", "table_visual"})
_PAGE_CONTRACT_ATTRIBUTES = frozenset({"facts", "text", "content_blocks", "relations", "datasets", "page_id", "page_type", "prohibited_changes", "title", "proposed_changes", "requested_changes"})
_STYLE_TOKEN_CAPABILITIES = {
    "primary": "colors",
    "foreground": "colors",
    "risk": "colors",
    "font_family_zh": "font_family",
}


def resolve_design_attributes(page_contract: Mapping[str, Any], template: Mapping[str, Any] | None, style: Mapping[str, Any] | None, *, qa_defaults: Mapping[str, Any] | None = None, compiler_version: str = V2_COMPILER_VERSION) -> dict[str, Any]:
    """Resolve attributes and retain a machine-readable override ledger."""
    if not isinstance(page_contract, Mapping):
        raise V2ContractError("page_contract must be an object")
    template_values = dict((template or {}).get("attributes") or template or {})
    style_values = dict((style or {}).get("tokens") or style or {})
    capability_matrix = dict((style or {}).get("capability_matrix") or {})
    defaults = {"font_family": "Arial", "font_weight": 400, "font_scale": 1.0, "background": "#FFFFFF", "safe_margin_pt": 12, "min_font_size_pt": 18}
    defaults.update(qa_defaults or {})
    result: dict[str, Any] = {}
    records: list[dict[str, Any]] = []
    protected = {"facts", "text", "content_blocks", "relations", "datasets", "page_id", "page_type"}
    protected_asset_ids = {
        str(asset.get("id") or asset.get("name") or "")
        for asset in (template or {}).get("protected_assets") or []
        if isinstance(asset, Mapping)
    }
    attempted_protected = sorted(protected_asset_ids.intersection(str(key) for key in style_values))
    if attempted_protected:
        raise ProtectedAssetConflict(
            "Style attempts to override protected template assets: " + ", ".join(attempted_protected)
        )
    package_metadata = {"schema_version", "content_hash", "required_capabilities", "style_id", "template_id", "version", "source", "license", "source_format", "mode", "transformation_record", "skeleton_ref", "layouts", "capacity", "protected_assets", "attributes", "tokens", "capability_matrix"}
    keys = (set(defaults) | set(template_values) | set(style_values) | set(page_contract)).difference(package_metadata)
    for key in sorted(keys):
        template_before = template_values.get(key, defaults.get(key))
        if key in protected:
            source, value, before = "page_contract", page_contract.get(key), template_before
        elif key in _TEMPLATE_ATTRIBUTES:
            source, value, before = (("template", template_values[key], defaults.get(key)) if key in template_values else ("default", defaults.get(key), None))
        elif key in _STYLE_ATTRIBUTES:
            # A Style manifest declares which tokens are actually applicable.
            # Reserved or unknown states are deliberately ignored rather than
            # becoming accidental visual overrides.
            style_applied = capability_matrix.get(_STYLE_TOKEN_CAPABILITIES.get(key, key)) == "applied"
            if key in style_values and style_applied:
                source, value, before = "style", style_values[key], template_before
            elif key in template_values:
                source, value, before = "template", template_values[key], defaults.get(key)
            else:
                source, value, before = "default", defaults.get(key), None
        elif key in page_contract:
            source, value, before = "page_contract", page_contract[key], template_before
        elif key in style_values and capability_matrix.get(_STYLE_TOKEN_CAPABILITIES.get(key, key)) == "applied":
            source, value, before = "style", style_values[key], template_before
        elif key in template_values:
            source, value, before = "template", template_values[key], defaults.get(key)
        else:
            source, value, before = "default", defaults.get(key), None
        result[key] = _copy(value)
        records.append({"attribute_path": key, "before": _copy(before), "after": _copy(value), "source_type": source, "package_id": (style or {}).get("style_id") if source == "style" else (template or {}).get("template_id") if source == "template" else None, "package_version": (style or {}).get("version") if source == "style" else (template or {}).get("version") if source == "template" else None, "package_content_hash": (style or {}).get("content_hash") if source == "style" else (template or {}).get("content_hash") if source == "template" else None, "conflict_result": "overridden" if source in {"style", "template"} and before != value else "preserved" if source == "page_contract" else "defaulted", "compiler_version": compiler_version})
    return {"attributes": result, "overrides": records}


@dataclass(frozen=True, slots=True)
class CompiledPageIR:
    page_id: str
    page_type: str
    slots: tuple[Mapping[str, Any], ...]
    objects: tuple[Mapping[str, Any], ...]
    native_objects: tuple[Mapping[str, Any], ...]
    svg_regions: tuple[Mapping[str, Any], ...]
    media_refs: tuple[str, ...]
    editability: Mapping[str, str]
    attributes: Mapping[str, Any]
    design_snapshot_hash: str | None
    schema_version: str = V2_SCHEMA_VERSION
    required_capabilities: tuple[str, ...] = ()
    content_hash: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False)

    def to_dict(self, *, include_hash: bool = True) -> dict[str, Any]:
        return {**_copy(self.extra), "schema_version": self.schema_version, "page_id": self.page_id, "page_type": self.page_type, "slots": _copy(self.slots), "objects": _copy(self.objects), "native_objects": _copy(self.native_objects), "svg_regions": _copy(self.svg_regions), "media_refs": list(self.media_refs), "editability": _copy(self.editability), "attributes": _copy(self.attributes), "design_snapshot_hash": self.design_snapshot_hash, "required_capabilities": list(self.required_capabilities), "content_hash": self.content_hash if include_hash else ""}

    def calculated_hash(self) -> str:
        return sha256_json(self.to_dict(include_hash=False))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any], *, verify_hash: bool = True) -> "CompiledPageIR":
        _required_common(payload, name="CompiledPageIR@2")
        for name in ("slots", "objects", "native_objects", "svg_regions", "media_refs", "required_capabilities"):
            if not isinstance(payload.get(name), list):
                raise V2ContractError(f"CompiledPageIR.{name} must be an array")
        page_id = str(payload.get("page_id") or "")
        page_type = str(payload.get("page_type") or "")
        if not _ID.fullmatch(page_id) or not page_type:
            raise V2ContractError("CompiledPageIR page_id/page_type are invalid")
        value = cls(
            page_id=page_id, page_type=page_type,
            slots=tuple(_copy(payload.get("slots") or [])), objects=tuple(_copy(payload.get("objects") or [])), native_objects=tuple(_copy(payload.get("native_objects") or [])), svg_regions=tuple(_copy(payload.get("svg_regions") or [])), media_refs=tuple(str(item) for item in payload.get("media_refs") or []), editability=MappingProxyType(_copy(payload.get("editability") or {})), attributes=MappingProxyType(_copy(payload.get("attributes") or {})), design_snapshot_hash=str(payload.get("design_snapshot_hash")) if payload.get("design_snapshot_hash") else None, required_capabilities=tuple(str(item) for item in payload.get("required_capabilities") or []), content_hash=str(payload.get("content_hash")),
            extra=MappingProxyType({str(key): _copy(child) for key, child in payload.items() if key not in {"schema_version", "page_id", "page_type", "slots", "objects", "native_objects", "svg_regions", "media_refs", "editability", "attributes", "design_snapshot_hash", "required_capabilities", "content_hash"}}),
        )
        if verify_hash and value.content_hash != value.calculated_hash():
            raise PackageHashMismatch("CompiledPageIR content hash does not match payload")
        return value


def _layout_for(page_type: str, template: Mapping[str, Any] | None) -> Mapping[str, Any]:
    layouts = list((template or {}).get("layouts") or [])
    wanted = {"cover": "cover", "comparison": "two_column", "process": "process"}.get(page_type, page_type)
    for layout in layouts:
        if str(layout.get("name") or layout.get("layout") or "") == wanted:
            return layout
    return {"name": wanted, "slots": ["title", "body"]}


def compile_template_page(page_contract: Mapping[str, Any] | PageContractV2, template: Mapping[str, Any] | None, *, design_snapshot_hash: str | None = None) -> CompiledPageIR:
    contract = page_contract if isinstance(page_contract, Mapping) else page_contract.to_dict()
    page_id = str(contract.get("page_id") or "")
    if not page_id:
        raise V2ContractError("page_id is required")
    layout = _layout_for(str(contract.get("page_type") or "content"), template)
    capacity = dict((template or {}).get("capacity") or {})
    text_capacity = int(capacity.get(str(contract.get("page_type") or "content"), capacity.get("text_lines", 12)))
    text = list(contract.get("text") or [])
    if len(text) > text_capacity:
        raise TemplateCapacityExceeded(f"{page_id} exceeds template text capacity ({len(text)} > {text_capacity})")
    protected = list((template or {}).get("protected_assets") or [])
    # ``prohibited_changes`` declares the contract boundary.  Only an
    # explicit proposed change attempts to violate it; declarations alone are
    # not conflicts and must remain present in the immutable PageContract.
    requested_protected = set(str(item) for item in (contract.get("proposed_changes") or contract.get("requested_changes") or []))
    declared = {str(item.get("id") or item.get("name") or "") for item in protected}
    if requested_protected.intersection(declared):
        raise ProtectedAssetConflict(f"{page_id} attempts to change protected assets")
    slot_names = [str(item) for item in (layout.get("slots") or ["title", "body"])]
    slots = tuple({"slot_id": f"{page_id}:{name}", "semantic": name, "capacity": text_capacity if name == "body" else 1, "protected": name in declared} for name in slot_names)
    objects = [{"object_id": f"{page_id}:title", "kind": "text", "slot": f"{page_id}:title", "text": str(contract.get("title") or (text[0] if text else "")), "editable_level": "structured_editable"}]
    objects.extend({"object_id": f"{page_id}:body:{index}", "kind": "text", "slot": f"{page_id}:body", "text": value, "editable_level": "structured_editable"} for index, value in enumerate(text))
    objects.extend({"object_id": f"{page_id}:relation:{index}", "kind": "connector", "relation": _copy(relation), "editable_level": "structured_editable"} for index, relation in enumerate(contract.get("relations") or []))
    for asset in contract.get("content_blocks") or []:
        if str(asset.get("kind")) in {"image", "illustration"}:
            objects.append({"object_id": str(asset.get("block_id") or f"{page_id}:media:{len(objects)}"), "kind": "image", "artifact_id": asset.get("artifact_id"), "editable_level": "visual_only"})
    native = tuple(item for item in objects if item["kind"] != "image")
    svg_regions = tuple({"region_id": item["object_id"], "bounds": item.get("bounds") or {}, "editable_level": item["editable_level"]} for item in objects)
    media_refs = tuple(str(item.get("artifact_id")) for item in objects if item["kind"] == "image" and item.get("artifact_id"))
    editability = {"page": V2EditableLevel.STRUCTURED_EDITABLE.value, "artifact": V2EditableLevel.STRUCTURED_EDITABLE.value, **{item["object_id"]: item["editable_level"] for item in objects}}
    base = CompiledPageIR(page_id, str(contract.get("page_type") or "content"), slots, tuple(objects), native, svg_regions, media_refs, MappingProxyType(editability), MappingProxyType({"layout": _copy(layout)}), design_snapshot_hash, V2_SCHEMA_VERSION, tuple(str(item) for item in contract.get("required_capabilities") or []), "")
    return replace(base, content_hash=base.calculated_hash())


def compile_style_page(ir: CompiledPageIR, style: Mapping[str, Any] | None, *, page_contract: Mapping[str, Any] | None = None, template: Mapping[str, Any] | None = None, design_snapshot_hash: str | None = None) -> CompiledPageIR:
    resolved = resolve_design_attributes(page_contract or {}, template, style)
    attrs = {**_copy(ir.attributes), **resolved["attributes"], "overrides": resolved["overrides"]}
    base = CompiledPageIR(ir.page_id, ir.page_type, ir.slots, ir.objects, ir.native_objects, ir.svg_regions, ir.media_refs, ir.editability, MappingProxyType(attrs), design_snapshot_hash or ir.design_snapshot_hash, ir.schema_version, ir.required_capabilities, "")
    return replace(base, content_hash=base.calculated_hash())


def compile_page(page_contract: Mapping[str, Any] | PageContractV2, *, style: Mapping[str, Any] | None = None, template: Mapping[str, Any] | None = None, design_snapshot: DesignSnapshot | Mapping[str, Any] | None = None) -> CompiledPageIR:
    snapshot_was_mapping = design_snapshot is not None and not isinstance(design_snapshot, DesignSnapshot)
    if design_snapshot is not None and not isinstance(design_snapshot, DesignSnapshot):
        if not isinstance(design_snapshot, Mapping):
            raise V2ContractError("design_snapshot must be a DesignSnapshot or object")
        design_snapshot = DesignSnapshot.from_dict(design_snapshot, verify_hash=True)
    snapshot_hash = design_snapshot.content_hash if design_snapshot else None
    snapshot_mode = design_snapshot.mode if design_snapshot else ""
    if snapshot_mode == "style_template" and not (
        design_snapshot
        and design_snapshot.preview_artifact_hash
        and design_snapshot.confirmed_by
        and design_snapshot.confirmed_at
    ):
        raise DesignConfirmationRequired("style_template generation requires confirmation")
    if snapshot_mode == "style_template" and snapshot_was_mapping:
        raise DesignConfirmationRequired(
            "style_template compilation requires a trusted DesignSnapshot validated against its preview Artifact"
        )
    if design_snapshot is not None:
        expected_style = _ref(style, kind="style")
        expected_template = _ref(template, kind="template")
        if design_snapshot.style_ref != expected_style or design_snapshot.template_ref != expected_template:
            raise V2ContractError("design_snapshot package references do not match compilation packages")
    ir = compile_template_page(page_contract, template, design_snapshot_hash=snapshot_hash)
    if style:
        ir = compile_style_page(ir, style, page_contract=page_contract if isinstance(page_contract, Mapping) else page_contract.to_dict(), template=template, design_snapshot_hash=snapshot_hash)
    return ir


def validate_v2_document(payload: Mapping[str, Any], *, required_fields: Sequence[str] = ()) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise V2ContractError("v2 contract must be an object")
    _required_common(payload, name="v2 contract")
    missing = [field_name for field_name in required_fields if field_name not in payload]
    if missing:
        raise V2ContractError("v2 contract missing: " + ", ".join(missing))
    return dict(payload)


# Friendly aliases used by adapters and external callers.
StylePackage = StylePackageManifest
TemplatePackage = TemplatePackageManifest
PageContract = PageContractV2
StylePackageManifestV2 = StylePackageManifest
TemplatePackageManifestV2 = TemplatePackageManifest
PageContractV2Document = PageContractV2
TemplateSkeletonSnapshotV2 = TemplateSkeletonSnapshot
DesignSnapshotV2 = DesignSnapshot
CompiledPageIRV2 = CompiledPageIR
EditableLevelV2 = V2EditableLevel
compile_template = compile_template_page
compile_style = compile_style_page
resolve_precedence = resolve_design_attributes


__all__ = [
    "V2_SCHEMA_VERSION", "V2_COMPILER_VERSION", "V2_MODES", "KNOWN_V2_CAPABILITIES", "V2EditableLevel", "EditableLevelV2", "V2ContractError", "DesignConfirmationRequired", "TemplateCapacityExceeded", "ProtectedAssetConflict", "PackageHashMismatch", "canonical_json", "sha256_json", "StylePackageManifest", "StylePackageManifestV2", "TemplatePackageManifest", "TemplatePackageManifestV2", "PageContractV2", "PageContractV2Document", "TemplateSkeletonSnapshot", "TemplateSkeletonSnapshotV2", "DesignSnapshot", "DesignSnapshotV2", "create_design_snapshot", "DesignSelectionStateMachine", "resolve_design_attributes", "CompiledPageIR", "CompiledPageIRV2", "compile_template_page", "compile_style_page", "compile_page", "validate_v2_document", "StylePackage", "TemplatePackage", "PageContract", "compile_template", "compile_style", "resolve_precedence",
]
