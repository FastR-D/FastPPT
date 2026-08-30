#!/usr/bin/env python3
"""Collect one real Codex relay structured-Agent evidence record.

The command uses a temporary local runtime and a short synthetic source. It
writes a redacted AgentRun evidence record only after the relay request,
strict output validation, and evidence proof validation have all completed.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastppt_agent_harness.harness import AgentBackend, EndpointMode
from fastppt_runtime.bootstrap import build_runtime
from fastppt_runtime.config import ConfigurationError, RuntimeSettings
from fastppt_runtime.service import ConflictError
from tools.check_release_gates import validate_evidence_record
from tools.evidence_proof import sign_evidence_record


_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}")
_SECRET = re.compile(r"(?i)\b(?:sk|sess|pat|ghp|github_pat)-[A-Za-z0-9_-]{16,}\b")
_ENV_KEYS = frozenset(
    {
        # The shared ignored .env.local may also contain the image relay
        # settings used by the companion collector. They are accepted here
        # and passed through, while the Agent backend and endpoint remain
        # forced below.
        "FASTPPT_AGENT_BACKEND",
        "FASTPPT_MODEL_ENDPOINT_MODE",
        "FASTPPT_MODEL",
        "FASTPPT_MODEL_BASE_URL",
        "FASTPPT_MODEL_API_KEY",
        "FASTPPT_MODEL_REASONING_EFFORT",
        "FASTPPT_MODEL_TIMEOUT_SECONDS",
        "FASTPPT_IMAGE_ENDPOINT_MODE",
        "FASTPPT_IMAGE_BASE_URL",
        "FASTPPT_IMAGE_API_KEY",
        "FASTPPT_IMAGE_PROTOCOL",
        "FASTPPT_IMAGE_MODEL",
        "FASTPPT_IMAGE_TIMEOUT_SECONDS",
        "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY",
    }
)


def _safe_error(value: object) -> str:
    """Redact common token forms before a command-line error is reported."""

    message = str(value)
    message = _BEARER.sub("Bearer [REDACTED]", message)
    return _SECRET.sub("[REDACTED]", message)


def _read_env_file(path: Path) -> dict[str, str]:
    """Read only Agent relay and release-proof settings from an explicit file."""

    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise ConfigurationError(f"Cannot read Agent provider env file: {path}") from exc
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
                f"Agent provider env file line {line_number} must contain only supported Agent relay or release-proof keys"
            )
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def collect(output_dir: Path, *, env_file: Path | None = None) -> Path:
    """Execute one synthetic source analysis through the configured Codex relay."""

    with TemporaryDirectory(prefix="fastppt-agent-evidence-") as temporary:
        runtime_env = dict(os.environ)
        if env_file is not None:
            runtime_env.update(_read_env_file(env_file.resolve()))
        runtime_env.update(
            {
                "FASTPPT_DEPLOYMENT_MODE": "local",
                "FASTPPT_DATA_DIR": str(Path(temporary) / "data"),
                "FASTPPT_TEMP_DIR": str(Path(temporary) / "tmp"),
                "FASTPPT_EXPORT_DIR": str(Path(temporary) / "exports"),
                # Release evidence must exercise the actual Codex relay path;
                # do not inherit a different configured backend or endpoint.
                "FASTPPT_AGENT_BACKEND": AgentBackend.CODEX.value,
                "FASTPPT_MODEL_ENDPOINT_MODE": EndpointMode.RELAY.value,
                "FASTPPT_IMAGE_API_KEY": "",
            }
        )
        signing_key = str(runtime_env.get("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY") or "")
        if not signing_key:
            raise ConfigurationError("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY is required before collecting provider evidence")
        settings = RuntimeSettings.load(runtime_env, root=ROOT)
        settings.agent.validate(production=True)
        if settings.agent.backend != AgentBackend.CODEX or settings.agent.endpoint_mode != EndpointMode.RELAY:
            raise ConfigurationError("Codex relay settings are required for Agent provider evidence")
        settings.prepare_directories()
        runtime = build_runtime(settings)
        owner = runtime.store.ensure_local_user()
        project = runtime.service.create_project(owner["user_id"], "Codex relay provider evidence")
        project_id = project["project_id"]
        source = runtime.service.create_source_text(
            owner["user_id"],
            project_id,
            "FastPPT evidence source: release verification requires a structured source analysis with no user content.",
        )
        run = runtime.service.create_agent_run_record(
            owner["user_id"],
            project_id,
            {
                "role": "source_analyst",
                "input_artifact_ids": [source["artifact_id"]],
                "prompt": "Analyze the supplied synthetic source and return the required structured source analysis.",
                "context": {
                    "source_metadata": {"document_count": 1, "purpose": "provider_evidence"},
                    "user_options": {
                        "language": "en-US",
                        "audience": "release auditors",
                        "purpose": "provider verification",
                        "page_count": {"mode": "exact", "exact": 1},
                    },
                },
                "metadata": {"evidence_collection": True},
            },
        )
        completed = runtime.service.execute_agent_run_record(
            owner["user_id"],
            project_id,
            run["agent_run_id"],
            {"event_metadata": {"evidence_collection": True}},
        )
        if completed.get("status") != "completed":
            raise ConflictError("AgentRun did not complete")
        evidence = runtime.service._provider_evidence_for_agent_run(project_id, completed)
        if not evidence:
            raise ConflictError("Completed AgentRun did not produce provider evidence")
        evidence = sign_evidence_record(evidence, signing_key)
        errors = validate_evidence_record(evidence, signing_key=signing_key)
        if errors:
            raise ConflictError("Provider evidence contract failed: " + ", ".join(errors))

        output_dir = output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        output_path = output_dir / f"codex-relay-agent-{stamp}-{run['agent_run_id']}.json"
        output_path.write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output" / "provider-evidence")
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Explicit local env file containing only Codex relay settings; never committed",
    )
    args = parser.parse_args(argv)
    try:
        path = collect(args.output_dir, env_file=args.env_file)
    except ConfigurationError as exc:
        print(f"agent provider evidence collection failed: {_safe_error(exc)}", file=sys.stderr)
        return 1
    except (ConflictError, OSError, RuntimeError, ValueError):
        # Provider SDK errors can contain relay details. Keep command output
        # redacted and preserve only completed evidence records.
        print("agent provider evidence collection failed: provider request or evidence validation failed", file=sys.stderr)
        return 1
    print(json.dumps({"status": "completed", "evidence_path": path.as_posix()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
