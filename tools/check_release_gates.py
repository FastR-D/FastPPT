#!/usr/bin/env python3
"""Audit the v1.2.0 release evidence without making provider calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.evidence_proof import validate_runtime_proof


VERSION = "v1.2.0"
EVIDENCE_DIR = "output/provider-evidence"
RENDER_EVIDENCE_PATH = "output/verification-v12-final/powerpoint-qa.json"
REQUIRED_EVIDENCE = {
    "codex_relay_agent": "real_codex_relay_structured_agent_call",
    "gpt_image_generation": "real_gpt_image2_generation",
    "gpt_image_edit": "real_gpt_image2_edit",
}
EVIDENCE_FIELDS = {
    "evidence_type",
    "schema_version",
    "project_id",
    "provider_request_id",
    "status",
    "provider_snapshot",
    "prompt_artifact_id",
    "input_artifact_ids",
    "input_artifact_hashes",
    "prompt_digest",
    "output_artifact_ids",
    "output_digest",
    "usage_request_id",
    "usage",
    "binding",
    "binding_digest",
    "redaction",
    "runtime_proof",
}


def _nonempty(value: Any) -> bool:
    return value is not None and value != "" and value != []


def validate_evidence_record(record: dict[str, Any], *, signing_key: str | bytes | None = None) -> list[str]:
    """Return evidence-contract and cross-reference errors.

    Evidence is emitted by the runtime with a binding snapshot.  The snapshot
    is deliberately redacted, but its digest and references make a free-form
    collection of IDs insufficient to satisfy the release gate.
    """
    errors: list[str] = []
    missing = sorted(field for field in EVIDENCE_FIELDS if field not in record)
    errors.extend(f"missing:{field}" for field in missing)
    if record.get("status") != "completed":
        errors.append("status_not_completed")
    provider = record.get("provider_snapshot")
    if not isinstance(provider, dict) or not _nonempty(provider.get("backend")) or not _nonempty(provider.get("model")):
        errors.append("provider_snapshot_incomplete")
    redaction = record.get("redaction")
    if not isinstance(redaction, dict):
        errors.append("redaction_missing")
    else:
        for name in ("full_prompt", "raw_response", "credentials"):
            if redaction.get(name) != "omitted":
                errors.append(f"redaction:{name}")
    for field in ("prompt_artifact_id", "prompt_digest", "output_digest", "usage_request_id"):
        if not _nonempty(record.get(field)):
            errors.append(f"empty:{field}")
    if not _nonempty(record.get("agent_run_id")) and not _nonempty(record.get("image_attempt_id")):
        errors.append("missing:agent_run_id_or_image_attempt_id")
    if not _nonempty(record.get("provider_request_id")):
        errors.append("empty:provider_request_id")
    for field in ("input_artifact_hashes", "output_artifact_ids"):
        if not isinstance(record.get(field), list):
            errors.append(f"invalid:{field}")
    binding = record.get("binding")
    binding_digest = record.get("binding_digest")
    if not isinstance(binding, dict):
        errors.append("binding_missing")
        return errors
    if not isinstance(binding_digest, str) or binding_digest != binding.get("binding_digest"):
        errors.append("binding_digest_missing")
    else:
        unsigned = {key: value for key, value in binding.items() if key != "binding_digest"}
        expected = "sha256:" + hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if binding_digest != expected:
            errors.append("binding_digest_mismatch")
    if binding.get("binding_version") != "1.0":
        errors.append("binding_version_unsupported")
    if binding.get("project_id") != record.get("project_id"):
        errors.append("binding_project_mismatch")
    run = binding.get("run")
    if not isinstance(run, dict):
        errors.append("binding_run_missing")
        run = {}
    else:
        run_id = run.get("run_id")
        top_run_id = record.get("agent_run_id") or record.get("image_attempt_id")
        if run_id != top_run_id:
            errors.append("binding_run_id_mismatch")
        if run.get("status") != "completed":
            errors.append("binding_run_not_completed")
        if run.get("provider_request_id") != record.get("provider_request_id"):
            errors.append("binding_provider_request_mismatch")
        if run.get("prompt_artifact_id") != record.get("prompt_artifact_id"):
            errors.append("binding_prompt_mismatch")
        if run.get("usage_request_id") != record.get("usage_request_id"):
            errors.append("binding_usage_mismatch")
        if run.get("output_artifact_ids") != record.get("output_artifact_ids"):
            errors.append("binding_output_ids_mismatch")
        if run.get("input_artifact_ids") != record.get("input_artifact_ids"):
            errors.append("binding_input_ids_mismatch")
        if run.get("run_kind") not in {"agent_run", "image_attempt"}:
            errors.append("binding_run_kind_unsupported")

    def valid_id(value: object, prefix: str) -> bool:
        return isinstance(value, str) and bool(re.fullmatch(rf"{re.escape(prefix)}[0-9a-f]{{32}}", value))

    if not valid_id(record.get("project_id"), "project_"):
        errors.append("project_id_not_runtime_id")
    run_prefix = "agent_run_" if record.get("agent_run_id") else "image_attempt_"
    if not valid_id(record.get("agent_run_id") or record.get("image_attempt_id"), run_prefix):
        errors.append("run_id_not_runtime_id")
    if not valid_id(record.get("prompt_artifact_id"), "artifact_"):
        errors.append("prompt_artifact_id_not_runtime_id")
    if not valid_id(record.get("usage_request_id"), "request_"):
        errors.append("usage_request_id_not_runtime_id")
    if not isinstance(record.get("provider_request_id"), str) or len(record["provider_request_id"]) < 16:
        errors.append("provider_request_id_not_verifiable")
    if not isinstance(record.get("prompt_digest"), str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", record["prompt_digest"]):
        errors.append("prompt_digest_not_sha256")
    if not isinstance(record.get("output_digest"), str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", record["output_digest"]):
        errors.append("output_digest_not_sha256")

    prompt = binding.get("prompt_artifact")
    inputs = binding.get("input_artifacts")
    outputs = binding.get("output_artifacts")
    usage_binding = binding.get("usage")
    if not isinstance(prompt, dict) or prompt.get("artifact_id") != record.get("prompt_artifact_id"):
        errors.append("binding_prompt_artifact_missing")
    if not isinstance(inputs, list) or [item.get("artifact_id") for item in inputs if isinstance(item, dict)] != list(record.get("input_artifact_ids") or []):
        errors.append("binding_input_artifacts_missing")
    if not isinstance(outputs, list) or [item.get("artifact_id") for item in outputs if isinstance(item, dict)] != list(record.get("output_artifact_ids") or []):
        errors.append("binding_output_artifacts_missing")
    for label, artifacts in (("prompt", [prompt]), ("input", inputs or []), ("output", outputs or [])):
        for item in artifacts:
            if not isinstance(item, dict) or not re.fullmatch(r"artifact_[0-9a-f]{32}", str(item.get("artifact_id") or "")) or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(item.get("sha256") or "")):
                errors.append(f"binding_{label}_artifact_invalid")
    if isinstance(inputs, list):
        hashes = [item.get("sha256") for item in inputs if isinstance(item, dict)]
        if hashes != list(record.get("input_artifact_hashes") or []):
            errors.append("binding_input_hashes_mismatch")
    if isinstance(outputs, list):
        output_hashes = [str(item.get("sha256")) for item in outputs if isinstance(item, dict)]
        if run.get("run_kind") == "agent_run" and len(output_hashes) == 1 and output_hashes[0] != record.get("output_digest"):
            errors.append("agent_output_digest_mismatch")
        if run.get("run_kind") == "image_attempt":
            raw_hashes = [item.removeprefix("sha256:") for item in output_hashes]
            expected_image_digest = "sha256:" + hashlib.sha256(json.dumps(raw_hashes, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            if expected_image_digest != record.get("output_digest"):
                errors.append("image_output_digest_mismatch")
    if not isinstance(usage_binding, dict) or usage_binding.get("request_id") != record.get("usage_request_id") or usage_binding.get("project_id") != record.get("project_id") or usage_binding.get("submission_status") != "settled":
        errors.append("binding_usage_not_settled")
    usage_rows = record.get("usage") if isinstance(record.get("usage"), list) else [record.get("usage")]
    if not any(isinstance(item, dict) and item.get("request_id") == record.get("usage_request_id") and item.get("project_id") == record.get("project_id") and item.get("submission_status") == "settled" for item in usage_rows):
        errors.append("usage_not_bound_or_settled")
    errors.extend(validate_runtime_proof(record, signing_key))
    return errors


def _load_evidence(root: Path) -> tuple[list[dict[str, Any]], list[str]]:
    directory = root / EVIDENCE_DIR
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    if not directory.is_dir():
        return records, [f"missing_directory:{EVIDENCE_DIR}"]
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"invalid_json:{path.relative_to(root).as_posix()}:{type(exc).__name__}")
            continue
        if not isinstance(payload, dict):
            errors.append(f"invalid_record:{path.relative_to(root).as_posix()}")
            continue
        record = dict(payload)
        record["_path"] = path.relative_to(root).as_posix()
        records.append(record)
    if not records:
        errors.append(f"no_json_evidence:{EVIDENCE_DIR}")
    return records, errors


def _evidence_checks(records: list[dict[str, Any]], *, signing_key: str | bytes | None) -> tuple[dict[str, Any], list[str]]:
    checks: dict[str, Any] = {name: False for name in REQUIRED_EVIDENCE}
    checks["files"] = []
    blockers: list[str] = []
    for record in records:
        path = str(record.get("_path") or "unknown")
        errors = validate_evidence_record(record, signing_key=signing_key)
        checks["files"].append({"path": path, "evidence_type": record.get("evidence_type"), "errors": errors})
        if errors:
            blockers.extend(f"evidence_invalid:{path}:{error}" for error in errors)
            continue
        evidence_type = record.get("evidence_type")
        if evidence_type == REQUIRED_EVIDENCE["codex_relay_agent"]:
            provider = record.get("provider_snapshot") or {}
            if provider.get("backend") == "codex" and provider.get("endpoint_mode") == "relay":
                checks["codex_relay_agent"] = True
        elif evidence_type == REQUIRED_EVIDENCE["gpt_image_generation"]:
            provider = record.get("provider_snapshot") or {}
            if provider.get("model") == "gpt-image-2" and provider.get("endpoint_mode") == "relay":
                checks["gpt_image_generation"] = True
        elif evidence_type == REQUIRED_EVIDENCE["gpt_image_edit"]:
            provider = record.get("provider_snapshot") or {}
            if provider.get("model") == "gpt-image-2" and provider.get("endpoint_mode") == "relay":
                checks["gpt_image_edit"] = True
    for name, passed in checks.items():
        if name != "files" and not passed:
            blockers.append(f"missing_evidence:{name}")
    return checks, blockers


def _has_evidence_type(records: list[dict[str, Any]], *types: str, signing_key: str | bytes | None) -> bool:
    return any(
        record.get("evidence_type") in types and not validate_evidence_record(record, signing_key=signing_key)
        for record in records
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _positive_dimension(value: object) -> bool:
    try:
        return int(value or 0) > 0
    except (TypeError, ValueError):
        return False


def _evidence_file(root: Path, relative: object) -> tuple[Path | None, str | None]:
    if not isinstance(relative, str) or not relative.strip():
        return None, "missing_path"
    candidate = Path(relative)
    if candidate.is_absolute():
        return None, "absolute_path"
    resolved = (root / candidate).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        return None, "path_escape"
    if resolved.is_symlink():
        return None, "symlink_not_allowed"
    return resolved, None


def validate_powerpoint_render_evidence(root: Path) -> dict[str, Any]:
    """Validate the checked-in-style local PowerPoint QA bundle by hashes."""
    relative = RENDER_EVIDENCE_PATH
    path = root / relative
    result: dict[str, Any] = {"path": relative, "passed": False, "errors": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        result["errors"] = [f"qa_json:{type(exc).__name__}"]
        return result
    if not isinstance(payload, dict):
        result["errors"] = ["qa_json:not_object"]
        return result
    errors: list[str] = []
    if payload.get("status") != "passed":
        errors.append("status_not_passed")
    export_qa = payload.get("export_qa")
    if not isinstance(export_qa, dict):
        errors.append("export_qa_missing")
    else:
        for field in ("render_status", "pptx_qa_status", "svg_qa_status"):
            if export_qa.get(field) != "passed":
                errors.append(f"export_qa_{field}_not_passed")
        if payload.get("status") == "passed" and export_qa.get("render_status") != "passed":
            errors.append("status_render_status_conflict")
    probe = payload.get("powerpoint_probe")
    if not isinstance(probe, dict) or probe.get("status") != "ready" or not str(probe.get("version") or "").strip():
        errors.append("powerpoint_probe_not_ready")
    pptx_path, path_error = _evidence_file(root / Path(relative).parent, payload.get("pptx_path"))
    if path_error or pptx_path is None:
        errors.append(f"pptx_path:{path_error or 'invalid'}")
    elif not pptx_path.is_file():
        errors.append("pptx_missing")
    else:
        actual = _sha256_file(pptx_path)
        if actual != str(payload.get("pptx_sha256") or "").lower():
            errors.append("pptx_sha256_mismatch")
    pages = payload.get("pages")
    if not isinstance(pages, list) or not pages:
        errors.append("pages_missing")
    else:
        for index, page in enumerate(pages):
            if not isinstance(page, dict):
                errors.append(f"page[{index}]:not_object")
                continue
            page_path, page_error = _evidence_file(root / Path(relative).parent, page.get("path"))
            if page_error or page_path is None:
                errors.append(f"page[{index}].path:{page_error or 'invalid'}")
                continue
            if not page_path.is_file():
                errors.append(f"page[{index}].missing")
                continue
            if _sha256_file(page_path) != str(page.get("sha256") or "").lower():
                errors.append(f"page[{index}].sha256_mismatch")
            if not _positive_dimension(page.get("width")) or not _positive_dimension(page.get("height")):
                errors.append(f"page[{index}].invalid_dimensions")
    result["errors"] = errors
    result["passed"] = not errors
    return result


def _command_result(command: list[str], root: Path) -> tuple[bool, str]:
    try:
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError as exc:
        return False, type(exc).__name__
    return result.returncode == 0, ((result.stdout or "") + (result.stderr or "")).strip()


def _read_release_env_file(path: Path) -> str:
    """Read the release-proof key from an explicitly selected env file only."""

    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise ValueError(f"Cannot read release evidence env file: {path}") from exc
    value: str | None = None
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, candidate = line.partition("=")
        if not separator or key.strip() != "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY":
            raise ValueError(
                f"Release evidence env file line {line_number} must contain only FASTPPT_RELEASE_EVIDENCE_HMAC_KEY"
            )
        candidate = candidate.strip()
        if len(candidate) >= 2 and candidate[0] == candidate[-1] and candidate[0] in {"'", '"'}:
            candidate = candidate[1:-1]
        if not candidate:
            raise ValueError("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY must not be empty")
        value = candidate
    if value is None:
        raise ValueError("Release evidence env file is missing FASTPPT_RELEASE_EVIDENCE_HMAC_KEY")
    return value


def audit_release(root: Path = ROOT, *, signing_key: str | bytes | None = None) -> dict[str, Any]:
    root = root.resolve()
    records, load_errors = _load_evidence(root)
    evidence_checks, evidence_blockers = _evidence_checks(records, signing_key=signing_key)
    blockers = list(load_errors) + evidence_blockers

    hygiene_ok, hygiene_output = _command_result([sys.executable, str(root / "tools" / "check_repo_hygiene.py")], root)
    if not hygiene_ok:
        blockers.append("repository_hygiene_failed")

    status_ok, status_output = _command_result(["git", "status", "--porcelain"], root)
    dirty = bool(status_output.strip()) if status_ok else True
    if dirty:
        blockers.append("worktree_dirty")

    tag_ok, tag_output = _command_result(["git", "rev-parse", f"{VERSION}^{{commit}}"], root)
    head_ok, head_output = _command_result(["git", "rev-parse", "HEAD"], root)
    tag_matches_head = tag_ok and head_ok and tag_output.strip() == head_output.strip()
    if not tag_matches_head:
        blockers.append("v1.2.0_tag_missing_or_not_at_head")

    server_evidence = _has_evidence_type(
        records,
        "server_postgres_s3_multi_instance",
        "real_server_backend_integration",
        signing_key=signing_key,
    )
    render_record = validate_powerpoint_render_evidence(root)
    render_evidence = _has_evidence_type(
        records,
        "real_powerpoint_render_qa",
        "windows_render_worker_qa",
        signing_key=signing_key,
    ) or render_record["passed"]
    checks = {
        "provider_evidence": evidence_checks,
        "repository_hygiene": {"passed": hygiene_ok, "output": hygiene_output[-2000:]},
        "worktree": {"clean": not dirty},
        "tag": {"name": VERSION, "matches_head": tag_matches_head},
        "server_integration": {"verifiable": server_evidence, "reason": None if server_evidence else "PostgreSQL/MinIO evidence is supplied by CI or an external environment"},
        "powerpoint_render": {
            "available": bool(shutil.which("POWERPNT.EXE") or shutil.which("powerpnt") or shutil.which("soffice")) or render_evidence,
            "evidence": render_record,
        },
    }
    if not checks["server_integration"]["verifiable"]:
        blockers.append("server_integration_evidence_unavailable")
    if not checks["powerpoint_render"]["available"]:
        blockers.append("authoritative_render_worker_unavailable")
    return {
        "product": "FastPPT",
        "version": VERSION,
        "status": "passed" if not blockers else "blocked",
        "checks": checks,
        "blockers": sorted(set(blockers)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Explicit local env file containing only FASTPPT_RELEASE_EVIDENCE_HMAC_KEY; never committed",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        signing_key = _read_release_env_file(args.env_file.resolve()) if args.env_file else os.environ.get("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY")
        result = audit_release(args.root, signing_key=signing_key)
    except ValueError as exc:
        print(f"release evidence configuration failed: {exc}", file=sys.stderr)
        return 2
    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"{result['product']} {result['version']}: {result['status']}")
        for blocker in result["blockers"]:
            print(f"BLOCKER {blocker}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
