import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from tools.check_release_gates import REQUIRED_EVIDENCE, audit_release, validate_evidence_record, validate_powerpoint_render_evidence
from tools.evidence_proof import sign_evidence_record


class ReleaseAuditTests(TestCase):
    SIGNING_KEY = "release-audit-test-key"

    @staticmethod
    def _bound_record(evidence_type: str, backend: str = "codex") -> dict:
        project_id = "project_" + "1" * 32
        run_id = "agent_run_" + "2" * 32
        prompt_id = "artifact_" + "3" * 32
        output_id = "artifact_" + "4" * 32
        request_id = "request_" + "5" * 32
        output_hash = "sha256:" + "b" * 64
        binding = {
            "binding_version": "1.0",
            "project_id": project_id,
            "run": {
                "run_id": run_id,
                "run_kind": "agent_run",
                "status": "completed",
                "provider_request_id": "12345678-1234-4234-8234-123456789012",
                "prompt_artifact_id": prompt_id,
                "input_artifact_ids": [],
                "output_artifact_ids": [output_id],
                "usage_request_id": request_id,
            },
            "prompt_artifact": {"artifact_id": prompt_id, "sha256": "sha256:" + "a" * 64, "media_type": "application/json", "size_bytes": 1, "kind": "prompt_envelope"},
            "input_artifacts": [],
            "output_artifacts": [{"artifact_id": output_id, "sha256": output_hash, "media_type": "application/json", "size_bytes": 1, "kind": "agent_output"}],
            "usage": {"request_id": request_id, "project_id": project_id, "submission_status": "settled"},
        }
        binding["binding_digest"] = "sha256:" + hashlib.sha256(json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        record = {
            "evidence_type": evidence_type,
            "schema_version": "1.2.0",
            "project_id": project_id,
            "agent_run_id": run_id,
            "provider_request_id": binding["run"]["provider_request_id"],
            "status": "completed",
            "provider_snapshot": {"backend": backend, "endpoint_mode": "relay", "model": "fixture"},
            "prompt_artifact_id": prompt_id,
            "input_artifact_ids": [],
            "input_artifact_hashes": [],
            "prompt_digest": "sha256:" + "a" * 64,
            "output_artifact_ids": [output_id],
            "output_digest": output_hash,
            "usage_request_id": request_id,
            "usage": [{"request_id": request_id, "project_id": project_id, "submission_status": "settled"}],
            "binding": binding,
            "binding_digest": binding["binding_digest"],
            "redaction": {"full_prompt": "omitted", "raw_response": "omitted", "credentials": "omitted"},
        }
        return sign_evidence_record(record, ReleaseAuditTests.SIGNING_KEY)

    def test_evidence_contract_requires_binding_and_redaction(self) -> None:
        valid = self._bound_record(REQUIRED_EVIDENCE["codex_relay_agent"], backend="codex")
        self.assertEqual(validate_evidence_record(valid, signing_key=self.SIGNING_KEY), [])
        invalid = dict(valid)
        invalid["redaction"] = {"full_prompt": "omitted", "raw_response": "raw", "credentials": "omitted"}
        self.assertIn("redaction:raw_response", validate_evidence_record(invalid, signing_key=self.SIGNING_KEY))

    def test_evidence_contract_rejects_self_consistent_record_signed_by_another_key(self) -> None:
        forged = sign_evidence_record(
            self._bound_record(REQUIRED_EVIDENCE["codex_relay_agent"], backend="codex"),
            "forged-release-audit-key",
        )
        self.assertIn("runtime_proof_signature_invalid", validate_evidence_record(forged, signing_key=self.SIGNING_KEY))

    def test_audit_reports_missing_external_gates_without_fabricating_evidence(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            (root / "output" / "provider-evidence").mkdir(parents=True)
            record = self._bound_record(REQUIRED_EVIDENCE["codex_relay_agent"], backend="codex")
            (root / "output" / "provider-evidence" / "codex.json").write_text(json.dumps(record), encoding="utf-8")
            result = audit_release(root, signing_key=self.SIGNING_KEY)
            self.assertEqual(result["status"], "blocked")
            self.assertIn("missing_evidence:gpt_image_generation", result["blockers"])
            self.assertIn("missing_evidence:gpt_image_edit", result["blockers"])
            self.assertIn("server_integration_evidence_unavailable", result["blockers"])

    def test_external_server_and_render_evidence_can_satisfy_environment_gates(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            evidence_dir = root / "output" / "provider-evidence"
            evidence_dir.mkdir(parents=True)
            for index, evidence_type in enumerate(("server_postgres_s3_multi_instance", "real_powerpoint_render_qa")):
                record = self._bound_record(evidence_type, backend="fixture")
                (evidence_dir / f"external-{index}.json").write_text(json.dumps(record), encoding="utf-8")
            result = audit_release(root, signing_key=self.SIGNING_KEY)
            self.assertTrue(result["checks"]["server_integration"]["verifiable"])
            self.assertTrue(result["checks"]["powerpoint_render"]["available"])

    def test_powerpoint_qa_bundle_is_hash_verified_before_counting_as_evidence(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            qa_dir = root / "output" / "verification-v12-final"
            rendered_dir = qa_dir / "rendered"
            rendered_dir.mkdir(parents=True)
            pptx = b"PK\x03\x04verified-pptx"
            page = b"\x89PNG\r\n\x1a\nverified-render"
            (qa_dir / "fastppt-v1.2.0-verification.pptx").write_bytes(pptx)
            (rendered_dir / "slide-1.png").write_bytes(page)
            sha = lambda value: hashlib.sha256(value).hexdigest()
            qa = {
                "status": "passed",
                "export_qa": {"render_status": "passed", "pptx_qa_status": "passed", "svg_qa_status": "passed"},
                "powerpoint_probe": {"status": "ready", "version": "16.0"},
                "pptx_path": "fastppt-v1.2.0-verification.pptx",
                "pptx_sha256": sha(pptx),
                "pages": [{"index": 1, "path": "rendered/slide-1.png", "sha256": sha(page), "width": 1600, "height": 900}],
            }
            (qa_dir / "powerpoint-qa.json").write_text(json.dumps(qa), encoding="utf-8")

            self.assertEqual(validate_powerpoint_render_evidence(root)["errors"], [])
            qa["export_qa"]["render_status"] = "degraded"
            (qa_dir / "powerpoint-qa.json").write_text(json.dumps(qa), encoding="utf-8")
            conflict = validate_powerpoint_render_evidence(root)
            self.assertIn("export_qa_render_status_not_passed", conflict["errors"])
            self.assertIn("status_render_status_conflict", conflict["errors"])
            qa["export_qa"]["render_status"] = "passed"
            (qa_dir / "powerpoint-qa.json").write_text(json.dumps(qa), encoding="utf-8")
            (rendered_dir / "slide-1.png").write_bytes(b"tampered")
            invalid = validate_powerpoint_render_evidence(root)
            self.assertIn("page[0].sha256_mismatch", invalid["errors"])
