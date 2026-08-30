"""Deterministic v2 task-one vertical slice.

The fixture runner is intentionally offline.  It is used by contract tests and
local verification and never calls a model, PostgreSQL, MinIO or PowerPoint.
"""

from __future__ import annotations

from dataclasses import dataclass
import base64
import hashlib
import html
import json
from pathlib import Path
import re
import sys
from typing import Any, Mapping

from fastppt_core.v2 import (
    DesignConfirmationRequired,
    DesignSnapshot,
    DesignSelectionStateMachine,
    CompiledPageIR,
    PackageHashMismatch,
    PageContractV2,
    StylePackageManifest,
    TemplatePackageManifest,
    V2ContractError,
    V2_SCHEMA_VERSION,
    compile_page,
    create_design_snapshot,
    sha256_json,
)
from fastppt_core.svg import render_page_svg
from fastppt_ppt_master import ConversionRequest, PptMasterAdapter

from .v2_artifacts import ArtifactMissingError


TASK1_STYLE_ID = "style_task1_signal"
TASK1_TEMPLATE_ID = "template_task1_briefing"
TASK1_STYLE_VERSION = "1.0.0"
TASK1_TEMPLATE_VERSION = "1.0.0"
TASK1_PAGE_IDS = ("page_t1_001", "page_t1_002", "page_t1_003")
TASK1_MODES = frozenset({"none_none", "style_only", "template_only", "style_template"})
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9._-]{1,200}$")


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _hash_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def task1_ir_contract_fingerprint(payload: Mapping[str, Any] | CompiledPageIR) -> str:
    """Hash the fixture-owned IR contract, excluding request-specific bindings."""
    value = payload.to_dict() if isinstance(payload, CompiledPageIR) else dict(payload)
    value["design_snapshot_hash"] = None
    value["content_hash"] = ""
    return sha256_json(value)


def _powerpoint_readiness() -> dict[str, Any]:
    """Probe the local Office installation without claiming render authority."""
    if sys.platform != "win32":
        return {"status": "skipped", "reason": "Microsoft PowerPoint is unavailable on this platform"}
    try:
        import winreg

        versions: list[str] = []
        for hive, path in (
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Office\ClickToRun\Configuration"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Office\ClickToRun\Configuration"),
        ):
            try:
                with winreg.OpenKey(hive, path) as key:
                    for name in ("VersionToReport", "ClientVersionToReport"):
                        try:
                            value = str(winreg.QueryValueEx(key, name)[0] or "")
                        except OSError:
                            continue
                        if value:
                            versions.append(value)
            except OSError:
                continue
        version = next((item for item in versions if item.startswith("16.")), versions[0] if versions else "")
        if version:
            return {"status": "ready", "version": ".".join(version.split(".")[:2]), "detected_version": version}
    except Exception:
        pass
    return {"status": "skipped", "reason": "Microsoft PowerPoint installation was not detected"}


def _deterministic_id(kind: str, seed: str) -> str:
    return f"{kind}_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:32]}"


def task1_preview_artifact_id(project_id: str, idempotency_key: str) -> str:
    return _deterministic_id("artifact", f"{project_id}:{idempotency_key}:preview")


def validate_task1_token(value: Any, name: str) -> str:
    token = str(value or "").strip()
    if not _SAFE_TOKEN.fullmatch(token) or token in {".", ".."}:
        raise V2ContractError(f"{name} must be an opaque relative identifier")
    return token


def _preview_artifact_bytes(style: Mapping[str, Any] | None, template: Mapping[str, Any] | None) -> bytes:
    """Return the immutable preview Artifact representation used for confirmation."""
    value = {
        "schema_version": V2_SCHEMA_VERSION,
        "kind": "task1_style_template_preview",
        "mode": mode_for_selection({"style_version_ref": style, "template_version_ref": template}),
        "style": {key: style.get(key) for key in ("style_id", "version", "content_hash")} if style else None,
        "template": {key: template.get(key) for key in ("template_id", "version", "content_hash")} if template else None,
    }
    return _canonical(value)


def _preview_artifact_hash(style: Mapping[str, Any] | None, template: Mapping[str, Any] | None) -> str:
    return _hash_bytes(_preview_artifact_bytes(style, template))


def _process_svg(title: str, nodes: list[str], *, page_number: int, accent: str, background: str) -> str:
    """Render the seven-node task-one process as native SVG shapes/connectors."""
    node_values = (nodes + ["Next stage"] * 7)[:7]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" data-pptx-page-role="process" data-fastppt-layout="process">',
        f'<rect id="page-background" data-pptx-role="background" width="1280" height="720" fill="{html.escape(background)}"/>',
        f'<rect id="accent-rail" data-pptx-role="decoration" x="0" y="0" width="18" height="720" fill="{html.escape(accent)}"/>',
        f'<text x="84" y="88" font-family="Arial, sans-serif" font-size="16" fill="#626A73">FASTPPT</text>',
        f'<text x="84" y="168" font-family="Microsoft YaHei, Arial, sans-serif" font-size="42" font-weight="700" fill="#171A1D">{html.escape(title)}</text>',
    ]
    positions = [(84 + (index % 4) * 285, 245) if index < 4 else (84 + ((index - 4) % 3) * 380, 465) for index in range(7)]
    for index, (x, y) in enumerate(positions):
        parts.append(f'<rect id="node-{index + 1}" data-pptx-role="process-node" x="{x}" y="{y}" width="240" height="110" rx="8" fill="#FFFFFF" stroke="#D8DCE1" stroke-width="2"/>')
        parts.append(f'<text x="{x + 16}" y="{y + 60}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="18" fill="#25292D">{html.escape(node_values[index])}</text>')
    for index in range(6):
        x1, y1 = positions[index]
        x2, y2 = positions[index + 1]
        if index == 3:
            parts.append(f'<line id="connector-{index + 1}" data-pptx-role="connector" x1="{x1 + 120}" y1="{y1 + 110}" x2="{x2 + 120}" y2="{y2}" stroke="{html.escape(accent)}" stroke-width="4"/>')
        else:
            parts.append(f'<line id="connector-{index + 1}" data-pptx-role="connector" x1="{x1 + 240}" y1="{y1 + 55}" x2="{x2}" y2="{y2 + 55}" stroke="{html.escape(accent)}" stroke-width="4"/>')
    parts.extend([
        '<line x1="84" y1="662" x2="1196" y2="662" stroke="#D8DCE1" stroke-width="2"/>',
        f'<text id="page-number-text" data-pptx-role="page-number" x="1156" y="692" font-family="Arial, sans-serif" font-size="17" fill="#626A73">{page_number:02d}</text>',
        '</svg>',
    ])
    return "\n".join(parts)


def fixture_root(root: Path | None = None) -> Path:
    if root is not None:
        return root.resolve()
    return Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "v2" / "task1"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise V2ContractError(f"Fixture is unreadable: {path.name}") from exc
    if not isinstance(value, dict):
        raise V2ContractError(f"Fixture must contain an object: {path.name}")
    return value


def _verify_fixture_lock(directory: Path, lock: Mapping[str, Any]) -> None:
    if lock.get("schema_version") != V2_SCHEMA_VERSION:
        raise V2ContractError("Fixture lock schema_version must be 2.0.0")
    if not isinstance(lock.get("required_capabilities"), list):
        raise V2ContractError("Fixture lock required_capabilities must be an array")
    lock_hash = str(lock.get("content_hash") or "")
    if lock_hash != sha256_json({**dict(lock), "content_hash": ""}):
        raise PackageHashMismatch("Fixture lock content hash does not match metadata")
    files = lock.get("files")
    if not isinstance(files, Mapping):
        raise V2ContractError("Fixture lock files must be an object")
    for relative, expected in files.items():
        relative_path = Path(str(relative))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise V2ContractError("Fixture lock contains an unsafe path")
        path = (directory / relative_path).resolve()
        try:
            path.relative_to(directory.resolve())
        except ValueError as exc:
            raise V2ContractError("Fixture lock path escapes fixture directory") from exc
        if not path.is_file():
            raise ArtifactMissingError(f"Fixture artifact is missing: {relative}")
        if _hash_bytes(path.read_bytes()) != str(expected):
            raise PackageHashMismatch(f"Fixture file hash does not match lock: {relative}")


def _verify_source_artifact(directory: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the source Artifact manifest and the bytes it names."""
    if payload.get("schema_version") != V2_SCHEMA_VERSION:
        raise V2ContractError("Task-one source Artifact schema_version must be 2.0.0")
    if payload.get("artifact_id") != "artifact_t1_source":
        raise V2ContractError("Task-one source Artifact ID is invalid")
    relative = Path(str(payload.get("path") or ""))
    if not relative.parts or relative.is_absolute() or ".." in relative.parts:
        raise V2ContractError("Task-one source Artifact path is unsafe")
    path = (directory / relative).resolve()
    try:
        path.relative_to(directory.resolve())
    except ValueError as exc:
        raise V2ContractError("Task-one source Artifact path escapes fixture directory") from exc
    if not path.is_file():
        raise ArtifactMissingError("Task-one source Artifact is missing")
    content = path.read_bytes()
    digest = _hash_bytes(content)
    if payload.get("sha256") != digest:
        raise PackageHashMismatch("Task-one source Artifact hash does not match bytes")
    if int(payload.get("size_bytes") or -1) != len(content):
        raise PackageHashMismatch("Task-one source Artifact size does not match bytes")
    if payload.get("status") != "committed":
        raise V2ContractError("Task-one source Artifact must be committed")
    if not isinstance(payload.get("source"), Mapping) or not str(payload.get("license") or ""):
        raise V2ContractError("Task-one source Artifact requires source and license metadata")
    if payload.get("editable_level") not in {"visual_only", "text_editable", "structured_editable", "native_full"}:
        raise V2ContractError("Task-one source Artifact editable_level is invalid")
    if not isinstance(payload.get("required_capabilities"), list):
        raise V2ContractError("Task-one source Artifact required_capabilities must be an array")
    if payload.get("content_hash") != sha256_json({key: value for key, value in payload.items() if key != "content_hash"}):
        raise PackageHashMismatch("Task-one source Artifact manifest hash does not match metadata")
    return dict(payload)


def load_task1_fixture(root: Path | None = None) -> dict[str, Any]:
    directory = fixture_root(root)
    style_payload = _read_json(directory / "style.manifest.json")
    template_payload = _read_json(directory / "template.manifest.json")
    lock = _read_json(directory / "fixture.lock.json")
    _verify_fixture_lock(directory, lock)
    source_artifact = _verify_source_artifact(directory, _read_json(directory / "source_artifact.manifest.json"))
    pages: list[PageContractV2] = []
    for page_id in TASK1_PAGE_IDS:
        page = PageContractV2.from_dict(_read_json(directory / "pages" / f"{page_id}.json"), verify_hash=True)
        for fact in page.facts:
            if fact.get("source_artifact_id") != source_artifact["artifact_id"]:
                raise V2ContractError(f"{page_id} fact references an unknown source Artifact")
            if fact.get("source_hash") != source_artifact["sha256"]:
                raise PackageHashMismatch(f"{page_id} fact source hash does not match artifact_t1_source")
        pages.append(page)
    style = StylePackageManifest.from_dict(style_payload, verify_hash=True)
    template = TemplatePackageManifest.from_dict(template_payload, verify_hash=True)
    expected_path = directory / "expected_irs.json"
    expected_irs: tuple[dict[str, Any], ...] = ()
    if expected_path.is_file():
        try:
            value = json.loads(expected_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise V2ContractError("Fixture is unreadable: expected_irs.json") from exc
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise V2ContractError("Fixture expected_irs.json must contain an array of objects")
        for item in value:
            CompiledPageIR.from_dict(item, verify_hash=True)
        expected_irs = tuple(value)
    return {"root": directory, "style": style, "template": template, "source_artifact": source_artifact, "pages": tuple(pages), "lock": lock, "expected_irs": expected_irs, "image": directory / "hero-grid.png", "template_file": directory / "template.potx"}


def mode_for_selection(selection: Mapping[str, Any]) -> str:
    style = selection.get("style_version_ref")
    template = selection.get("template_version_ref")
    return "style_template" if style and template else "style_only" if style else "template_only" if template else "none_none"


def _validate_ref(value: Any, *, kind: str, package: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise V2ContractError(f"{kind}_version_ref must be an object")
    expected_id = package.style_id if kind == "style" else package.template_id
    expected_version = package.version
    expected_hash = package.content_hash
    if value.get("id") != expected_id or value.get("version") != expected_version or value.get("content_hash") != expected_hash:
        raise V2ContractError(f"{kind} package reference does not match the locked fixture")
    if not isinstance(value.get("capability_matrix"), Mapping):
        raise V2ContractError(f"{kind} package reference requires capability_matrix")
    return dict(value)


def validate_task1_request(payload: Mapping[str, Any], fixture: Mapping[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise V2ContractError("Task1 request must be an object")
    if payload.get("schema_version") != V2_SCHEMA_VERSION:
        raise V2ContractError("Task1 request schema_version must be 2.0.0")
    project_id = validate_task1_token(payload.get("project_id"), "project_id")
    page_ids = payload.get("page_contract_ids")
    if not isinstance(page_ids, list) or tuple(page_ids) != TASK1_PAGE_IDS:
        raise V2ContractError("page_contract_ids must contain the three locked task-one page IDs in order")
    selection = payload.get("selection")
    if not isinstance(selection, Mapping):
        raise V2ContractError("selection is required")
    expected_mode = str(payload.get("expected_mode") or "")
    if expected_mode not in TASK1_MODES:
        raise V2ContractError("expected_mode is invalid")
    key = validate_task1_token(payload.get("idempotency_key"), "idempotency_key")
    values = fixture or load_task1_fixture()
    style_ref = _validate_ref(selection.get("style_version_ref"), kind="style", package=values["style"])
    template_ref = _validate_ref(selection.get("template_version_ref"), kind="template", package=values["template"])
    actual_mode = mode_for_selection({"style_version_ref": style_ref, "template_version_ref": template_ref})
    if actual_mode != expected_mode:
        raise V2ContractError(f"expected_mode {expected_mode} does not match selection {actual_mode}")
    confirmed = bool(payload.get("confirmed", False))
    preview_artifact_hash = str(payload.get("preview_artifact_hash") or "") or None
    confirmed_by = str(payload.get("confirmed_by") or "") or None
    confirmed_at = str(payload.get("confirmed_at") or "") or None
    if actual_mode != "style_template" and any((preview_artifact_hash, confirmed_by, confirmed_at, confirmed)):
        raise V2ContractError("preview confirmation fields are only valid for style_template")
    if preview_artifact_hash and not re.fullmatch(r"sha256:[0-9a-f]{64}", preview_artifact_hash):
        raise V2ContractError("preview_artifact_hash must be sha256:<hex>")
    if bool(confirmed_by) != bool(confirmed_at):
        raise V2ContractError("confirmation requires confirmed_by and confirmed_at together")
    if confirmed and (not preview_artifact_hash or not confirmed_by or not confirmed_at):
        raise DesignConfirmationRequired("style_template confirmation requires a preview artifact and actor record")
    return {
        "schema_version": V2_SCHEMA_VERSION,
        "project_id": project_id,
        "page_contract_ids": list(page_ids),
        "selection": {"style_version_ref": style_ref, "template_version_ref": template_ref},
        "expected_mode": expected_mode,
        "idempotency_key": key,
        "confirmed": confirmed,
        "preview_artifact_hash": preview_artifact_hash,
        "confirmed_by": confirmed_by,
        "confirmed_at": confirmed_at,
    }


@dataclass(frozen=True, slots=True)
class Task1GenerationResult:
    status: str
    mode: str
    manifest: dict[str, Any]
    output_dir: Path

    def to_dict(self) -> dict[str, Any]:
        return {"status": self.status, "mode": self.mode, **self.manifest, "output_dir": str(self.output_dir)}


class Task1Runner:
    def __init__(self, *, fixture_dir: Path | None = None, adapter: PptMasterAdapter | None = None) -> None:
        self.fixture = load_task1_fixture(fixture_dir)
        self.adapter = adapter or PptMasterAdapter()
        self._results: dict[tuple[str, str], Task1GenerationResult] = {}
        self._input_hashes: dict[tuple[str, str], str] = {}
        self._previews: dict[tuple[str, str], tuple[Any, Path]] = {}

    def preview(self, payload: Mapping[str, Any], output_dir: Path | None = None) -> Task1GenerationResult:
        request = validate_task1_request(payload, self.fixture)
        style = self.fixture["style"].to_dict()
        template = self.fixture["template"].to_dict()
        preview_hash = _preview_artifact_hash(
            style if request["selection"]["style_version_ref"] else None,
            template if request["selection"]["template_version_ref"] else None,
        ) if request["expected_mode"] == "style_template" else None
        snapshot = create_design_snapshot(
            style if request["selection"]["style_version_ref"] else None,
            template if request["selection"]["template_version_ref"] else None,
            preview_artifact_hash=preview_hash,
        )
        state_machine = DesignSelectionStateMachine(snapshot.mode)
        state_machine.validate()
        directory = (output_dir or (self.fixture["root"] / "output-preview")).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "design_snapshot.json").write_text(json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        preview_path = directory / "preview_artifact.json"
        if snapshot.mode == "style_template":
            preview_path.write_bytes(_preview_artifact_bytes(style, template))
            if _hash_bytes(preview_path.read_bytes()) != snapshot.preview_artifact_hash:
                raise V2ContractError("preview Artifact hash does not match DesignSnapshot")
            self._previews[(request["project_id"], request["idempotency_key"])] = (snapshot, preview_path)
        preview_artifact = None
        if snapshot.mode == "style_template":
            preview_artifact = {
                "artifact_id": task1_preview_artifact_id(request["project_id"], request["idempotency_key"]),
                "path": str(preview_path.relative_to(directory)).replace("\\", "/"),
                "sha256": snapshot.preview_artifact_hash,
                "size_bytes": preview_path.stat().st_size,
                "media_type": "application/json",
                "source": {"kind": "task1_preview", "fixture_id": "task1"},
                "status": "committed",
                "required_capabilities": ["artifact_store"],
                "content_hash": "",
            }
            preview_artifact["content_hash"] = sha256_json(
                {key: value for key, value in preview_artifact.items() if key != "content_hash"}
            )
        return Task1GenerationResult(
            "preview_required" if snapshot.mode == "style_template" else state_machine.state,
            snapshot.mode,
            {"design_snapshot": snapshot.to_dict(), "preview_artifact": preview_artifact},
            directory,
        )

    def run(self, payload: Mapping[str, Any], *, output_dir: Path | None = None, preview_snapshot: Mapping[str, Any] | None = None) -> Task1GenerationResult:
        request = validate_task1_request(payload, self.fixture)
        input_hash = sha256_json(request)
        request_key = (request["project_id"], request["idempotency_key"])
        if request_key in self._results:
            if self._input_hashes[request_key] != input_hash:
                raise V2ContractError("idempotency_key was already used with different task-one input")
            return self._results[request_key]
        style = self.fixture["style"].to_dict() if request["selection"]["style_version_ref"] else None
        template = self.fixture["template"].to_dict() if request["selection"]["template_version_ref"] else None
        preview_hash = _preview_artifact_hash(style, template) if request["expected_mode"] == "style_template" else None
        snapshot = create_design_snapshot(style, template, preview_artifact_hash=preview_hash)
        if snapshot.mode == "style_template":
            if not request["confirmed"]:
                raise DesignConfirmationRequired("style_template generation requires preview confirmation")
            if preview_snapshot is None:
                saved_preview = self._previews.get(request_key)
                if saved_preview is None:
                    raise DesignConfirmationRequired("style_template generation requires a matching preview Artifact")
                candidate, preview_path = saved_preview
                if not preview_path.is_file() or _hash_bytes(preview_path.read_bytes()) != candidate.preview_artifact_hash:
                    raise DesignConfirmationRequired("style_template preview Artifact is missing or changed")
            else:
                try:
                    candidate = DesignSnapshot.from_dict(preview_snapshot, verify_hash=True)
                except (TypeError, V2ContractError) as exc:
                    raise DesignConfirmationRequired("style_template preview snapshot is invalid") from exc
            if candidate.mode != "style_template" or candidate.confirmed_by or candidate.confirmed_at:
                raise DesignConfirmationRequired("style_template preview must be an unconfirmed snapshot")
            if candidate.style_ref != snapshot.style_ref or candidate.template_ref != snapshot.template_ref:
                raise DesignConfirmationRequired("style_template preview does not match the selected packages")
            if candidate.preview_artifact_hash != request["preview_artifact_hash"] or candidate.preview_artifact_hash != preview_hash:
                raise DesignConfirmationRequired("style_template confirmation does not reference the preview Artifact")
            snapshot = candidate.confirm(request["confirmed_by"], confirmed_at=request["confirmed_at"])
        directory = (output_dir or (self.fixture["root"] / "output" / request["idempotency_key"])).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        pages: list[dict[str, Any]] = []
        svg_files: list[Path] = []
        ir_payloads: list[dict[str, Any]] = []
        for index, contract in enumerate(self.fixture["pages"], 1):
            ir = compile_page(contract, style=style, template=template, design_snapshot=snapshot)
            ir_payloads.append(ir.to_dict())
            body = "\n".join(contract.text)
            accent = str((style or {}).get("tokens", {}).get("primary") or "#23745B")
            background = str((style or {}).get("tokens", {}).get("background") or "#FFFFFF")
            title = str(contract.extra.get("title") or contract.page_type.title())
            if contract.page_type == "process":
                svg = _process_svg(title, list(contract.text), page_number=index, accent=accent, background=background)
            else:
                svg = render_page_svg(title, body, page_number=index, page_role=contract.page_type, accent=accent, background=background, layout="two_column" if contract.page_type == "comparison" else "title_body", image_data_uri=("data:image/png;base64," + base64.b64encode(self.fixture["image"].read_bytes()).decode("ascii")) if index == 1 else None)
            svg_path = directory / f"{contract.page_id}.svg"
            svg_path.write_text(svg, encoding="utf-8")
            svg_files.append(svg_path)
            version_id = _deterministic_id("version", request["project_id"] + ":" + request["idempotency_key"] + ":" + contract.page_id)
            pages.append({"page_id": contract.page_id, "version_id": version_id, "page_contract_hash": contract.content_hash, "ir_hash": ir.content_hash, "editable_level": "structured_editable", "region_editability": dict(ir.editability), "artifact_exceptions": [{"region": "image", "level": "visual_only"}] if index == 1 else []})
        expected_irs = self.fixture.get("expected_irs") or ()
        if snapshot.mode == "style_template" and expected_irs:
            actual_fingerprints = [task1_ir_contract_fingerprint(item) for item in ir_payloads]
            expected_fingerprints = [task1_ir_contract_fingerprint(item) for item in expected_irs]
            if actual_fingerprints != expected_fingerprints:
                raise V2ContractError("Generated task-one IR does not match the locked fixture expectation")
        pptx_artifact = None
        adapter_report: dict[str, Any] = {"status": "skipped", "reason": "style_template_only golden generation"}
        if snapshot.mode == "style_template":
            output_pptx = directory / "task1-golden.pptx"
            result = self.adapter.convert(
                ConversionRequest(
                    tuple(svg_files),
                    output_pptx,
                    "task1-golden",
                    template_path=self.fixture["template_file"],
                    layout_names=("cover", "two_column", "process"),
                    native_connector_counts=(0, 0, 6),
                )
            )
            pptx_bytes = output_pptx.read_bytes()
            pptx_artifact = {
                "artifact_id": _deterministic_id("artifact", request["project_id"] + ":" + request["idempotency_key"] + ":pptx"),
                "path": output_pptx.name,
                "sha256": _hash_bytes(pptx_bytes),
                "size_bytes": len(pptx_bytes),
                "media_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "source": {"kind": "task1_fixture", "fixture_id": "task1"},
                "status": "committed",
                "editable_level": "structured_editable",
                "exceptions": pages[0]["artifact_exceptions"],
                "required_capabilities": ["pptx_export", "structured_editable"],
                "content_hash": "",
            }
            pptx_artifact["content_hash"] = sha256_json({key: value for key, value in pptx_artifact.items() if key != "content_hash"})
            adapter_report = {"status": "passed", "pptx_sha256": result.pptx_sha256, "slide_count": result.slide_count, "kernel_version": result.kernel_version, "svg_qa_status": result.svg_qa_status, "pptx_qa_status": result.pptx_qa_status}
        powerpoint_readiness = _powerpoint_readiness()
        powerpoint_golden: dict[str, Any] | None = None
        if powerpoint_readiness["status"] == "ready" and pptx_artifact:
            golden_path = self.fixture["root"] / "powerpoint-golden.json"
            golden = _read_json(golden_path)
            if golden.get("content_hash") != sha256_json({**golden, "content_hash": ""}):
                raise V2ContractError("PowerPoint Golden metadata content hash does not match")
            if golden.get("powerpoint_major_version") != powerpoint_readiness.get("version"):
                powerpoint_golden = {
                    "status": "unverified",
                    "reason": "No same-version PNG Golden baseline is available",
                    "available_version": golden.get("powerpoint_major_version"),
                }
            elif golden.get("input_pptx_sha256") != pptx_artifact.get("sha256"):
                raise V2ContractError(
                    "PowerPoint Golden is not bound to the generated PPTX hash "
                    f"({golden.get('input_pptx_sha256')} != {pptx_artifact.get('sha256')})"
                )
            else:
                powerpoint_golden = {
                    "status": "available",
                    "metadata_path": golden_path.name,
                    "metadata_sha256": _hash_bytes(golden_path.read_bytes()),
                    "metadata_content_hash": golden["content_hash"],
                    "input_pptx_sha256": golden["input_pptx_sha256"],
                    "thresholds": golden.get("thresholds"),
                    "slide_count": len(golden.get("slides") or []),
                }
        render_status = "unverified" if powerpoint_readiness["status"] == "ready" and pptx_artifact else "skipped"
        qa = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["static_qa", "structured_editable"], "status": "passed", "validation_status": "verified", "facts": "passed", "structure": "passed", "editability": "passed", "static_qa": "passed", "render_status": render_status, "evidence": adapter_report, "content_hash": ""}
        qa["content_hash"] = sha256_json({key: value for key, value in qa.items() if key != "content_hash"})
        fact_bindings = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["fact_bindings"], "bindings": [{"page_id": page["page_id"], "fact_ids": [str(fact.get("fact_id")) for contract in self.fixture["pages"] if contract.page_id == page["page_id"] for fact in contract.facts], "content_hash": page["page_contract_hash"]} for page in pages], "content_hash": ""}
        fact_bindings["content_hash"] = sha256_json({key: value for key, value in fact_bindings.items() if key != "content_hash"})
        checkpoint = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["recovery"], "job_id": _deterministic_id("job", request["project_id"] + ":" + request["idempotency_key"]), "stage": "reconciled", "input_hash": input_hash, "committed_outputs": [item["version_id"] for item in pages], "idempotency_key": request["idempotency_key"], "content_hash": ""}
        checkpoint["content_hash"] = sha256_json({key: value for key, value in checkpoint.items() if key != "content_hash"})
        export_snapshot = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["export"], "export_snapshot_id": _deterministic_id("export_snapshot", request["project_id"] + ":" + request["idempotency_key"]), "page_version_lock": [{"page_id": item["page_id"], "version_id": item["version_id"]} for item in pages], "design_snapshot_hash": snapshot.content_hash, "artifact_hashes": [pptx_artifact["sha256"]] if pptx_artifact else [], "content_hash": ""}
        export_snapshot["content_hash"] = sha256_json({key: value for key, value in export_snapshot.items() if key != "content_hash"})
        export_attempt = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["export"], "export_attempt_id": _deterministic_id("export_attempt", request["project_id"] + ":" + request["idempotency_key"]), "export_snapshot_id": export_snapshot["export_snapshot_id"], "status": "succeeded" if pptx_artifact else "skipped", "artifact": pptx_artifact, "content_hash": ""}
        export_attempt["content_hash"] = sha256_json({key: value for key, value in export_attempt.items() if key != "content_hash"})
        editability_report = {"schema_version": V2_SCHEMA_VERSION, "required_capabilities": ["structured_editable", "visual_only"], "page_level": "structured_editable", "artifact_level": "structured_editable", "exceptions": pages[0]["artifact_exceptions"], "content_hash": ""}
        editability_report["content_hash"] = sha256_json({key: value for key, value in editability_report.items() if key != "content_hash"})
        manifest = {"schema_version": V2_SCHEMA_VERSION, "status": "completed", "required_capabilities": ["page_contract", "structured_editable", "export", "recovery"], "project_id": request["project_id"], "mode": snapshot.mode, "input_hash": input_hash, "fixture_lock_hash": self.fixture["lock"].get("content_hash"), "expected_ir_hashes": [str(item.get("content_hash") or "") for item in expected_irs], "design_snapshot": snapshot.to_dict(), "pages": pages, "compiled_page_irs": ir_payloads, "pptx_artifact": pptx_artifact, "qa_report": qa, "fact_binding_report": fact_bindings, "editability_report": editability_report, "export_snapshot": export_snapshot, "export_attempt": export_attempt, "recovery_checkpoint": checkpoint, "powerpoint_readiness": powerpoint_readiness | ({"authoritative_render": "unverified", "reason": "Authoritative verification runs in the PowerPoint verifier"} if powerpoint_readiness["status"] == "ready" and pptx_artifact else {}), "powerpoint_golden": powerpoint_golden, "content_hash": ""}
        manifest["content_hash"] = sha256_json({key: value for key, value in manifest.items() if key != "content_hash"})
        (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        for name, value in (("design_snapshot.json", snapshot.to_dict()), ("qa_report.json", qa), ("fact_binding_report.json", fact_bindings), ("recovery_checkpoint.json", checkpoint), ("export_snapshot.json", export_snapshot), ("export_attempt.json", export_attempt), ("editability_report.json", manifest["editability_report"]), ("compiled_page_irs.json", ir_payloads)):
            (directory / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        result = Task1GenerationResult("completed" if snapshot.mode == "style_template" else "active", snapshot.mode, manifest, directory)
        self._results[request_key] = result
        self._input_hashes[request_key] = input_hash
        return result


def run_task1_fixture(payload: Mapping[str, Any], *, output_dir: Path | None = None) -> dict[str, Any]:
    return Task1Runner().run(payload, output_dir=output_dir).to_dict()


__all__ = ["TASK1_STYLE_ID", "TASK1_TEMPLATE_ID", "TASK1_STYLE_VERSION", "TASK1_TEMPLATE_VERSION", "TASK1_PAGE_IDS", "Task1GenerationResult", "Task1Runner", "fixture_root", "load_task1_fixture", "mode_for_selection", "task1_ir_contract_fingerprint", "task1_preview_artifact_id", "validate_task1_request", "validate_task1_token", "run_task1_fixture"]
