"""Bounded document extraction for supported FastPPT source formats."""

from __future__ import annotations

import re
import hashlib
import json
import mimetypes
import posixpath
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET

from .version import SCHEMA_VERSION


SUPPORTED_SUFFIXES = frozenset({".md", ".markdown", ".txt", ".docx", ".pdf", ".pptx"})
MEDIA_TYPES = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_ZIP_MEMBERS = 5000
MAX_EXPANDED_BYTES = 250 * 1024 * 1024
MAX_MEMBER_BYTES = 50 * 1024 * 1024


class DocumentError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class FactCandidate:
    kind: str
    value: str
    normalized_value: str
    source_locator: str
    confidence: float
    conflict_key: str = ""


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    media_type: str
    text: str
    summary: str
    facts: tuple[FactCandidate, ...]
    warnings: tuple[str, ...] = ()


def safe_file_name(value: str) -> str:
    if not value or value in {".", ".."} or Path(value).name != value or "/" in value or "\\" in value or "\x00" in value:
        raise DocumentError("A safe base filename is required")
    if Path(value).suffix.casefold() not in SUPPORTED_SUFFIXES:
        raise DocumentError("Supported inputs are Markdown, TXT, DOCX, PDF, and PPTX")
    return value


def _bounded_zip(content: bytes) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(BytesIO(content))
    infos = archive.infolist()
    if len(infos) > MAX_ZIP_MEMBERS:
        archive.close()
        raise DocumentError("Archive contains too many entries")
    total = 0
    for info in infos:
        if info.file_size > MAX_MEMBER_BYTES:
            archive.close()
            raise DocumentError("Archive contains an oversized entry")
        total += info.file_size
        if total > MAX_EXPANDED_BYTES:
            archive.close()
            raise DocumentError("Archive expands beyond the configured limit")
        if info.compress_size and info.file_size / info.compress_size > 200:
            archive.close()
            raise DocumentError("Archive compression ratio is unsafe")
        path = Path(info.filename.replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts:
            archive.close()
            raise DocumentError("Archive contains an unsafe member path")
    return archive


def _docx_text(content: bytes) -> str:
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with _bounded_zip(content) as archive:
        try:
            root = ET.fromstring(archive.read("word/document.xml"))
        except (KeyError, ET.ParseError) as exc:
            raise DocumentError("DOCX document XML is invalid") from exc
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace)).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _pptx_text(content: bytes) -> str:
    namespace = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    with _bounded_zip(content) as archive:
        slide_names = sorted(
            (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda value: int(re.search(r"(\d+)", value).group(1)),
        )
        slides: list[str] = []
        for index, name in enumerate(slide_names, 1):
            try:
                root = ET.fromstring(archive.read(name))
            except ET.ParseError as exc:
                raise DocumentError(f"PPTX slide {index} XML is invalid") from exc
            texts = [node.text.strip() for node in root.findall(".//a:t", namespace) if node.text and node.text.strip()]
            slides.append(f"# Slide {index}\n" + "\n".join(texts))
    return "\n\n".join(slides)


def extract_pptx_import_manifest(
    content: bytes,
    *,
    source_artifact_id: str = "",
    source_sha256: str | None = None,
    register_media: Callable[[bytes, str, str], dict[str, str]] | None = None,
) -> dict[str, object]:
    """Extract a bounded, stable object manifest without exposing OOXML paths.

    The manifest is an import constraint and audit record, not a rendering
    implementation. Unsupported OOXML objects remain explicitly classified.
    """
    namespace = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
        "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
        "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    }

    def object_bounds(element: ET.Element) -> dict[str, int | str]:
        off = element.find(".//a:off", namespace)
        ext = element.find(".//a:ext", namespace)
        return {
            "x": int(off.get("x", 0)) if off is not None else 0,
            "y": int(off.get("y", 0)) if off is not None else 0,
            "width": int(ext.get("cx", 0)) if ext is not None else 0,
            "height": int(ext.get("cy", 0)) if ext is not None else 0,
            "unit": "emu",
        }

    def object_colors(element: ET.Element) -> list[str]:
        values = [node.get("val", "") for node in element.findall(".//a:srgbClr", namespace)]
        values.extend(f"theme:{node.get('val', '')}" for node in element.findall(".//a:schemeClr", namespace))
        return list(dict.fromkeys(value for value in values if value))[:32]

    def object_fonts(element: ET.Element) -> dict[str, object]:
        families = [node.get("typeface", "") for node in element.findall(".//*[@typeface]")]
        sizes = [int(node.get("sz", 0)) for node in element.findall(".//*[@sz]") if str(node.get("sz", "")).isdigit()]
        return {
            "families": list(dict.fromkeys(value for value in families if value))[:16],
            "sizes_hundredth_point": sorted(set(sizes))[:32],
        }

    def relationship_kind(type_uri: str) -> str:
        return type_uri.rsplit("/", 1)[-1] if type_uri else "unknown"

    with _bounded_zip(content) as archive:
        slide_names = sorted((name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)), key=lambda value: int(re.search(r"(\d+)", value).group(1)))
        pages: list[dict[str, object]] = []
        registered_media: dict[str, dict[str, str | None]] = {}
        for page_index, name in enumerate(slide_names):
            root = ET.fromstring(archive.read(name))
            rels_name = f"ppt/slides/_rels/{Path(name).name}.rels"
            relationships: dict[str, dict[str, object]] = {}
            if rels_name in archive.namelist():
                rels_root = ET.fromstring(archive.read(rels_name))
                for relation in rels_root.findall("rel:Relationship", namespace):
                    relation_id = relation.get("Id", "")
                    target = relation.get("Target", "")
                    external = relation.get("TargetMode") == "External"
                    target_name = "" if external else posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                    item: dict[str, object] = {
                        "relationship_id": relation_id,
                        "type": relationship_kind(relation.get("Type", "")),
                        "external": external,
                    }
                    if external:
                        item["external_target_sha256"] = hashlib.sha256(target.encode("utf-8")).hexdigest()
                    elif target_name in archive.namelist() and target_name.startswith("ppt/media/"):
                        if target_name not in registered_media:
                            media_content = archive.read(target_name)
                            media_type = mimetypes.guess_type(target_name)[0] or "application/octet-stream"
                            registered = register_media(media_content, media_type, Path(target_name).name) if register_media else {}
                            registered_media[target_name] = {
                                "artifact_id": registered.get("artifact_id"),
                                "sha256": registered.get("sha256") or hashlib.sha256(media_content).hexdigest(),
                                "media_type": registered.get("media_type") or media_type,
                            }
                        item.update(registered_media[target_name])
                    relationships[relation_id] = item
            objects: list[dict[str, object]] = []
            shape_tree = root.find(".//p:spTree", namespace)
            for ordinal, element in enumerate(list(shape_tree) if shape_tree is not None else [], 1):
                tag = element.tag.rsplit("}", 1)[-1]
                if tag in {"nvGrpSpPr", "grpSpPr"}:
                    continue
                c_nv = element.find(".//p:cNvPr", namespace)
                imported_id = (c_nv.get("id") if c_nv is not None else None) or str(ordinal)
                object_type, support_level = "unknown", "unsupported"
                artifact_id: str | None = None
                artifact_sha256: str | None = None
                relation_ids: list[str] = []
                if tag == "sp":
                    object_type = "text" if element.findall(".//a:t", namespace) else "shape"
                    support_level = "native_structure"
                elif tag == "pic":
                    object_type, support_level = "image", "raster_local"
                    blip = element.find(".//a:blip", namespace)
                    relation_id = blip.get(f"{{{namespace['r']}}}embed", "") if blip is not None else ""
                    if relation_id:
                        relation_ids.append(relation_id)
                        related = relationships.get(relation_id, {})
                        artifact_id = related.get("artifact_id") if isinstance(related.get("artifact_id"), str) else None
                        artifact_sha256 = related.get("sha256") if isinstance(related.get("sha256"), str) else None
                elif tag == "graphicFrame":
                    graphic = element.find(".//a:graphicData", namespace)
                    uri = graphic.get("uri", "") if graphic is not None else ""
                    if element.find(".//a:tbl", namespace) is not None:
                        object_type, support_level = "table", "native_partial"
                    elif element.find(".//c:chart", namespace) is not None:
                        object_type, support_level = "chart", "native_partial"
                    elif "diagram" in uri or element.find(".//dgm:relIds", namespace) is not None:
                        object_type, support_level = "smartart", "native_partial"
                elif tag == "grpSp":
                    object_type, support_level = "group", "native_partial"
                elif tag == "cxnSp":
                    object_type, support_level = "shape", "native_structure"
                if element.find(".//p:oleObj", namespace) is not None:
                    object_type, support_level = "ole", "unsupported"
                if element.find(".//p:video", namespace) is not None or element.find(".//p:audio", namespace) is not None:
                    object_type, support_level = "video", "unsupported"
                objects.append({
                    "object_id": f"slide_{page_index + 1}_object_{imported_id}",
                    "import_id": str(imported_id),
                    "name": c_nv.get("name", "") if c_nv is not None else "",
                    "type": object_type,
                    "bounds": object_bounds(element),
                    "z_index": ordinal,
                    "text": "\n".join(node.text or "" for node in element.findall(".//a:t", namespace)),
                    "font": object_fonts(element),
                    "colors": object_colors(element),
                    "relationship_ids": relation_ids,
                    "media_artifact_id": artifact_id,
                    "media_sha256": artifact_sha256,
                    "support_level": support_level,
                })
            if root.find(".//p:timing", namespace) is not None:
                objects.append({"object_id": f"slide_{page_index + 1}_animations", "import_id": "animations", "name": "Animations", "type": "animation", "bounds": {"x": 0, "y": 0, "width": 0, "height": 0, "unit": "emu"}, "z_index": len(objects) + 1, "text": "", "font": {}, "colors": [], "relationship_ids": [], "media_artifact_id": None, "media_sha256": None, "support_level": "unsupported"})
            master = next((item for item in relationships.values() if item.get("type") == "slideMaster"), None)
            pages.append({
                "order_index": page_index,
                "slide_id": f"slide_{page_index + 1}",
                "objects": objects,
                "relationships": list(relationships.values()),
                "master_reference": hashlib.sha256(json.dumps(master, sort_keys=True).encode("utf-8")).hexdigest() if master else None,
                "visual_reference_artifact_id": None,
                "visual_reference_status": "requires_render",
            })
        presentation = ET.fromstring(archive.read("ppt/presentation.xml")) if "ppt/presentation.xml" in archive.namelist() else None
        size = presentation.find(".//p:sldSz", namespace) if presentation is not None else None
        page_size = {"width": int(size.get("cx", 12192000)) if size is not None else 12192000, "height": int(size.get("cy", 6858000)) if size is not None else 6858000, "unit": "emu"}
    source_hash = source_sha256 or hashlib.sha256(content).hexdigest()
    aggregate = hashlib.sha256(json.dumps({"source_sha256": source_hash, "page_size": page_size, "pages": pages}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"source_artifact_id": source_artifact_id, "source_sha256": source_hash, "page_size": page_size, "pages": pages, "aggregate_sha256": aggregate, "schema_version": SCHEMA_VERSION}


def _pdf_text(content: bytes) -> tuple[str, tuple[str, ...]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise DocumentError("PDF extraction requires the kernel dependency set") from exc
    try:
        document = PdfReader(BytesIO(content), strict=False)
    except Exception as exc:
        raise DocumentError("PDF cannot be opened") from exc
    if len(document.pages) > 500:
        raise DocumentError("PDF exceeds the page limit")
    try:
        pages = [(page.extract_text() or "").strip() for page in document.pages]
    except Exception as exc:
        raise DocumentError("PDF text extraction failed") from exc
    warnings = ("scanned_or_empty_pdf",) if not any(pages) else ()
    return "\n\n".join(f"# Page {index}\n{text}" for index, text in enumerate(pages, 1)), warnings


_DATE = re.compile(r"(?<!\d)(?:19|20)\d{2}(?:[年./-](?:0?[1-9]|1[0-2])(?:[月./-](?:0?[1-9]|[12]\d|3[01])日?)?)?")
_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?:%|％|万|亿|元|万元|亿元|人|项|个|倍|天|年)?")
_ORGANIZATION = re.compile(r"(?:[A-Za-z][A-Za-z0-9& .-]{1,40}|[\u4e00-\u9fff]{2,20})(?:公司|集团|大学|学院|研究院|委员会|部门|中心|团队|银行)")
_PERSON = re.compile(r"(?:负责人|联系人|作者|主讲人|导师|经理)[：:]\s*([\u4e00-\u9fff]{2,4}|[A-Za-z][A-Za-z .'-]{1,40})")
_TERM = re.compile(r"[`“\"]([^`”\"]{2,60})[`”\"]")


def _conflict_key(kind: str, line: str, value: str) -> str:
    context = _DATE.sub("<date>", _NUMBER.sub("<number>", line.casefold()))
    if kind in {"person", "organization", "term"}:
        context = context.replace(value.casefold(), f"<{kind}>")
    context = re.sub(r"[\W_]+", "", context)
    return f"{kind}:{context[:160]}" if len(context) >= 3 else ""


def _facts(text: str) -> tuple[FactCandidate, ...]:
    found: list[FactCandidate] = []
    seen: set[tuple[str, str]] = set()
    for line_number, line in enumerate(text.splitlines(), 1):
        clean_line = re.sub(r"^#{1,6}\s*|^[\s*+-]+", "", line).strip()
        for kind, pattern in (("date", _DATE), ("metric", _NUMBER)):
            for match in pattern.finditer(line):
                value = match.group(0)
                resolved_kind = "metric" if kind == "metric" and re.search(r"[%％万亿元人项个倍天年]$", value) else ("number" if kind == "metric" else kind)
                key = (resolved_kind, value.casefold())
                if key in seen:
                    continue
                seen.add(key)
                found.append(FactCandidate(resolved_kind, value, value.replace("％", "%").strip(), f"line:{line_number}", 0.9, _conflict_key(resolved_kind, clean_line, value)))
                if len(found) >= 500:
                    return tuple(found)
        for kind, pattern in (("organization", _ORGANIZATION), ("term", _TERM)):
            for match in pattern.finditer(clean_line):
                value = match.group(1) if kind == "term" else match.group(0)
                key = (kind, value.casefold())
                if key in seen:
                    continue
                seen.add(key)
                found.append(FactCandidate(kind, value, re.sub(r"\s+", " ", value.casefold()), f"line:{line_number}", 0.82, _conflict_key(kind, clean_line, value)))
        person = _PERSON.search(clean_line)
        if person:
            value = person.group(1).strip()
            key = ("person", value.casefold())
            if key not in seen:
                seen.add(key)
                found.append(FactCandidate("person", value, value.casefold(), f"line:{line_number}", 0.88, _conflict_key("person", clean_line, value)))
        if 8 <= len(clean_line) <= 300 and not line.lstrip().startswith("#"):
            normalized = re.sub(r"\s+", " ", clean_line)
            key = ("claim", normalized.casefold())
            if key not in seen:
                seen.add(key)
                found.append(FactCandidate("claim", clean_line, normalized.casefold(), f"line:{line_number}", 0.75, _conflict_key("claim", clean_line, clean_line)))
        if len(found) >= 500:
            return tuple(found[:500])
    return tuple(found)


def parse_document(file_name: str, content: bytes) -> ParsedDocument:
    safe_file_name(file_name)
    if len(content) > MAX_FILE_BYTES:
        raise DocumentError("Input exceeds the file size limit")
    suffix = Path(file_name).suffix.casefold()
    warnings: tuple[str, ...] = ()
    if suffix in {".md", ".markdown", ".txt"}:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DocumentError("Markdown must use UTF-8 encoding") from exc
    elif suffix == ".docx":
        text = _docx_text(content)
    elif suffix == ".pptx":
        text = _pptx_text(content)
    elif suffix == ".pdf":
        text, warnings = _pdf_text(content)
    else:
        raise DocumentError("Unsupported document type")
    clean = "\n".join(line.rstrip() for line in text.replace("\x00", "").splitlines()).strip()
    summary = re.sub(r"\s+", " ", clean)[:600]
    return ParsedDocument(MEDIA_TYPES[suffix], clean, summary, _facts(clean), warnings)


def page_drafts_from_markdown(text: str) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    title = ""
    body: list[str] = []
    for line in text.splitlines():
        heading = re.match(r"^#{1,3}\s+(.+?)\s*$", line)
        if heading:
            if title or body:
                pages.append({"title": title or "Untitled", "body": "\n".join(body).strip()})
            title, body = heading.group(1).strip(), []
        elif line.strip():
            body.append(line.strip())
    if title or body:
        pages.append({"title": title or "Untitled", "body": "\n".join(body).strip()})
    if not pages and text.strip():
        pages.append({"title": "Overview", "body": text.strip()})
    return pages[:100]
