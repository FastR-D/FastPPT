#!/usr/bin/env python3
"""Verify task-one immutable manifest and artifact bindings."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile


def digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_hash(value: dict) -> str:
    payload = {key: child for key, child in value.items() if key != "content_hash"}
    return "sha256:" + hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "2.0.0":
        raise SystemExit("manifest schema_version must be 2.0.0")
    if manifest.get("status") != "completed":
        raise SystemExit("manifest status must be completed")
    if manifest.get("content_hash") != canonical_hash(manifest):
        raise SystemExit("manifest content hash does not match its payload")
    pages = manifest.get("pages") or []
    if [item.get("page_id") for item in pages] != ["page_t1_001", "page_t1_002", "page_t1_003"]:
        raise SystemExit("task-one page IDs are not stable and ordered")
    if len({item.get("version_id") for item in pages}) != 3:
        raise SystemExit("page versions must be unique")
    if manifest.get("design_snapshot", {}).get("content_hash") != manifest.get("export_snapshot", {}).get("design_snapshot_hash"):
        raise SystemExit("export snapshot is not bound to the design snapshot")
    for name in ("design_snapshot.json", "compiled_page_irs.json", "qa_report.json", "fact_binding_report.json", "recovery_checkpoint.json", "export_snapshot.json", "export_attempt.json", "editability_report.json"):
        if not (manifest_path.parent / name).is_file():
            raise SystemExit(f"missing evidence artifact: {name}")
    pptx = manifest.get("pptx_artifact")
    if pptx:
        path = manifest_path.parent / str(pptx.get("path"))
        if not path.is_file() or digest(path) != pptx.get("sha256"):
            raise SystemExit("PPTX artifact hash does not match manifest")
        template_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "v2" / "task1" / "template.potx"
        with ZipFile(template_path) as template, ZipFile(path) as output:
            if output.testzip() is not None:
                raise SystemExit("PPTX package contains a corrupt ZIP entry")
            for pattern, expected_count in (
                (r"ppt/theme/theme\d+\.xml", 1),
                (r"ppt/slideMasters/slideMaster\d+\.xml", 1),
                (r"ppt/slideLayouts/slideLayout\d+\.xml", 11),
            ):
                source_parts = sorted(name for name in template.namelist() if re.fullmatch(pattern, name))
                output_parts = sorted(name for name in output.namelist() if re.fullmatch(pattern, name))
                if len(source_parts) != expected_count or output_parts != source_parts:
                    raise SystemExit(f"template skeleton part set is not preserved: {pattern}")
                if any(template.read(name) != output.read(name) for name in source_parts):
                    raise SystemExit(f"template skeleton bytes changed: {pattern}")
            namespaces = {
                "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
                "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
            }
            process = ET.fromstring(output.read("ppt/slides/slide3.xml"))
            if len(process.findall(".//p:cxnSp", namespaces)) != 6:
                raise SystemExit("process slide must contain exactly six native connector objects")
            layout_targets = []
            for index in range(1, 4):
                relationships = ET.fromstring(output.read(f"ppt/slides/_rels/slide{index}.xml.rels"))
                target = next(
                    (
                        item.attrib.get("Target")
                        for item in relationships.findall("rel:Relationship", namespaces)
                        if str(item.attrib.get("Type") or "").endswith("/slideLayout")
                    ),
                    None,
                )
                layout_targets.append(target)
            if layout_targets != [
                "../slideLayouts/slideLayout1.xml",
                "../slideLayouts/slideLayout5.xml",
                "../slideLayouts/slideLayout6.xml",
            ]:
                raise SystemExit("slides are not bound to cover/two-column/process template layouts")
            if (manifest.get("qa_report") or {}).get("facts") != "passed":
                raise SystemExit("manifest QA did not verify PPTX facts")
            fixture_root = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "v2" / "task1"
            slide_names = [
                f"ppt/slides/slide{index}.xml"
                for index in range(1, len(pages) + 1)
            ]
            text_namespaces = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
            for index, page in enumerate(pages):
                source_page = json.loads(
                    (fixture_root / "pages" / f"{page['page_id']}.json").read_text(encoding="utf-8")
                )
                slide_root = ET.fromstring(output.read(slide_names[index]))
                slide_text = [item.text or "" for item in slide_root.findall(".//a:t", text_namespaces)]
                for fact in source_page.get("facts") or []:
                    value = str(fact.get("value") or "")
                    if value not in slide_text:
                        raise SystemExit(
                            f"PPTX slide {index + 1} is missing verbatim fact {fact.get('fact_id')}"
                        )
    readiness = manifest.get("powerpoint_readiness") or {}
    golden = manifest.get("powerpoint_golden") or {}
    if readiness.get("status") == "ready":
        thresholds = golden.get("thresholds") or {}
        if golden.get("status") != "available" or thresholds.get("ssim_min") != 0.985 or thresholds.get("max_changed_pixel_ratio") != 0.005:
            raise SystemExit("ready PowerPoint environment requires a hash-bound Golden threshold record")
    print(json.dumps({"status": "passed", "manifest": str(manifest_path), "page_count": len(pages)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
