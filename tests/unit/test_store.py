from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_runtime.store import SQLiteMetadataStore


class StoreTests(TestCase):
    def test_initialize_migrates_legacy_work_session_options(self) -> None:
        with TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "metadata.sqlite3"
            store = SQLiteMetadataStore(path)
            store.initialize()
            with store.connection() as connection:
                connection.execute("ALTER TABLE work_sessions DROP COLUMN options_json")
                connection.execute("ALTER TABLE reconstruction_manifests DROP COLUMN artifact_id")
            store.initialize()
            with store.connection() as connection:
                session_columns = {row[1] for row in connection.execute("PRAGMA table_info(work_sessions)").fetchall()}
                manifest_columns = {row[1] for row in connection.execute("PRAGMA table_info(reconstruction_manifests)").fetchall()}
            self.assertIn("options_json", session_columns)
            self.assertIn("artifact_id", manifest_columns)

    def test_new_reconstruction_manifest_uses_current_schema_version(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "Manifest version")
            manifest = store.create_reconstruction_manifest(
                project["project_id"],
                {
                    "page_id": "page_test",
                    "version_id": "version_test",
                    "page_contract_artifact_id": "artifact_contract",
                    "visual_approval_id": "approval_test",
                    "objects": [{"object_id": "object_test"}],
                    "aggregate_sha256": "a" * 64,
                },
            )
            self.assertEqual(manifest["schema_version"], "1.2.0")

    def test_queue_is_persistent_and_idempotent(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "Queue Test")
            first = store.enqueue_job(project["project_id"], "parse", {"document_id": "one"}, "same")
            second = store.enqueue_job(project["project_id"], "parse", {"document_id": "two"}, "same")
            self.assertEqual(first["job_id"], second["job_id"])
            claimed = store.claim_job("worker-one")
            self.assertEqual(claimed["job_id"], first["job_id"])
            self.assertTrue(store.complete_job(first["job_id"], "worker-one"))

    def test_expired_lease_is_recovered_and_retries_are_bounded(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "Lease Test")
            job = store.enqueue_job(project["project_id"], "parse", {"document_id": "one"}, "lease", max_attempts=2)

            first = store.claim_job("worker-one", lease_seconds=0)
            self.assertEqual(first["job_id"], job["job_id"])
            recovered = store.claim_job("worker-two")
            self.assertEqual(recovered["job_id"], job["job_id"])
            self.assertEqual(recovered["attempts"], 2)
            self.assertTrue(store.complete_job(job["job_id"], "worker-two", error="transient"))
            failed = store.get_job(job["job_id"])
            self.assertEqual(failed["status"], "failed")
            self.assertIsNone(store.claim_job("worker-three"))

    def test_usage_ledger_enforces_reserve_submit_retry_settle_and_release(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "Usage Test")
            request_id = "request_" + "1" * 32
            reserved = store.reserve_usage(
                project["project_id"], None, request_id, "codex", "gpt-test",
                {"input_per_million": 1, "currency": "USD"},
                {"requests": 1, "amount": 0.01, "currency": "USD"},
            )
            self.assertEqual(reserved["submission_status"], "reserved")
            self.assertEqual(store.update_usage(request_id, "submitted")["submission_status"], "submitted")
            self.assertEqual(store.update_usage(request_id, "failed", error="known_rejection")["submission_status"], "failed")
            retried = store.retry_usage(request_id)
            self.assertEqual(retried["submission_status"], "submitted")
            self.assertEqual(retried["retry_count"], 1)
            unknown = store.update_usage(request_id, "submission_unknown", error="timeout")
            self.assertEqual(unknown["submission_status"], "submission_unknown")
            settled = store.update_usage(request_id, "settled", settled={"input_tokens": 10, "amount": 0.001})
            self.assertEqual(settled["settled"]["input_tokens"], 10)
            released = store.update_usage(request_id, "released", error="refunded")
            self.assertEqual(released["submission_status"], "released")
            with self.assertRaises(ValueError):
                store.update_usage(request_id, "submitted")
