#!/usr/bin/env python3
"""Reject machine paths, likely secrets, and generated runtime content."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_ROOTS = (
    "kernel/ppt-master/upstream/",
    "kernel/ppt-master/upstream-repository/",
)
TEXT_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".tsx", ".json", ".toml", ".yaml", ".yml", ".md", ".css", ".html", ".ps1", ".sh", ".example"}
RULES = {
    "windows_absolute_path": re.compile(r"(?i)(?:^|[\s'\"=])(?:[a-z]:[\\/])"),
    "legacy_workspace": re.compile(r"(?i)ppt-master-fastppt-online|desktop[\\/]ppt"),  # hygiene: allow-rule-definition
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "likely_api_key": re.compile(r"(?i)(?:api[_-]?key|secret)[\s]*=[\s]*['\"]?(?:sk-|[A-Za-z0-9_-]{32,})"),
}


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


def main() -> int:
    problems: list[str] = []
    for path in tracked_files():
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(f"non_utf8: {path.relative_to(ROOT).as_posix()}")
            continue
        if "\ufffd" in content:
            problems.append(f"replacement_character: {path.relative_to(ROOT).as_posix()}")
        for line_number, line in enumerate(content.splitlines(), 1):
            if "hygiene: allow-" in line:
                continue
            for name, pattern in RULES.items():
                if pattern.search(line):
                    problems.append(f"{name}: {path.relative_to(ROOT).as_posix()}:{line_number}")
    for value in problems:
        print(value)
    print(f"checked={len(tracked_files())} problems={len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
