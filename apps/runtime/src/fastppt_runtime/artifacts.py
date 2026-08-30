"""Private artifact stores; storage keys never cross the API boundary."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

from fastppt_core.paths import resolve_inside


@dataclass(frozen=True, slots=True)
class StoredObject:
    storage_key: str
    sha256: str
    size_bytes: int


class ArtifactStore(Protocol):
    def put(self, project_id: str, object_id: str, content: bytes) -> StoredObject: ...
    def open(self, storage_key: str) -> BinaryIO: ...
    def delete(self, storage_key: str) -> None: ...
    def health(self) -> dict[str, str]: ...


class FilesystemArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, project_id: str, object_id: str, content: bytes) -> StoredObject:
        logical = f"{project_id}/{object_id}"
        target = resolve_inside(self.root, logical)
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        part.write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        part.replace(target)
        return StoredObject(logical, digest, len(content))

    def open(self, storage_key: str) -> BinaryIO:
        return resolve_inside(self.root, storage_key).open("rb")

    def delete(self, storage_key: str) -> None:
        resolve_inside(self.root, storage_key).unlink(missing_ok=True)

    def health(self) -> dict[str, str]:
        return {"status": "ready" if self.root.is_dir() else "failed", "backend": "filesystem"}


class S3ArtifactStore:
    def __init__(self, *, endpoint: str, bucket: str, region: str, access_key: str, secret_key: str) -> None:
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("Install the 'server' extra for S3 support") from exc
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

    def put(self, project_id: str, object_id: str, content: bytes) -> StoredObject:
        storage_key = f"projects/{project_id}/{object_id}"
        digest = hashlib.sha256(content).hexdigest()
        self.client.put_object(Bucket=self.bucket, Key=storage_key, Body=content, Metadata={"sha256": digest})
        return StoredObject(storage_key, digest, len(content))

    def open(self, storage_key: str) -> BinaryIO:
        payload = self.client.get_object(Bucket=self.bucket, Key=storage_key)["Body"].read()
        return io.BytesIO(payload)

    def delete(self, storage_key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=storage_key)

    def health(self) -> dict[str, str]:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return {"status": "ready", "backend": "s3"}
        except Exception as exc:
            return {"status": "failed", "backend": "s3", "detail": str(exc)}


def build_artifact_store(settings: object) -> ArtifactStore:
    if getattr(settings, "artifact_store") == "filesystem":
        return FilesystemArtifactStore(getattr(settings, "data_dir") / "artifacts")
    if getattr(settings, "artifact_store") == "s3":
        return S3ArtifactStore(
            endpoint=getattr(settings, "s3_endpoint"),
            bucket=getattr(settings, "s3_bucket"),
            region=getattr(settings, "s3_region"),
            access_key=getattr(settings, "s3_access_key"),
            secret_key=getattr(settings, "s3_secret_key"),
        )
    raise RuntimeError("Unsupported artifact store configuration")
