"""Atomic, private DesignPack Bundle validation and extraction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
from tempfile import TemporaryDirectory
from typing import Any, Mapping
from zipfile import BadZipFile, ZipFile, ZipInfo

from fastppt_core.design import bundle_content_hash, pack_content_hash, validate_pack_manifest


MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_BUNDLE_BYTES = 200 * 1024 * 1024
MAX_MEMBERS = 1000
EXECUTABLE_SUFFIXES = frozenset({".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh", ".js", ".mjs", ".py", ".com", ".scr", ".msi", ".jar"})


def normalize_directory_upload_path(name: str) -> str:
    """Validate one client-supplied directory-upload path before remapping it.

    Browser directory uploads commonly include one relative top-level folder.
    That folder may be removed by the HTTP layer, but only after this function
    establishes that the original client path was portable and relative.
    """

    raw = str(name)
    normalized = raw.replace("\\", "/")
    if not normalized or "\x00" in normalized or any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise ValueError("Design Bundle directory upload path is malformed")
    return _safe_path(normalized).as_posix()


def _safe_path(name: str, *, mode: int = 0) -> PurePosixPath:
    name = str(name).replace("\\", "/")
    path = PurePosixPath(name)
    if not name or name.startswith("/") or ".." in path.parts or any(":" in part for part in path.parts):
        raise ValueError("Design Bundle contains an unsafe path")
    if stat.S_ISLNK(mode):
        raise ValueError("Design Bundle cannot contain symbolic links")
    if path.suffix.casefold() in EXECUTABLE_SUFFIXES:
        raise ValueError("Design Bundle cannot contain executable or script files")
    return path


def _safe_name(info: ZipInfo) -> PurePosixPath:
    return _safe_path(info.filename, mode=info.external_attr >> 16)


def _validate_media(path: PurePosixPath, content: bytes) -> None:
    suffix = path.suffix.casefold()
    if suffix == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"PNG content does not match its suffix: {path}")
    if suffix in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise ValueError(f"JPEG content does not match its suffix: {path}")
    if suffix == ".webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
        raise ValueError(f"WebP content does not match its suffix: {path}")
    if suffix == ".json":
        try:
            json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"JSON resource is invalid: {path}") from exc
    if suffix == ".svg":
        try:
            markup = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"SVG resource is not UTF-8: {path}") from exc
        lowered = markup.casefold()
        if "<svg" not in lowered or any(marker in lowered for marker in ("<script", "<foreignobject", "javascript:", "http://", "https://", "file://")):
            raise ValueError(f"SVG resource contains active or external content: {path}")


def _member_file_names(manifest_path: PurePosixPath, files: dict[str, bytes], manifest_paths: set[str]) -> list[str]:
    manifest_name = manifest_path.as_posix()
    parent = manifest_path.parent
    if parent == PurePosixPath("."):
        return sorted(name for name in files if name != "bundle_manifest.json" and name not in manifest_paths)
    prefix = parent.as_posix().rstrip("/") + "/"
    return sorted(name for name in files if name.startswith(prefix) and name != manifest_name)


def _bundle_files(content: bytes | Path | Mapping[str, bytes]) -> dict[str, bytes]:
    """Read a ZIP, directory, or already-decoded HTTP directory upload."""
    files: dict[str, bytes] = {}
    normalized_names: set[str] = set()
    total = 0

    def add(name: str, value: bytes, *, mode: int = 0) -> None:
        nonlocal total
        path = _safe_path(name, mode=mode)
        normalized = path.as_posix().casefold()
        if normalized in normalized_names:
            raise ValueError("Design Bundle contains duplicate or case-colliding paths")
        if not isinstance(value, bytes):
            raise ValueError(f"Design Bundle member is not binary: {path}")
        if len(value) > MAX_FILE_BYTES:
            raise ValueError(f"Design Bundle member exceeds the 25 MB limit: {path}")
        total += len(value)
        if total > MAX_BUNDLE_BYTES:
            raise ValueError("Design Bundle expands beyond the 200 MB limit")
        normalized_names.add(normalized)
        _validate_media(path, value)
        files[path.as_posix()] = value

    if isinstance(content, bytes):
        if not content or len(content) > MAX_BUNDLE_BYTES:
            raise ValueError("Design Bundle is empty or exceeds the 200 MB limit")
        from io import BytesIO
        try:
            with ZipFile(BytesIO(content)) as bundle:
                infos = bundle.infolist()
                if len(infos) > MAX_MEMBERS:
                    raise ValueError("Design Bundle contains too many files")
                for info in infos:
                    path = _safe_name(info)
                    if info.is_dir():
                        continue
                    if info.flag_bits & 0x1:
                        raise ValueError("Design Bundle cannot contain encrypted members")
                    add(path.as_posix(), bundle.read(info))
        except BadZipFile as exc:
            raise ValueError("Design Bundle is not a valid ZIP archive") from exc
    elif isinstance(content, Mapping):
        if not content or len(content) > MAX_MEMBERS:
            raise ValueError("Design Bundle is empty or contains too many files")
        for name, value in content.items():
            add(str(name), value)
    else:
        directory = Path(content)
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("Design Bundle directory is unavailable")
        entries = list(directory.rglob("*"))
        if any(path.is_symlink() for path in entries):
            raise ValueError("Design Bundle cannot contain symbolic links")
        candidates = [path for path in entries if path.is_file()]
        if len(candidates) > MAX_MEMBERS:
            raise ValueError("Design Bundle contains too many files")
        for path in candidates:
            relative = path.relative_to(directory).as_posix()
            add(relative, path.read_bytes())
    return files


def validate_bundle(content: bytes | Path | Mapping[str, bytes], owner_id: str) -> dict[str, Any]:
    files = _bundle_files(content)
    if "bundle_manifest.json" not in files:
        raise ValueError("Design Bundle is missing bundle_manifest.json")
    root = json.loads(files["bundle_manifest.json"].decode("utf-8"))
    required = {"bundle_id", "schema_version", "display_name", "version", "content_hash", "members"}
    missing = sorted(required.difference(root))
    if missing or root.get("schema_version") != "1.0" or not isinstance(root.get("members"), list) or not root["members"]:
        raise ValueError("Bundle Manifest is missing required v1.0 fields")
    if bundle_content_hash(root) != root.get("content_hash"):
        raise ValueError("Bundle content_hash does not match its Manifest")
    members: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    manifest_paths = {PurePosixPath(str(item.get("manifest_path") or "")).as_posix() for item in root["members"] if isinstance(item, dict)}
    for member in root["members"]:
        if not isinstance(member, dict):
            raise ValueError("Bundle member entries must be objects")
        manifest_path = PurePosixPath(str(member.get("manifest_path") or ""))
        if manifest_path.as_posix() not in files or ".." in manifest_path.parts:
            raise ValueError("Bundle member Manifest path is unavailable")
        payload = json.loads(files[manifest_path.as_posix()].decode("utf-8"))
        clean = validate_pack_manifest(payload, owner_id=owner_id, expected_kind=str(member.get("pack_kind") or ""), expected_hash=str(member.get("content_hash") or ""))
        if clean["pack_id"] != member.get("pack_id") or clean["version"] != str(member.get("version") or ""):
            raise ValueError("Bundle membership does not match the Pack Manifest")
        resource_hashes = {
            (PurePosixPath(name).name if manifest_path.parent == PurePosixPath(".") else PurePosixPath(name).relative_to(manifest_path.parent).as_posix()): hashlib.sha256(files[name]).hexdigest()
            for name in _member_file_names(manifest_path, files, manifest_paths)
        }
        if pack_content_hash(clean, resource_hashes) != clean["content_hash"]:
            raise ValueError(f"Pack content_hash does not match its resources: {clean['pack_id']}")
        preview_ids = list(clean.get("preview_artifact_ids") or [])
        for preview_id in preview_ids:
            preview = PurePosixPath(preview_id)
            if preview.is_absolute() or ".." in preview.parts or preview.as_posix() not in resource_hashes:
                raise ValueError("Pack preview_artifact_ids must reference bundled member resources")
            if preview.suffix.casefold() not in {".png", ".jpg", ".jpeg", ".webp"}:
                raise ValueError("Pack previews must use PNG, JPEG, or WebP resources")
        key = (clean["pack_id"], clean["version"])
        if key in seen:
            raise ValueError("Design Bundle contains a duplicate Pack version")
        seen.add(key)
        dependencies = member.get("dependencies") or []
        if not isinstance(dependencies, list) or any(not isinstance(item, str) or not item for item in dependencies):
            raise ValueError("Bundle member dependencies must be an array of Pack IDs")
        members.append({
            "manifest": clean,
            "manifest_path": manifest_path.as_posix(),
            "resource_hashes": resource_hashes,
            "dependencies": list(dependencies),
            "file_names": _member_file_names(manifest_path, files, manifest_paths),
        })
    known = {item["manifest"]["pack_id"] for item in members}
    for member in members:
        if any(str(item) not in known for item in member["dependencies"]):
            raise ValueError("Design Bundle declares an unavailable Pack dependency")
    return {"bundle": root, "members": members, "files": files}


def install_bundle(content: bytes | Path | Mapping[str, bytes], owner_id: str, private_root: Path) -> tuple[dict[str, Any], list[Path]]:
    validated = validate_bundle(content, owner_id)
    root = private_root.resolve()
    targets: list[Path] = []
    with TemporaryDirectory(prefix="fastppt-packs-", dir=root.parent if root.parent.exists() else None) as temporary:
        staging = Path(temporary).resolve()
        staged: list[tuple[Path, Path]] = []
        for member in validated["members"]:
            manifest = member["manifest"]
            target = (root / owner_id / manifest["pack_id"] / manifest["version"]).resolve()
            if root not in target.parents:
                raise ValueError("Private Pack target escapes the configured runtime directory")
            if target.exists():
                raise ValueError("This private Pack version is already installed")
            stage_target = staging / manifest["pack_id"] / manifest["version"]
            stage_target.mkdir(parents=True, exist_ok=False)
            manifest_path = PurePosixPath(member["manifest_path"])
            for name in [manifest_path.as_posix(), *member["file_names"]]:
                value = validated["files"][name]
                relative = PurePosixPath(name).name if manifest_path.parent == PurePosixPath(".") else PurePosixPath(name).relative_to(manifest_path.parent)
                relative = PurePosixPath(relative)
                output = (stage_target / Path(*relative.parts)).resolve()
                if stage_target.resolve() not in output.parents and output != stage_target.resolve():
                    raise ValueError("Pack resource escapes its staging directory")
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(value)
            staged.append((stage_target, target))
        moved: list[Path] = []
        try:
            for stage_target, target in staged:
                if target.exists():
                    raise ValueError("This private Pack version is already installed")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(stage_target), str(target))
                moved.append(target)
        except Exception:
            for target in reversed(moved):
                resolved = target.resolve()
                if root in resolved.parents:
                    shutil.rmtree(resolved, ignore_errors=True)
            raise
        targets.extend(moved)
    return validated, targets
