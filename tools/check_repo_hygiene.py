#!/usr/bin/env python3
"""Reject machine paths, likely secrets, and generated runtime content."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_ROOTS = (
    "kernel/ppt-master/upstream/",
)
TEXT_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".tsx", ".json", ".toml", ".yaml", ".yml", ".md", ".css", ".html", ".ps1", ".sh", ".example", ".log", ".txt", ".ndjson"}
RULES = {
    "windows_absolute_path": re.compile(r"(?i)(?:^|[\s'\"=])(?:[a-z]:[\\/])"),
    "legacy_workspace": re.compile(r"(?i)ppt-master-fastppt-online|desktop[\\/]ppt"),  # hygiene: allow-rule-definition
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "likely_api_key": re.compile(r"(?i)(?:api[_-]?key|secret)[\s]*=[\s]*['\"]?(?:sk-|[A-Za-z0-9_-]{32,})"),
    "bearer_token": re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}"),
}
SECRET_RULE_NAMES = {"private_key", "likely_api_key", "bearer_token"}
FORBIDDEN_TRACKED_PATHS = (
    "runtime-data/private-packs/",
    "var/data/private-packs/",
    "var/audit-exports/",
)
FORBIDDEN_EVIDENCE_NAMES = ("prompt_envelope", "raw_response", "provider_response")
EVIDENCE_RULES = {
    "full_prompt_payload": re.compile(r'"(?:system_prompt|user_prompt|rendered_context)"\s*:'),
    "raw_provider_response": re.compile(r'"(?:raw_response|provider_response)"\s*:(?!\s*(?:"omitted"|null|false)(?:\s*[,}]|$))'),
    "private_pack_reference": re.compile(r"(?i)(?:runtime-data|var/data)[\\/]private-packs[\\/]"),
}
SKIP_DIRECTORY_NAMES = {".git", ".venv", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", "dist"}
RELEASE_EVIDENCE_NAMES = {
    "release-evidence",
    "release_evidence",
    "release-artifacts",
    "release_artifacts",
    "provider-evidence",
    "provider_evidence",
}


def git_tracked_paths() -> list[str]:
    result = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return [value.replace("\\", "/") for value in result.stdout.splitlines()]


def tracked_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    paths = []
    for value in result.stdout.splitlines():
        normalized = value.replace("\\", "/")
        if not normalized.startswith(EXCLUDED_ROOTS):
            path = ROOT / value
            if path.is_file() and (path.suffix.casefold() in TEXT_SUFFIXES or path.name.startswith(".env")):
                paths.append(path)
    return paths


def supplementary_evidence_files() -> list[tuple[Path, str]]:
    """Include ignored logs and release evidence that Git enumeration cannot see."""
    files: list[tuple[Path, str]] = []
    for directory, names, file_names in os.walk(ROOT):
        directory_path = Path(directory)
        kept_names: list[str] = []
        for name in names:
            candidate = directory_path / name
            relative = candidate.relative_to(ROOT).as_posix() + "/"
            if name.casefold() in SKIP_DIRECTORY_NAMES or relative.startswith(EXCLUDED_ROOTS):
                continue
            kept_names.append(name)
        names[:] = kept_names
        for name in file_names:
            path = directory_path / name
            if path.is_symlink():
                continue
            relative = path.relative_to(ROOT)
            parts = tuple(part.casefold() for part in relative.parts)
            is_log = path.suffix.casefold() in {".log", ".ndjson"} or "logs" in parts
            is_release_evidence = any(part in RELEASE_EVIDENCE_NAMES or part.startswith("verification") for part in parts)
            if is_log or is_release_evidence:
                files.append((path, "log" if is_log else "release_evidence"))
    return files


def scan_text(content: str, label: str, problems: list[str], *, release_sensitive: bool) -> None:
    if "\ufffd" in content:
        problems.append(f"replacement_character: {label}")
    for line_number, line in enumerate(content.splitlines(), 1):
        if "hygiene: allow-" in line:
            continue
        active_rules = RULES.items() if not release_sensitive else ((name, RULES[name]) for name in SECRET_RULE_NAMES)
        for name, pattern in active_rules:
            if pattern.search(line):
                problems.append(f"{name}: {label}:{line_number}")
        if release_sensitive:
            for name, pattern in EVIDENCE_RULES.items():
                if pattern.search(line):
                    problems.append(f"{name}: {label}:{line_number}")


def scan_supplementary(path: Path, category: str, problems: list[str]) -> None:
    relative = path.relative_to(ROOT).as_posix()
    label = f"{category}:{relative}"
    if any(name in path.name.casefold() for name in FORBIDDEN_EVIDENCE_NAMES):
        problems.append(f"raw_audit_evidence: {label}")
    if path.suffix.casefold() == ".zip":
        try:
            with ZipFile(path) as archive:
                for info in archive.infolist():
                    member = info.filename.replace("\\", "/")
                    if any(name in Path(member.casefold()).name for name in FORBIDDEN_EVIDENCE_NAMES):
                        problems.append(f"raw_audit_evidence: {label}!{member}")
                    if info.file_size > 10 * 1024 * 1024 or Path(member).suffix.casefold() not in TEXT_SUFFIXES:
                        continue
                    payload = archive.read(info)
                    content = None
                    for encoding in ("utf-8", "gb18030"):
                        try:
                            content = payload.decode(encoding)
                            break
                        except UnicodeDecodeError:
                            continue
                    if content is None:
                        problems.append(f"non_utf8: {label}!{member}")
                        continue
                    scan_text(content, f"{label}!{member}", problems, release_sensitive=True)
        except BadZipFile:
            problems.append(f"invalid_release_archive: {label}")
        return
    if path.suffix.casefold() not in TEXT_SUFFIXES and not path.name.startswith(".env"):
        return
    content = None
    payload = path.read_bytes()
    for encoding in ("utf-8", "gb18030"):
        try:
            content = payload.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if content is None:
        problems.append(f"non_utf8: {label}")
        return
    scan_text(content, label, problems, release_sensitive=True)


def main() -> int:
    problems: list[str] = []
    repository_files = tracked_files()
    for value in git_tracked_paths():
        lowered = value.casefold()
        if any(part in lowered for part in FORBIDDEN_TRACKED_PATHS):
            problems.append(f"private_runtime_content: {value}")
        if any(name in Path(lowered).name for name in FORBIDDEN_EVIDENCE_NAMES) and Path(lowered).suffix in {".json", ".txt", ".log"}:
            problems.append(f"raw_audit_evidence: {value}")
    for path in repository_files:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(f"non_utf8: {path.relative_to(ROOT).as_posix()}")
            continue
        scan_text(content, path.relative_to(ROOT).as_posix(), problems, release_sensitive=False)
    supplementary = supplementary_evidence_files()
    for path, category in supplementary:
        scan_supplementary(path, category, problems)
    problems = sorted(set(problems))
    for value in problems:
        print(value)
    print(f"checked={len(repository_files)} supplementary={len(supplementary)} tracked={len(git_tracked_paths())} problems={len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
