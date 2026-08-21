"""Bounded document extraction for supported FastPPT source formats."""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET


SUPPORTED_SUFFIXES = frozenset({".md", ".markdown", ".docx", ".pdf", ".pptx"})
MEDIA_TYPES = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
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
        raise DocumentError("Supported inputs are Markdown, DOCX, PDF, and PPTX")
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
    if suffix in {".md", ".markdown"}:
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
