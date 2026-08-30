#!/usr/bin/env python3
"""Collect one real GPT-image-2 relay evidence record.

The command deliberately uses a temporary local runtime and synthetic input
only. It writes a redacted ImageAttempt evidence record only after the real
provider request has completed and the evidence contract is valid.
"""

from __future__ import annotations

import argparse
import base64
from datetime import UTC, datetime
import io
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastppt_core.ids import new_id
from fastppt_runtime.bootstrap import build_runtime
from fastppt_runtime.config import ConfigurationError, RuntimeSettings
from fastppt_runtime.service import ConflictError
from tools.check_release_gates import validate_evidence_record
from tools.evidence_proof import sign_evidence_record


_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}")
_SECRET = re.compile(r"(?i)\b(?:sk|sess|pat|ghp|github_pat)-[A-Za-z0-9_-]{16,}\b")
_ENV_KEYS = frozenset(
    {
        "FASTPPT_IMAGE_ENDPOINT_MODE",
        "FASTPPT_IMAGE_BASE_URL",
        "FASTPPT_IMAGE_API_KEY",
        "FASTPPT_MODEL_API_KEY",
        "FASTPPT_IMAGE_PROTOCOL",
        "FASTPPT_IMAGE_MODEL",
        "FASTPPT_IMAGE_TIMEOUT_SECONDS",
        "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY",
    }
)
_REFERENCE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _safe_error(value: object) -> str:
    message = str(value)
    message = _BEARER.sub("Bearer [REDACTED]", message)
    return _SECRET.sub("[REDACTED]", message)


def _read_env_file(path: Path) -> dict[str, str]:
    """Read only image-provider settings from an explicit local env file."""

    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise ConfigurationError(f"Cannot read image provider env file: {path}") from exc
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key or key not in _ENV_KEYS:
            raise ConfigurationError(
                f"Image provider env file line {line_number} must contain only supported image-provider or release-proof keys"
            )
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _synthetic_reference() -> bytes:
    """Return a valid small RGB PNG without reading user files."""

    try:
        from PIL import Image
    except ImportError:
        return _REFERENCE_PNG
    image = Image.new("RGB", (64, 36), (18, 107, 82))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def collect(mode: str, output_dir: Path, *, env_file: Path | None = None) -> Path:
    if mode not in {"generation", "edit"}:
        raise ValueError("mode must be generation or edit")

    with TemporaryDirectory(prefix="fastppt-image-evidence-") as temporary:
        runtime_env = dict(os.environ)
        if env_file is not None:
            runtime_env.update(_read_env_file(env_file.resolve()))
        runtime_env.update({
            "FASTPPT_DEPLOYMENT_MODE": "local",
            "FASTPPT_DATA_DIR": str(Path(temporary) / "data"),
            "FASTPPT_TEMP_DIR": str(Path(temporary) / "tmp"),
            "FASTPPT_EXPORT_DIR": str(Path(temporary) / "exports"),
            "FASTPPT_AGENT_BACKEND": "unconfigured",
            "FASTPPT_IMAGE_MODEL": "gpt-image-2",
        })
        signing_key = str(runtime_env.get("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY") or "")
        if not signing_key:
            raise ConfigurationError("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY is required before collecting provider evidence")
        settings = RuntimeSettings.load(runtime_env, root=ROOT)
        if not settings.image.api_key:
            raise ConfigurationError("FASTPPT_IMAGE_API_KEY or FASTPPT_MODEL_API_KEY is required")
        if settings.image.endpoint_mode.value != "relay":
            raise ConfigurationError("FASTPPT_IMAGE_ENDPOINT_MODE must be relay for release evidence")
        if settings.image.model != "gpt-image-2":
            raise ConfigurationError("FASTPPT_IMAGE_MODEL must be gpt-image-2 for release evidence")
        settings.prepare_directories()
        runtime = build_runtime(settings)
        owner = runtime.store.ensure_local_user()
        project = runtime.service.create_project(owner["user_id"], f"Provider evidence {mode}")
        project_id = project["project_id"]
        purpose = "image_edit" if mode == "edit" else "full_slide_reference"

        contract = runtime.service._record_artifact(
            project_id,
            "contract",
            json.dumps(
                {
                    "page_id": f"evidence_{mode}",
                    "title": "Synthetic provider evidence slide",
                    "conclusion": "This content is generated only for provider verification.",
                    "verbatim_text": ["GPT-image-2 provider evidence"],
                    "compressible_content": ["Synthetic provider verification content."],
                    "required_fact_ids": [],
                    "page_size": {"width": 13.333, "height": 7.5, "unit": "inch"},
                    "design_snapshot": {"selection_source": "none"},
                },
                ensure_ascii=False,
                sort_keys=True,
            ).encode("utf-8"),
            "application/json",
        )
        input_ids: list[str] = []
        input_hashes: list[str] = []
        if mode == "edit":
            reference = runtime.service._record_artifact(project_id, "image", _synthetic_reference(), "image/png")
            input_ids.append(reference["artifact_id"])
            input_hashes.append(reference["sha256"])

        image_run_id = new_id("image_run")
        provider_snapshot = runtime.service._image_settings_for(project_id, purpose)[2]
        resolved = runtime.service.context_resolver.resolve(
            project_id=project_id,
            role="image_prompt",
            task_id=image_run_id,
            session_id=None,
            parent_run_id=None,
            input_artifact_ids=[contract["artifact_id"], *input_ids],
            user_prompt=(
                "Generate one synthetic presentation slide reference for provider verification."
                if mode == "generation"
                else "Edit the supplied synthetic reference into one presentation slide reference for provider verification."
            ),
            output_schema={"type": "image", "allowed_media_types": ["image/png", "image/jpeg", "image/webp"]},
            provider_snapshot=provider_snapshot,
            explicit_context={"design_snapshot": {"selection_source": "none"}},
        )
        _envelope, prompt_artifacts = runtime.service._persist_resolved_prompt(project_id, image_run_id, resolved)
        run = runtime.service.create_image_run(owner["user_id"], project_id, {
            "image_run_id": image_run_id,
            "purpose": purpose,
            "prompt_artifact_id": prompt_artifacts["prompt"]["artifact_id"],
            "input_artifact_ids": input_ids,
            "input_hashes": input_hashes,
        })
        completed = runtime.service.execute_image_run(owner["user_id"], project_id, run["image_run_id"])
        if completed.get("status") != "completed":
            attempts = runtime.store.list_image_attempts(project_id, run["image_run_id"])
            latest_error = attempts[-1].get("error") if attempts else None
            if isinstance(latest_error, dict):
                code = latest_error.get("code") or "unknown"
                message = latest_error.get("message") or "provider request did not complete"
                raise ConflictError(
                    f"ImageRun did not complete: {completed.get('status')} ({code}: {_safe_error(message)})"
                )
            raise ConflictError(f"ImageRun did not complete: {completed.get('status')}")
        attempt = runtime.store.list_image_attempts(project_id, run["image_run_id"])[-1]
        evidence = runtime.service._provider_evidence_for_image_attempt(project_id, completed, attempt)
        if not evidence:
            raise ConflictError("Completed ImageAttempt did not produce provider evidence")
        evidence = sign_evidence_record(evidence, signing_key)
        errors = validate_evidence_record(evidence, signing_key=signing_key)
        if errors:
            raise ConflictError("Provider evidence contract failed: " + ", ".join(errors))

        output_dir = output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        output_path = output_dir / f"gpt-image2-{mode}-{stamp}-{attempt['image_attempt_id']}.json"
        output_path.write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("generation", "edit"))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output" / "provider-evidence")
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Explicit local env file containing only image-provider settings; never committed",
    )
    args = parser.parse_args(argv)
    try:
        path = collect(args.mode, args.output_dir, env_file=args.env_file)
    except (ConfigurationError, ConflictError, OSError, ValueError, RuntimeError) as exc:
        print(f"provider evidence collection failed: {_safe_error(exc)}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "completed", "evidence_path": path.as_posix()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
