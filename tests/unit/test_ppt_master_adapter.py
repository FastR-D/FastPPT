import hashlib
from unittest import TestCase

from fastppt_ppt_master.adapter import KernelError, PptMasterAdapter


def report_for(files: dict[str, str]) -> dict:
    aggregate = hashlib.sha256()
    for file_name, file_sha256 in sorted(files.items()):
        aggregate.update(file_name.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(file_sha256.encode("ascii"))
        aggregate.update(b"\n")
    return {
        "schema": "ppt-master.svg-quality-report.v1",
        "stage": "final",
        "summary": {"errors": 0},
        "categories": {"blocking": {"count": 0, "issues": []}},
        "source_fingerprint": {
            "algorithm": "sha256",
            "digest": aggregate.hexdigest(),
            "file_count": len(files),
            "files": [{"file": name, "sha256": value} for name, value in sorted(files.items())],
        },
    }


class SvgQualityGateTests(TestCase):
    def test_report_must_bind_exact_input_hashes(self) -> None:
        expected = {"001_page.svg": "a" * 64, "002_page.svg": "b" * 64}
        self.assertEqual(PptMasterAdapter._svg_gate_status(report_for(expected), expected), "passed")

        tampered = report_for(expected)
        tampered["source_fingerprint"]["files"][0]["sha256"] = "c" * 64
        with self.assertRaises(KernelError):
            PptMasterAdapter._svg_gate_status(tampered, expected)

        unknown = report_for(expected)
        unknown.pop("source_fingerprint")
        with self.assertRaises(KernelError):
            PptMasterAdapter._svg_gate_status(unknown, expected)
