import os
import json
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless

from fastppt_runtime.bootstrap import build_runtime
from fastppt_runtime.config import RuntimeSettings
from fastppt_worker.worker import Worker


@skipUnless(os.environ.get("FASTPPT_SERVER_INTEGRATION") == "1", "requires PostgreSQL and S3 integration services")
class ServerBackendIntegrationTests(TestCase):
    def test_postgres_s3_recovery_and_multi_instance_export(self) -> None:
        import boto3

        endpoint = os.environ["FASTPPT_TEST_S3_ENDPOINT"]
        bucket = os.environ.get("FASTPPT_TEST_S3_BUCKET", "fastppt-ci")
        access_key = os.environ["FASTPPT_TEST_S3_ACCESS_KEY"]
        secret_key = os.environ["FASTPPT_TEST_S3_SECRET_KEY"]
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name="us-east-1",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        for attempt in range(60):
            try:
                s3.list_buckets()
                break
            except Exception:
                if attempt == 59:
                    raise
                time.sleep(0.5)
        if bucket not in {item["Name"] for item in s3.list_buckets().get("Buckets", [])}:
            s3.create_bucket(Bucket=bucket)

        with TemporaryDirectory(prefix="fastppt-server-integration-") as temp_name:
            root = Path(temp_name)

            def settings(instance: str) -> RuntimeSettings:
                return RuntimeSettings.load(
                    {
                        "FASTPPT_DEPLOYMENT_MODE": "server",
                        "FASTPPT_DATA_DIR": str(root / instance / "data"),
                        "FASTPPT_TEMP_DIR": str(root / instance / "tmp"),
                        "FASTPPT_EXPORT_DIR": str(root / instance / "exports"),
                        "FASTPPT_DATABASE_URL": os.environ["FASTPPT_TEST_DATABASE_URL"],
                        "FASTPPT_S3_ENDPOINT": endpoint,
                        "FASTPPT_ALLOW_INSECURE_S3": "1",
                        "FASTPPT_S3_BUCKET": bucket,
                        "FASTPPT_S3_REGION": "us-east-1",
                        "FASTPPT_S3_ACCESS_KEY": access_key,
                        "FASTPPT_S3_SECRET_KEY": secret_key,
                        "FASTPPT_SESSION_SECRET": "server-integration-session-secret-32-chars",
                        "FASTPPT_ADMIN_EMAIL": "admin@fastppt.invalid",
                        "FASTPPT_ADMIN_PASSWORD": "server-integration-password",
                        "FASTPPT_CORS_ORIGINS": "https://fastppt.example",
                        # Server storage and queue paths are real; provider calls stay
                        # deterministic so CI never treats a placeholder key as evidence.
                        "FASTPPT_SERVER_INTEGRATION": "1",
                        "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                        "FASTPPT_AGENT_BACKEND": "deterministic_test",
                        "FASTPPT_MODEL": "fastppt-deterministic",
                        "FASTPPT_RENDER_BACKEND": "unavailable",
                    }
                )

            runtime_a = build_runtime(settings("instance-a"))
            runtime_b = build_runtime(settings("instance-b"))
            owner = runtime_a.store.user_by_email("admin@fastppt.invalid")
            self.assertIsNotNone(owner)
            project = runtime_a.service.create_project(owner["user_id"], "Server integration")
            document = runtime_a.service.ingest_document(
                owner["user_id"], project["project_id"], "source.md", b"# Server path\nPostgreSQL and S3 are verified in 2026."
            )
            self.assertEqual(document["parse_status"], "queued")

            worker_b = Worker(runtime_b, "integration-worker-b")
            self.assertTrue(worker_b.run_once())
            parsed = runtime_a.store.get_document(project["project_id"], document["document_id"])
            self.assertEqual(parsed["parse_status"], "ready")

            recovery = runtime_a.store.enqueue_job(
                project["project_id"],
                "parse_document",
                {"owner_id": owner["user_id"], "document_id": document["document_id"]},
                "integration-expired-lease",
            )
            claimed = runtime_a.store.claim_job("crashed-worker", lease_seconds=0, kinds=("parse_document",))
            self.assertEqual(claimed["job_id"], recovery["job_id"])
            self.assertTrue(worker_b.run_once())
            self.assertEqual(runtime_a.store.get_job(recovery["job_id"])["status"], "completed")

            session = runtime_a.service.create_session(
                owner["user_id"], project["project_id"], "document_create", [document["document_id"]]
            )
            plan = runtime_a.service.create_generation_plan(owner["user_id"], project["project_id"], session["session_id"])
            content = runtime_a.service.confirm_generation_plan(owner["user_id"], project["project_id"], plan["plan_id"])
            self.assertEqual(content["status"], "awaiting_design_confirmation")
            visuals = runtime_a.service.confirm_generation_design(owner["user_id"], project["project_id"], plan["plan_id"])
            self.assertEqual(visuals["status"], "awaiting_visual_confirmation")
            for page in runtime_b.store.list_pages(project["project_id"]):
                visual = runtime_b.store.get_artifact(project["project_id"], page["visual_preview_artifact_id"])
                runtime_a.service.approve_visual(
                    owner["user_id"],
                    project["project_id"],
                    page["page_id"],
                    {
                        "contract_revision": 1,
                        "visual_artifact_id": visual["artifact_id"],
                        "visual_sha256": visual["sha256"],
                        "comment": "approved in server integration",
                    },
                )
                preflight = runtime_a.service.reconstruction_preflight(
                    owner["user_id"], project["project_id"], page["page_id"]
                )
                reconstruction = runtime_a.service.request_reconstruction(
                    owner["user_id"],
                    project["project_id"],
                    page["page_id"],
                    {
                        "disclosure_sha256": preflight["disclosure_sha256"],
                        "accept_wait_time": True,
                        "accept_supplier_fee_risk": True,
                        "accept_visual_difference": True,
                        "accept_editable_boundary": True,
                        "accepted_unsupported_object_ids": [
                            item["object_id"] for item in preflight["unsupported_items"]
                        ],
                        "idempotency_key": f"server-integration-reconstruct:{page['page_id']}",
                    },
                )
                self.assertTrue(worker_b.run_once())
                self.assertEqual(runtime_a.store.get_job(reconstruction["job_id"])["status"], "completed")
            self.assertEqual(runtime_a.store.get_plan(project["project_id"], plan["plan_id"])["status"], "completed")

            page_from_b = runtime_b.store.list_pages(project["project_id"])[0]
            preview_from_b, preview_type = runtime_b.service.artifact_download(
                owner["user_id"], project["project_id"], page_from_b["visual_preview_artifact_id"]
            )
            self.assertEqual(preview_type, "image/png")
            self.assertTrue(preview_from_b.startswith(b"\x89PNG\r\n\x1a\n"))

            queued_export = runtime_a.service.export_project(owner["user_id"], project["project_id"])
            self.assertEqual(queued_export["status"], "queued")
            self.assertTrue(worker_b.run_once())
            completed_export = runtime_a.store.get_export(project["project_id"], queued_export["export_id"])
            self.assertEqual(completed_export["status"], "degraded")
            self.assertEqual(completed_export["qa"]["svg_qa_status"], "passed")
            self.assertRegex(completed_export["qa"]["svg_qa_sha256"], r"^[0-9a-f]{64}$")
            pptx_from_b, media_type = runtime_b.service.artifact_download(
                owner["user_id"], project["project_id"], completed_export["artifact_id"]
            )
            self.assertEqual(media_type, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
            self.assertTrue(pptx_from_b.startswith(b"PK"))

            completed_runs = [item for item in runtime_a.store.list_agent_runs(project["project_id"]) if item.get("status") == "completed"]
            self.assertTrue(completed_runs)
            anchor = completed_runs[-1]
            input_ids = list(anchor.get("input_artifact_ids") or [])
            input_hashes = []
            for artifact_id in input_ids:
                artifact = runtime_a.store.get_artifact(project["project_id"], artifact_id)
                if artifact:
                    input_hashes.append("sha256:" + str(artifact["sha256"]).removeprefix("sha256:"))
            usage = runtime_a.store.usage_by_request(anchor["usage_request_id"])
            evidence = {
                "evidence_type": "server_postgres_s3_multi_instance",
                "schema_version": "1.2.0",
                "project_id": project["project_id"],
                "agent_run_id": anchor["agent_run_id"],
                "provider_request_id": f"server-integration:{project['project_id']}",
                "status": "completed",
                "provider_snapshot": {"backend": "server_integration", "endpoint_mode": "server", "model": "postgresql+s3"},
                "prompt_artifact_id": anchor.get("prompt_artifact_id") or "server-integration-prompt",
                "input_artifact_ids": input_ids,
                "input_artifact_hashes": input_hashes,
                "input_context_digest": anchor.get("input_context_digest") or anchor.get("context_digest") or "sha256:server-integration",
                "prompt_digest": anchor.get("prompt_digest") or "sha256:server-integration",
                "output_artifact_ids": list(anchor.get("output_artifact_ids") or []),
                "output_digest": anchor.get("output_digest") or "sha256:server-integration",
                "usage_request_id": anchor["usage_request_id"],
                "usage": [usage] if usage else [],
                "server_snapshot": {
                    "metadata_store": "postgres",
                    "artifact_store": "s3",
                    "instances": ["instance-a", "instance-b"],
                    "cross_instance_parse": True,
                    "expired_lease_recovery": True,
                    "async_export": True,
                    "svg_qa_status": completed_export["qa"]["svg_qa_status"],
                },
                "redaction": {"full_prompt": "omitted", "raw_response": "omitted", "credentials": "omitted"},
            }
            evidence_dir = Path(__file__).resolve().parents[2] / "output" / "provider-evidence"
            evidence_dir.mkdir(parents=True, exist_ok=True)
            (evidence_dir / f"server-postgres-s3-{project['project_id']}.json").write_text(
                json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8"
            )
