import io
import zipfile
from unittest import TestCase

from fastppt_core.documents import DocumentError, parse_document, safe_file_name


class DocumentSecurityTests(TestCase):
    def test_rejects_unsafe_names(self) -> None:
        for value in ("../report.md", "folder/report.md", "folder\\report.md"):
            with self.subTest(value=value), self.assertRaises(DocumentError):
                safe_file_name(value)

    def test_rejects_zip_traversal(self) -> None:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("../word/document.xml", "invalid")
        with self.assertRaises(DocumentError):
            parse_document("unsafe.docx", stream.getvalue())
