"""Controlled SVG-to-PPTX execution and static QA."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from copy import deepcopy
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from fastppt_core.paths import repository_root
from fastppt_core.v2 import TemplateSkeletonSnapshot, V2ContractError, sha256_json


class KernelError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ConversionRequest:
    svg_files: tuple[Path, ...]
    output_path: Path
    project_name: str
    timeout_seconds: int = 180
    template_path: Path | None = None
    layout_names: tuple[str, ...] = ()
    native_connector_counts: tuple[int, ...] = ()


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

    @staticmethod
    def _layout_parts(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
        namespace = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
        values: list[tuple[str, str]] = []
        for name in sorted(
            (item for item in archive.namelist() if re.fullmatch(r"ppt/slideLayouts/slideLayout\d+\.xml", item)),
            key=lambda item: int(re.search(r"(\d+)", Path(item).stem).group(1)),
        ):
            root = ET.fromstring(archive.read(name))
            common = root.find("p:cSld", namespace)
            values.append((name, str(common.attrib.get("name") if common is not None else Path(name).stem)))
        return values

    @staticmethod
    def _layout_part_for(layouts: list[tuple[str, str]], requested: str, index: int) -> str:
        normalized = requested.strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "cover": ("title_slide",),
            "two_column": ("comparison", "two_content"),
            "process": ("title_only", "section_header"),
        }
        wanted = (normalized, *aliases.get(normalized, ()))
        for candidate in wanted:
            for part, name in layouts:
                if name.strip().lower().replace("-", "_").replace(" ", "_") == candidate:
                    return part
        fallbacks = {"cover": 0, "two_column": 4, "process": 5}
        fallback = fallbacks.get(normalized, index)
        return layouts[min(fallback, len(layouts) - 1)][0]

    @staticmethod
    def _native_connectors(slide_xml: bytes, count: int) -> bytes:
        if count <= 0:
            return slide_xml
        p_ns = "http://schemas.openxmlformats.org/presentationml/2006/main"
        a_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
        namespaces = {"p": p_ns, "a": a_ns}
        ET.register_namespace("p", p_ns)
        ET.register_namespace("a", a_ns)
        ET.register_namespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        ET.register_namespace("p14", "http://schemas.microsoft.com/office/powerpoint/2010/main")
        root = ET.fromstring(slide_xml)
        tree = root.find(".//p:spTree", namespaces)
        if tree is None:
            raise KernelError("Slide has no shape tree for native connectors")
        line_shapes = []
        node_ids = []
        for shape in tree.findall("p:sp", namespaces):
            properties = shape.find("p:nvSpPr/p:cNvPr", namespaces)
            if properties is None:
                continue
            name = str(properties.attrib.get("name") or "")
            if name.startswith("Line "):
                line_shapes.append(shape)
            elif name.startswith("Rectangle "):
                node_ids.append(str(properties.attrib.get("id") or ""))
        # The first rectangle is the accent rail; the following seven are the
        # process nodes emitted by the task-one SVG.
        node_ids = node_ids[-7:]
        if len(line_shapes) < count or len(node_ids) < count + 1:
            raise KernelError("Slide does not contain the expected visual connector geometry")
        for index, shape in enumerate(line_shapes[:count]):
            old_non_visual = shape.find("p:nvSpPr", namespaces)
            shape_properties = shape.find("p:spPr", namespaces)
            if old_non_visual is None or shape_properties is None:
                raise KernelError("Visual connector shape is incomplete")
            connector = ET.Element(f"{{{p_ns}}}cxnSp")
            non_visual = ET.SubElement(connector, f"{{{p_ns}}}nvCxnSpPr")
            identifier = old_non_visual.find("p:cNvPr", namespaces)
            if identifier is None:
                raise KernelError("Visual connector has no shape identity")
            identifier = deepcopy(identifier)
            identifier.set("name", f"Connector {index + 1}")
            non_visual.append(identifier)
            connection_properties = ET.SubElement(non_visual, f"{{{p_ns}}}cNvCxnSpPr")
            start_index, end_index = ((2, 0) if index == 3 else (3, 1))
            ET.SubElement(
                connection_properties,
                f"{{{a_ns}}}stCxn",
                {"id": node_ids[index], "idx": str(start_index)},
            )
            ET.SubElement(
                connection_properties,
                f"{{{a_ns}}}endCxn",
                {"id": node_ids[index + 1], "idx": str(end_index)},
            )
            old_nv_pr = old_non_visual.find("p:nvPr", namespaces)
            non_visual.append(deepcopy(old_nv_pr) if old_nv_pr is not None else ET.Element(f"{{{p_ns}}}nvPr"))
            shape_properties = deepcopy(shape_properties)
            custom_geometry = shape_properties.find("a:custGeom", namespaces)
            transform = shape_properties.find("a:xfrm", namespaces)
            if custom_geometry is not None:
                path = custom_geometry.find("a:pathLst/a:path", namespaces)
                start = custom_geometry.find("a:pathLst/a:path/a:moveTo/a:pt", namespaces)
                if transform is not None and path is not None and start is not None and start.attrib.get("x") == path.attrib.get("w"):
                    transform.set("flipH", "1")
                position = list(shape_properties).index(custom_geometry)
                shape_properties.remove(custom_geometry)
                preset = ET.Element(f"{{{a_ns}}}prstGeom", {"prst": "line"})
                ET.SubElement(preset, f"{{{a_ns}}}avLst")
                shape_properties.insert(position, preset)
            connector.append(shape_properties)
            tree.insert(list(tree).index(shape), connector)
            tree.remove(shape)
        return ET.tostring(root, encoding="utf-8", xml_declaration=True)

    @staticmethod
    def _merge_template_skeleton(
        candidate: Path,
        template: Path,
        output: Path,
        layout_names: tuple[str, ...],
        native_connector_counts: tuple[int, ...],
    ) -> None:
        if not template.is_file() or template.suffix.lower() not in {".pptx", ".potx"}:
            raise KernelError("Template source must be an existing .pptx or .potx file")
        ET.register_namespace("p", "http://schemas.openxmlformats.org/presentationml/2006/main")
        ET.register_namespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")
        ET.register_namespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        with zipfile.ZipFile(candidate) as generated, zipfile.ZipFile(template) as source:
            generated_names = generated.namelist()
            source_names = source.namelist()
            layouts = PptMasterAdapter._layout_parts(source)
            if not layouts:
                raise KernelError("Template source has no slide layouts")
            slide_names = sorted(
                (name for name in generated_names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
                key=lambda item: int(re.search(r"(\d+)", Path(item).stem).group(1)),
            )
            if layout_names and len(layout_names) != len(slide_names):
                raise KernelError("Template layout mapping must cover every generated slide")
            if native_connector_counts and len(native_connector_counts) != len(slide_names):
                raise KernelError("Native connector mapping must cover every generated slide")

            data = {name: generated.read(name) for name in generated_names}
            infos = {name: generated.getinfo(name) for name in generated_names}
            for name in list(data):
                if name.startswith(("ppt/slideMasters/", "ppt/slideLayouts/", "ppt/theme/")):
                    data.pop(name)
                    infos.pop(name)
            for name in source_names:
                if name.startswith(("ppt/slideMasters/", "ppt/slideLayouts/", "ppt/theme/")):
                    data[name] = source.read(name)
                    infos[name] = source.getinfo(name)
            if "docProps/core.xml" in source_names:
                # Template-backed exports inherit fixed package provenance;
                # this also removes converter wall-clock timestamps so the
                # same immutable inputs produce identical PPTX bytes.
                data["docProps/core.xml"] = source.read("docProps/core.xml")
                infos["docProps/core.xml"] = source.getinfo("docProps/core.xml")

            # Keep the source deck's page-size contract and all other
            # presentation-level skeleton metadata while retaining the
            # generated slide list and its relationship IDs.
            p_namespace = "http://schemas.openxmlformats.org/presentationml/2006/main"
            presentation_root = ET.fromstring(data["ppt/presentation.xml"])
            source_presentation = ET.fromstring(source.read("ppt/presentation.xml"))
            source_size = source_presentation.find(f"{{{p_namespace}}}sldSz")
            destination_size = presentation_root.find(f"{{{p_namespace}}}sldSz")
            if source_size is not None and destination_size is not None:
                destination_size.attrib.update(source_size.attrib)
            data["ppt/presentation.xml"] = ET.tostring(presentation_root, encoding="utf-8", xml_declaration=True)

            relationship_namespace = "http://schemas.openxmlformats.org/package/2006/relationships"
            ET.register_namespace("", relationship_namespace)
            for index, slide_name in enumerate(slide_names):
                relationship_name = f"ppt/slides/_rels/{Path(slide_name).name}.rels"
                root = ET.fromstring(data[relationship_name])
                target = PptMasterAdapter._layout_part_for(
                    layouts,
                    layout_names[index] if layout_names else "",
                    index,
                )
                layout_relationship = next(
                    (
                        item
                        for item in root
                        if str(item.attrib.get("Type") or "").endswith("/slideLayout")
                    ),
                    None,
                )
                if layout_relationship is None:
                    raise KernelError("Generated slide has no layout relationship")
                layout_relationship.set("Target", "../slideLayouts/" + Path(target).name)
                data[relationship_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                count = native_connector_counts[index] if native_connector_counts else 0
                data[slide_name] = PptMasterAdapter._native_connectors(data[slide_name], count)

            content_types_name = "[Content_Types].xml"
            content_type_namespace = "http://schemas.openxmlformats.org/package/2006/content-types"
            ET.register_namespace("", content_type_namespace)
            content_types = ET.fromstring(data[content_types_name])
            existing_parts = {str(item.attrib.get("PartName") or "") for item in content_types}
            source_types = ET.fromstring(source.read(content_types_name))
            for item in source_types:
                part_name = str(item.attrib.get("PartName") or "")
                if part_name.startswith(("/ppt/slideMasters/", "/ppt/slideLayouts/", "/ppt/theme/")) and part_name not in existing_parts:
                    content_types.append(deepcopy(item))
                    existing_parts.add(part_name)
            data[content_types_name] = ET.tostring(content_types, encoding="utf-8", xml_declaration=True)

            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as merged:
                ordered = [name for name in generated_names if name in data]
                ordered.extend(sorted(name for name in data if name not in set(ordered)))
                for name in ordered:
                    info = deepcopy(infos[name])
                    info.date_time = (1980, 1, 1, 0, 0, 0)
                    merged.writestr(info, data[name])

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
            final_candidate = candidate
            if request.template_path is not None:
                final_candidate = Path(temp_name) / "template-backed.pptx"
                self._merge_template_skeleton(
                    candidate,
                    request.template_path.resolve(),
                    final_candidate,
                    request.layout_names,
                    request.native_connector_counts,
                )
            elif request.layout_names or request.native_connector_counts:
                raise KernelError("Template layout/native connector mappings require template_path")
            delivery = self._run(
                [sys.executable, str(self._script("pptx_delivery_check.py")), str(final_candidate)],
                timeout=request.timeout_seconds,
            )
            pptx_report = self._json_from_output(delivery.stdout)
            pptx_status = str(pptx_report.get("status", "unknown"))
            if pptx_status not in {"passed", "passed-with-advisories"}:
                raise KernelError(f"PPTX static quality gate did not pass: {pptx_status}")
            offenders = self._full_slide_rasters(final_candidate)
            if offenders:
                raise KernelError(f"Unregistered full-slide raster images are forbidden: {offenders}")

            part = output.with_name(f".{output.name}.{os.getpid()}.part")
            shutil.copy2(final_candidate, part)
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

    @staticmethod
    def _template_bytes(source: Path | bytes) -> tuple[bytes, str]:
        if isinstance(source, Path):
            path = source.resolve()
            if path.suffix.lower() not in {".pptx", ".potx"} or not path.is_file():
                raise V2ContractError("Template source must be an existing .pptx or .potx file")
            return path.read_bytes(), path.suffix.lower()
        if not isinstance(source, bytes) or not source:
            raise V2ContractError("Template source bytes are required")
        return source, ".potx"

    @staticmethod
    def extract_template_skeleton(source: Path | bytes, *, source_artifact_hash: str | None = None, snapshot_id: str | None = None) -> TemplateSkeletonSnapshot:
        """Extract a normalized, immutable subset of OOXML template structure.

        The adapter intentionally records structure and protected assets only;
        callers never need to parse the vendored kernel's internal files.
        """
        content, _suffix = PptMasterAdapter._template_bytes(source)
        actual_digest = "sha256:" + hashlib.sha256(content).hexdigest()
        digest = source_artifact_hash or actual_digest
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise V2ContractError("source_artifact_hash must be sha256:<hex>")
        if digest != actual_digest:
            raise V2ContractError("source_artifact_hash does not match template bytes")
        namespaces = {
            "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        }
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = set(archive.namelist())
            if "ppt/presentation.xml" not in names:
                raise V2ContractError("Template package is missing ppt/presentation.xml")
            presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
            size = presentation.find("p:sldSz", namespaces)
            if size is None:
                raise V2ContractError("Template package is missing slide size")
            width_pt = round(int(size.attrib.get("cx", "0")) / 12700.0, 4)
            height_pt = round(int(size.attrib.get("cy", "0")) / 12700.0, 4)
            if width_pt <= 0 or height_pt <= 0:
                raise V2ContractError("Template slide size is invalid")
            layouts: list[dict[str, Any]] = []
            placeholders: list[dict[str, Any]] = []
            masters: list[dict[str, Any]] = []
            for name in sorted(names):
                if re.fullmatch(r"ppt/slideLayouts/slideLayout\d+\.xml", name):
                    root = ET.fromstring(archive.read(name))
                    c_sld = root.find("p:cSld", namespaces)
                    layout_name = (c_sld.attrib.get("name") if c_sld is not None else None) or Path(name).stem
                    layout_placeholders = []
                    for shape in root.findall(".//p:ph", namespaces):
                        attrs = {str(key): str(value) for key, value in shape.attrib.items()}
                        item = {"type": attrs.get("type", "body"), "idx": attrs.get("idx", "0"), "orient": attrs.get("orient", "horz")}
                        layout_placeholders.append(item)
                        placeholders.append({"layout": layout_name, **item})
                    layouts.append({"name": layout_name, "source_part": name, "placeholders": layout_placeholders, "slots": [item["type"] for item in layout_placeholders] or ["title", "body"]})
                elif re.fullmatch(r"ppt/slideMasters/slideMaster\d+\.xml", name):
                    root = ET.fromstring(archive.read(name))
                    c_sld = root.find("p:cSld", namespaces)
                    masters.append({"name": (c_sld.attrib.get("name") if c_sld is not None else None) or Path(name).stem, "source_part": name})
            colors: dict[str, str] = {}
            fonts: list[str] = []
            theme_parts = sorted(name for name in names if re.fullmatch(r"ppt/theme/theme\d+\.xml", name))
            if theme_parts:
                theme = ET.fromstring(archive.read(theme_parts[0]))
                for element in theme.findall(".//a:clrScheme/*", namespaces):
                    child = next(iter(element), None)
                    if child is not None:
                        value = child.attrib.get("val") or child.attrib.get("lastClr")
                        if value:
                            colors[element.tag.rsplit("}", 1)[-1]] = "#" + value.upper()
                for element in theme.findall(".//a:fontScheme//a:latin", namespaces):
                    typeface = element.attrib.get("typeface")
                    if typeface and typeface not in fonts:
                        fonts.append(typeface)
            protected_assets = [
                {"id": "page_number", "kind": "page_number", "immutable": True},
                {"id": "footer_legal", "kind": "legal_notice", "immutable": True},
                {"id": "master_background", "kind": "background", "immutable": True},
            ]
        skeleton = TemplateSkeletonSnapshot(
            snapshot_id=snapshot_id or "skeleton_" + hashlib.sha256(content).hexdigest()[:32],
            source_artifact_hash=digest,
            page_width_pt=width_pt,
            page_height_pt=height_pt,
            theme={"source_part": theme_parts[0] if theme_parts else None},
            masters=tuple(masters),
            layouts=tuple(layouts),
            placeholders=tuple(placeholders),
            fonts=tuple(fonts),
            colors=colors,
            backgrounds=({"source": "master", "protected": True},),
            protected_assets=tuple(protected_assets),
            required_capabilities=("template_skeleton",),
            content_hash="",
        )
        return replace(skeleton, content_hash=skeleton.calculated_hash())

    # Public adapter names used by Runtime and fixture tooling.
    intake_template = extract_template_skeleton
    normalize_skeleton = extract_template_skeleton
