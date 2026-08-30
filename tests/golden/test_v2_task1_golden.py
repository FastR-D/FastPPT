import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from fastppt_runtime.task1 import TASK1_PAGE_IDS, Task1Runner, load_task1_fixture


class V2Task1GoldenTests(TestCase):
    def test_style_template_generates_three_page_editable_golden(self) -> None:
        fixture = load_task1_fixture()
        style_ref = {
            "id": fixture["style"].style_id,
            "version": fixture["style"].version,
            "content_hash": fixture["style"].content_hash,
            "capability_matrix": dict(fixture["style"].capability_matrix),
        }
        template_ref = {
            "id": fixture["template"].template_id,
            "version": fixture["template"].version,
            "content_hash": fixture["template"].content_hash,
            "capability_matrix": {},
        }
        payload = {
            "schema_version": "2.0.0",
            "project_id": "golden-project",
            "page_contract_ids": list(TASK1_PAGE_IDS),
            "selection": {"style_version_ref": style_ref, "template_version_ref": template_ref},
            "expected_mode": "style_template",
            "idempotency_key": "golden",
            "confirmed": False,
        }
        with TemporaryDirectory() as temp_name:
            runner = Task1Runner()
            preview = runner.preview(payload, output_dir=Path(temp_name) / "preview")
            payload.update(
                {
                    "confirmed": True,
                    "preview_artifact_hash": preview.manifest["design_snapshot"]["preview_artifact_hash"],
                    "confirmed_by": "task1-user",
                    "confirmed_at": "2026-01-01T00:00:00+00:00",
                }
            )
            result = runner.run(payload, output_dir=Path(temp_name))
            manifest = result.manifest
            self.assertEqual(manifest["mode"], "style_template")
            self.assertEqual(len(manifest["pages"]), 3)
            self.assertEqual([item["page_id"] for item in manifest["pages"]], list(TASK1_PAGE_IDS))
            self.assertEqual(manifest["editability_report"]["artifact_level"], "structured_editable")
            self.assertEqual(manifest["pages"][0]["artifact_exceptions"], [{"region": "image", "level": "visual_only"}])
            self.assertNotIn("native_full", json.dumps(manifest, ensure_ascii=False))
            pptx = Path(temp_name) / "task1-golden.pptx"
            self.assertTrue(pptx.is_file())
            with ZipFile(pptx) as archive:
                self.assertIsNone(archive.testzip())
                slides = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
                self.assertEqual(len(slides), 3)
                namespaces = {
                    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
                    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
                }
                process_xml = ET.fromstring(archive.read("ppt/slides/slide3.xml"))
                self.assertEqual(len(process_xml.findall(".//p:cxnSp", namespaces)), 6)
                layout_targets = []
                for index in range(1, 4):
                    relationships = ET.fromstring(archive.read(f"ppt/slides/_rels/slide{index}.xml.rels"))
                    layout_targets.append(
                        next(
                            item.attrib["Target"]
                            for item in relationships.findall("rel:Relationship", namespaces)
                            if item.attrib["Type"].endswith("/slideLayout")
                        )
                    )
                self.assertEqual(
                    layout_targets,
                    [
                        "../slideLayouts/slideLayout1.xml",
                        "../slideLayouts/slideLayout5.xml",
                        "../slideLayouts/slideLayout6.xml",
                    ],
                )
                with ZipFile(fixture["template_file"]) as template_archive:
                    for pattern, count in (
                        (r"ppt/theme/theme\d+\.xml", 1),
                        (r"ppt/slideMasters/slideMaster\d+\.xml", 1),
                        (r"ppt/slideLayouts/slideLayout\d+\.xml", 11),
                    ):
                        source_parts = sorted(name for name in template_archive.namelist() if re.fullmatch(pattern, name))
                        output_parts = sorted(name for name in archive.namelist() if re.fullmatch(pattern, name))
                        self.assertEqual(len(source_parts), count)
                        self.assertEqual(output_parts, source_parts)
                        self.assertEqual(
                            [archive.read(name) for name in output_parts],
                            [template_archive.read(name) for name in source_parts],
                        )
            golden = json.loads((fixture["root"] / "powerpoint-golden.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["pptx_artifact"]["sha256"], golden["input_pptx_sha256"])
            if manifest["powerpoint_readiness"]["status"] == "ready":
                self.assertEqual(manifest["powerpoint_golden"]["status"], "available")
                self.assertEqual(manifest["powerpoint_golden"]["thresholds"]["ssim_min"], 0.985)
            process = manifest["compiled_page_irs"][2]
            self.assertEqual(sum(item["kind"] == "connector" for item in process["objects"]), 6)
