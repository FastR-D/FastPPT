"""Staging, hash verification and reconciliation for v2 Artifacts."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import os
import re
from typing import Any, Callable


class ArtifactCommitError(RuntimeError):
    code = "ARTIFACT_COMMIT_INCOMPLETE"


class ArtifactMissingError(ArtifactCommitError):
    code = "ARTIFACT_MISSING"


@dataclass(frozen=True, slots=True)
class StagedArtifact:
    project_id: str
    artifact_id: str
    idempotency_key: str
    staging_path: Path
    sha256: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class RecoveryCheckpoint:
    job_id: str
    stage: str
    input_hash: str
    committed_outputs: tuple[str, ...]
    idempotency_key: str
    schema_version: str = "2.0.0"
    required_capabilities: tuple[str, ...] = ("recovery",)

    def to_dict(self) -> dict[str, Any]:
        value = {"schema_version": self.schema_version, "required_capabilities": list(self.required_capabilities), "job_id": self.job_id, "stage": self.stage, "input_hash": self.input_hash, "committed_outputs": list(self.committed_outputs), "idempotency_key": self.idempotency_key, "content_hash": ""}
        value["content_hash"] = "sha256:" + hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        return value


class ArtifactCommitManager:
    """Filesystem implementation of staging -> verify -> publish -> reconcile."""

    _TOKEN = re.compile(r"^[A-Za-z0-9._-]{1,200}$")

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.staging_root = self.root / "staging"
        self.published_root = self.root / "published"
        self.record_root = self.root / "commits"
        for path in (self.staging_root, self.published_root, self.record_root):
            path.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _check_token(cls, value: str, name: str) -> str:
        if not isinstance(value, str) or not cls._TOKEN.fullmatch(value) or value in {".", ".."}:
            raise ValueError(f"{name} is invalid")
        return value

    @staticmethod
    def _digest(content: bytes) -> str:
        return "sha256:" + hashlib.sha256(content).hexdigest()

    def _record_path(self, project_id: str, idempotency_key: str, artifact_id: str) -> Path:
        return self.record_root / project_id / idempotency_key / f"{artifact_id}.json"

    def _legacy_record_path(self, project_id: str, idempotency_key: str) -> Path:
        return self.record_root / f"{project_id}-{idempotency_key}.json"

    def stage(self, project_id: str, artifact_id: str, content: bytes, idempotency_key: str) -> StagedArtifact:
        project_id = self._check_token(project_id, "project_id")
        artifact_id = self._check_token(artifact_id, "artifact_id")
        idempotency_key = self._check_token(idempotency_key, "idempotency_key")
        directory = self.staging_root / project_id / idempotency_key
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{artifact_id}.part"
        if target.is_file() and target.read_bytes() != content:
            raise ArtifactCommitError("idempotency key was already staged with different artifact bytes")
        target.write_bytes(content)
        digest = self._digest(content)
        return StagedArtifact(project_id, artifact_id, idempotency_key, target, digest, len(content))

    def verify(self, staged: StagedArtifact, expected_sha256: str | None = None) -> bool:
        if not staged.staging_path.is_file():
            raise ArtifactMissingError("staged artifact is missing")
        digest = self._digest(staged.staging_path.read_bytes())
        if digest != staged.sha256 or expected_sha256 and digest != expected_sha256:
            raise ArtifactCommitError("staged artifact hash verification failed")
        return True

    def publish(self, staged: StagedArtifact) -> Path:
        self.verify(staged)
        directory = self.published_root / staged.project_id
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / staged.artifact_id
        if target.is_file():
            if self._digest(target.read_bytes()) != staged.sha256:
                raise ArtifactCommitError("immutable artifact path already contains different bytes")
            return target
        part = target.with_suffix(target.suffix + ".part")
        part.write_bytes(staged.staging_path.read_bytes())
        os.replace(part, target)
        return target

    def commit(self, staged: StagedArtifact, *, db_commit: Callable[[dict[str, Any]], Any] | None = None) -> dict[str, Any]:
        self.verify(staged)
        record_path = self._record_path(staged.project_id, staged.idempotency_key, staged.artifact_id)
        existing_path = record_path
        if not existing_path.is_file():
            legacy_path = self._legacy_record_path(staged.project_id, staged.idempotency_key)
            if legacy_path.is_file():
                try:
                    legacy_record = json.loads(legacy_path.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ArtifactCommitError("artifact commit record is corrupt") from exc
                if legacy_record.get("artifact_id") == staged.artifact_id:
                    existing_path = legacy_path
        if existing_path.is_file():
            try:
                record = json.loads(existing_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ArtifactCommitError("artifact commit record is corrupt") from exc
            if record.get("sha256") != staged.sha256 or record.get("artifact_id") != staged.artifact_id:
                raise ArtifactCommitError("idempotency key was already committed with different artifact")
            storage_path = self.root / str(record.get("storage_path") or "")
            if not storage_path.is_file() or self._digest(storage_path.read_bytes()) != staged.sha256:
                raise ArtifactMissingError("committed artifact bytes are missing")
            return record
        target = self.publish(staged)
        record = {"schema_version": "2.0.0", "project_id": staged.project_id, "artifact_id": staged.artifact_id, "idempotency_key": staged.idempotency_key, "staging_path": str(staged.staging_path.relative_to(self.root)).replace("\\", "/"), "storage_path": str(target.relative_to(self.root)).replace("\\", "/"), "sha256": staged.sha256, "size_bytes": staged.size_bytes, "status": "published", "content_hash": ""}
        record["content_hash"] = "sha256:" + hashlib.sha256(json.dumps({key: value for key, value in record.items() if key != "content_hash"}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if db_commit is not None:
            db_commit(dict(record))
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return record

    def reconcile(self, project_id: str, idempotency_key: str, *, db_committed: bool = False) -> dict[str, Any]:
        project_id = self._check_token(project_id, "project_id")
        idempotency_key = self._check_token(idempotency_key, "idempotency_key")
        record_paths: list[Path] = []
        record_dir = self.record_root / project_id / idempotency_key
        if record_dir.is_dir():
            record_paths.extend(sorted(record_dir.glob("*.json")))
        legacy_path = self._legacy_record_path(project_id, idempotency_key)
        if legacy_path.is_file():
            record_paths.append(legacy_path)

        def read_record(path: Path) -> dict[str, Any]:
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ArtifactCommitError("artifact commit record is corrupt") from exc
            storage_path = self.root / str(record.get("storage_path") or "")
            expected = str(record.get("sha256") or "")
            if not storage_path.is_file() or self._digest(storage_path.read_bytes()) != expected:
                raise ArtifactMissingError("committed artifact bytes are missing")
            return record

        staging_dir = self.staging_root / project_id / idempotency_key
        parts = sorted(staging_dir.glob("*.part")) if staging_dir.is_dir() else []
        if record_paths and not parts:
            records = [read_record(path) for path in record_paths]
            if len(records) == 1:
                return records[0]
            return {"status": "reconciled", "artifacts": records, "project_id": project_id, "idempotency_key": idempotency_key}
        if db_committed and not parts:
            raise ArtifactMissingError("database commit exists but staged artifact is missing")
        if not parts:
            return {"status": "nothing_to_reconcile", "project_id": project_id, "idempotency_key": idempotency_key}
        artifacts = []
        for part in parts:
            artifact_id = self._check_token(part.name.removesuffix(".part"), "artifact_id")
            staged = StagedArtifact(project_id, artifact_id, idempotency_key, part, self._digest(part.read_bytes()), part.stat().st_size)
            artifacts.append(self.commit(staged))
        if record_paths and len(artifacts) == 1:
            return artifacts[0]
        return {"status": "reconciled", "artifacts": artifacts, "project_id": project_id, "idempotency_key": idempotency_key}


ArtifactStagingStore = ArtifactCommitManager


__all__ = ["ArtifactCommitError", "ArtifactMissingError", "StagedArtifact", "RecoveryCheckpoint", "ArtifactCommitManager", "ArtifactStagingStore"]
