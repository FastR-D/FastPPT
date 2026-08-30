"""Deterministic content-plan exports; model output is never treated as a file."""

from __future__ import annotations

from io import BytesIO
import json
from typing import Any
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def _lines(plan: dict[str, Any]) -> list[str]:
    page_count = dict(plan.get("pageCount") or {})
    lines = [
        f"Language: {plan.get('language') or ''}",
        f"Audience: {plan.get('audience') or ''}",
        f"Purpose: {plan.get('purpose') or ''}",
        f"Page count: {page_count.get('value', len(plan.get('pageDrafts') or []))}",
        f"Page count reason: {page_count.get('reason') or ''}",
        "",
        "Storyline",
    ]
    lines.extend(f"- {item}" for item in plan.get("storyline") or [])
    for index, page in enumerate(plan.get("pageDrafts") or [], 1):
        central_claim = str(page.get("central_claim") or page.get("core_point") or "")
        lines.extend([
            "",
            f"Page {index}: {page.get('title') or ''}",
        ])
        if central_claim:
            lines.append("Central claim: " + central_claim)
        lines.append(str(page.get("body") or ""))
        fact_ids = page.get("fact_ids") or page.get("required_fact_ids") or []
        if fact_ids:
            lines.append("Fact anchors: " + ", ".join(str(item) for item in fact_ids))
        if page.get("visual_suggestion"):
            lines.append("Visual suggestion: " + str(page["visual_suggestion"]))
    return lines


def render_markdown(plan: dict[str, Any]) -> bytes:
    lines = _lines(plan)
    rendered: list[str] = ["# Content plan"]
    for line in lines:
        if line == "Storyline":
            rendered.append("## Storyline")
        elif line.startswith("Page "):
            rendered.append("## " + line)
        else:
            rendered.append(line)
    return ("\n".join(rendered).rstrip() + "\n").encode("utf-8")


def render_text(plan: dict[str, Any]) -> bytes:
    return ("\n".join(_lines(plan)).rstrip() + "\n").encode("utf-8")


def render_docx(plan: dict[str, Any]) -> bytes:
    paragraphs = []
    for line in ["Content plan", *_lines(plan)]:
        if not line:
            paragraphs.append("<w:p/>")
            continue
        paragraphs.append(f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>')
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(paragraphs)}"
        '<w:sectPr>'
        '<w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr>'
        '</w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, content in (
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", relationships),
            ("word/document.xml", document),
        ):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, content.encode("utf-8"))
    return output.getvalue()


def render_content_plan(plan: dict[str, Any], output_format: str) -> tuple[bytes, str, str]:
    if output_format == "markdown":
        return render_markdown(plan), "text/markdown; charset=utf-8", "outline.md"
    if output_format == "txt":
        return render_text(plan), "text/plain; charset=utf-8", "outline.txt"
    if output_format == "docx":
        return render_docx(plan), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "outline.docx"
    raise ValueError("Unsupported content-plan export format")


def canonical_plan_json(plan: dict[str, Any]) -> bytes:
    return json.dumps(plan, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
