"""Controlled SVG-to-PPTX execution and static QA."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from fastppt_core.paths import repository_root


class KernelError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ConversionRequest:
    svg_files: tuple[Path, ...]
    output_path: Path
    project_name: str
    timeout_seconds: int = 180


@dataclass(frozen=True, slots=True)
class ConversionResult:
    output_path: Path
    pptx_sha256: str
    slide_count: int
    kernel_version: str
    svg_qa_status: str
    svg_qa_sha256: str
    pptx_qa_status: str
    advisories: tuple[dict[str, Any], ...]


class PptMasterAdapter:
    def __init__(self, root: Path | None = None) -> None:
        self.repository_root = (root or repository_root()).resolve()
        self.wrapper_root = self.repository_root / "kernel" / "ppt-master"
        self.kernel_root = self.wrapper_root / "upstream"
        self.scripts_root = self.kernel_root / "scripts"

    def _script(self, name: str) -> Path:
        path = self.scripts_root / name
        if not path.is_file():
            raise KernelError(f"Kernel capability is missing: {name}")
        return path

    def _run(self, command: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        environment = dict(os.environ)
        environment["PYTHONUTF8"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            command,
            cwd=self.repository_root,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=environment,
        )
        if result.returncode:
            detail = result.stderr.strip() or result.stdout.strip()
            raise KernelError(detail[-4000:] or "ppt-master kernel command failed")
        return result

    def version(self) -> str:
        skill = self.kernel_root / "SKILL.md"
        match = re.search(r'^\s*version:\s*["\']?([^"\'\s]+)', skill.read_text(encoding="utf-8"), re.MULTILINE)
        return match.group(1) if match else "unknown"

    def probe(self) -> dict[str, Any]:
        required = ["attribution_guard.py", "svg_quality_checker.py", "svg_to_pptx.py", "pptx_delivery_check.py"]
        missing = [name for name in required if not (self.scripts_root / name).is_file()]
        if missing:
            return {"status": "unavailable", "missing": missing, "kernel_version": self.version()}
        try:
            self._run([sys.executable, str(self._script("attribution_guard.py"))], timeout=30)
        except (KernelError, subprocess.TimeoutExpired) as exc:
            return {"status": "failed", "kernel_version": self.version(), "detail": str(exc)}
        manifest = json.loads((self.wrapper_root / "UPSTREAM.json").read_text(encoding="utf-8"))
        return {
            "status": "ready",
            "kernel_version": self.version(),
            "upstream_commit": manifest["base_commit"],
            "capabilities": ["svg_qa", "svg_to_editable_pptx", "pptx_static_qa"],
        }

    @staticmethod
    def _json_from_output(output: str) -> dict[str, Any]:
        starts = [index for index, char in enumerate(output) if char == "{"]
        for start in starts:
            try:
                value = json.loads(output[start:])
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
        raise KernelError("Kernel command did not return a JSON report")

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _svg_gate_status(report: dict[str, Any], expected_files: Mapping[str, str]) -> str:
        if report.get("schema") != "ppt-master.svg-quality-report.v1" or report.get("stage") != "final":
            raise KernelError("SVG quality report schema or stage is invalid")
        summary = report.get("summary")
        categories = report.get("categories")
        fingerprint = report.get("source_fingerprint")
        if not isinstance(summary, dict) or not isinstance(categories, dict) or not isinstance(fingerprint, dict):
            raise KernelError("SVG quality report is missing required gate sections")
        errors = summary.get("errors")
        blocking = categories.get("blocking")
        file_count = fingerprint.get("file_count")
        digest = fingerprint.get("digest")
        files = fingerprint.get("files")
        if isinstance(errors, bool) or not isinstance(errors, int):
            raise KernelError("SVG quality report error count is invalid")
        if not isinstance(blocking, dict) or isinstance(blocking.get("count"), bool) or not isinstance(blocking.get("count"), int):
            raise KernelError("SVG quality report blocking count is invalid")
        if file_count != len(expected_files) or not isinstance(files, list) or len(files) != len(expected_files):
            raise KernelError("SVG quality report does not bind every source file")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise KernelError("SVG quality report source digest is invalid")
        if any(not isinstance(item, dict) or not isinstance(item.get("file"), str) or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))) for item in files):
            raise KernelError("SVG quality report contains an unbound source file")
        reported_files = {str(item["file"]): str(item["sha256"]) for item in files}
        if len(reported_files) != len(files) or reported_files != dict(expected_files):
            raise KernelError("SVG quality report source hashes do not match the conversion inputs")
        aggregate = hashlib.sha256()
        for file_name, file_sha256 in sorted(expected_files.items()):
            aggregate.update(file_name.encode("utf-8"))
            aggregate.update(b"\0")
            aggregate.update(file_sha256.encode("ascii"))
            aggregate.update(b"\n")
        if digest != aggregate.hexdigest():
            raise KernelError("SVG quality report aggregate fingerprint does not match the conversion inputs")
        if errors != 0 or blocking["count"] != 0:
            raise KernelError(f"SVG quality gate failed: errors={errors}, blocking={blocking['count']}")
        return "passed"

    @staticmethod
    def _full_slide_rasters(path: Path) -> list[dict[str, Any]]:
        namespaces = {
            "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        }
        offenders: list[dict[str, Any]] = []
        with zipfile.ZipFile(path) as archive:
            presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
            size = presentation.find("p:sldSz", namespaces)
            if size is None:
                raise KernelError("PPTX has no slide size contract")
            width, height = int(size.attrib["cx"]), int(size.attrib["cy"])
            slides = sorted(
                name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            )
            for slide_number, name in enumerate(slides, 1):
                root = ET.fromstring(archive.read(name))
                for picture_number, picture in enumerate(root.findall(".//p:pic", namespaces), 1):
                    extent = picture.find("p:spPr/a:xfrm/a:ext", namespaces)
                    if extent is None:
                        continue
                    picture_width = int(extent.attrib.get("cx", "0"))
                    picture_height = int(extent.attrib.get("cy", "0"))
                    if picture_width >= width * 0.95 and picture_height >= height * 0.95:
                        offenders.append({"slide": slide_number, "picture": picture_number})
        return offenders

    def convert(self, request: ConversionRequest) -> ConversionResult:
        if not request.svg_files:
            raise KernelError("At least one SVG is required")
        output = request.output_path.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.suffix.lower() != ".pptx":
            raise KernelError("Output must use the .pptx extension")
        for source in request.svg_files:
            if not source.is_file() or source.suffix.lower() != ".svg":
                raise KernelError(f"Invalid SVG input: {source.name}")

        with tempfile.TemporaryDirectory(prefix="fastppt-ppt-master-") as temp_name:
            workspace = Path(temp_name) / re.sub(r"[^A-Za-z0-9_.-]", "_", request.project_name)
            svg_root = workspace / "svg_output"
            svg_root.mkdir(parents=True)
            (workspace / "spec_lock.md").write_text(
                "# FastPPT Adapter Lock\n\n"
                "## canvas\n"
                "- viewBox: 0 0 1280 720\n"
                "- format: PPT 16:9\n\n"
                "## colors\n"
                "- bg: #F7F8FA\n"
                "- text: #171A1D\n"
                "- text_secondary: #626A73\n"
                "- primary: #23745B\n"
                "- accent: #D14D3F\n"
                "- border: #D8DCE1\n\n"
                "## typography\n"
                "- font_family: Arial, \"Microsoft YaHei\", sans-serif\n"
                "- title_family: Arial, \"Microsoft YaHei\", sans-serif\n"
                "- body_family: Arial, \"Microsoft YaHei\", sans-serif\n"
                "- title: 48\n"
                "- body: 25\n"
                "- compact_title: 38\n"
                "- eyebrow: 16\n"
                "- page_number: 17\n\n"
                "## pptx_structure\n"
                "- mode: flat\n",
                encoding="utf-8",
            )
            expected_files: dict[str, str] = {}
            for index, source in enumerate(request.svg_files, 1):
                file_name = f"{index:03d}_{source.name}"
                shutil.copy2(source, svg_root / file_name)
                expected_files[file_name] = self._sha256(source)
            self._run(
                [
                    sys.executable,
                    str(self._script("svg_quality_checker.py")),
                    str(workspace),
                    "--stage",
                    "final",
                    "--json",
                ],
                timeout=request.timeout_seconds,
            )
            quality_report_path = workspace / "validation" / "svg_quality_report.json"
            try:
                svg_report = json.loads(quality_report_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise KernelError("SVG quality checker did not publish a valid report") from exc
            svg_status = self._svg_gate_status(svg_report, expected_files)
            svg_qa_sha256 = self._sha256(quality_report_path)

            candidate = Path(temp_name) / "candidate.pptx"
            self._run(
                [
                    sys.executable,
                    str(self._script("svg_to_pptx.py")),
                    str(workspace),
                    "--quick-generate",
                    "--output",
                    str(candidate),
                ],
                timeout=request.timeout_seconds,
            )
            delivery = self._run(
                [sys.executable, str(self._script("pptx_delivery_check.py")), str(candidate)],
                timeout=request.timeout_seconds,
            )
            pptx_report = self._json_from_output(delivery.stdout)
            pptx_status = str(pptx_report.get("status", "unknown"))
            if pptx_status not in {"passed", "passed-with-advisories"}:
                raise KernelError(f"PPTX static quality gate did not pass: {pptx_status}")
            offenders = self._full_slide_rasters(candidate)
            if offenders:
                raise KernelError(f"Unregistered full-slide raster images are forbidden: {offenders}")

            part = output.with_name(f".{output.name}.{os.getpid()}.part")
            shutil.copy2(candidate, part)
            os.replace(part, output)
            slides = pptx_report.get("slides") or {}
            return ConversionResult(
                output_path=output,
                pptx_sha256=self._sha256(output),
                slide_count=int(slides.get("count", len(request.svg_files))),
                kernel_version=self.version(),
                svg_qa_status=svg_status,
                svg_qa_sha256=svg_qa_sha256,
                pptx_qa_status=pptx_status,
                advisories=tuple(pptx_report.get("advisories") or ()),
            )
