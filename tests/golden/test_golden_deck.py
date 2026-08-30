import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_core.svg import render_page_svg
from fastppt_ppt_master import ConversionRequest, PptMasterAdapter


class GoldenDeckTests(TestCase):
    def test_representative_pages_remain_editable_and_fact_bearing(self) -> None:
        cases = [
            ("中文发布复盘", "2026 年 8 月完成第一阶段"),
            ("指标看板", "覆盖率 95%，投入 3 人"),
            ("结构化流程", "输入、校验、重建、PowerPoint QA"),
            ("Failure Recovery", "Stable page IDs and immutable versions"),
        ]
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            sources = []
            for index, (title, body) in enumerate(cases, 1):
                path = root / f"{index:02d}.svg"
                path.write_text(render_page_svg(title, body, page_number=index, page_role="cover" if index == 1 else "content"), encoding="utf-8")
                sources.append(path)
            output = root / "golden.pptx"
            adapter = PptMasterAdapter()
            result = adapter.convert(ConversionRequest(tuple(sources), output, "golden-deck"))
            self.assertEqual(result.slide_count, len(cases))
            self.assertEqual(adapter._full_slide_rasters(output), [])
            with zipfile.ZipFile(output) as archive:
                slide_xml = b"".join(archive.read(name) for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            for marker in ("2026", "95%", "PowerPoint QA", "Stable page IDs"):
                self.assertIn(marker.encode("utf-8"), slide_xml)
