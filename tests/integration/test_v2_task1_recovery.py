import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_core.v2 import sha256_json
from fastppt_runtime.bootstrap import build_runtime
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.service import ConflictError
from fastppt_runtime.task1 import TASK1_PAGE_IDS, Task1Runner, load_task1_fixture
from fastppt_runtime.v2_artifacts import ArtifactCommitError, ArtifactCommitManager, ArtifactMissingError


class V2Task1RecoveryTests(TestCase):
    def _style_template_payload(self, project_id: str, key: str) -> dict:
        fixture = load_task1_fixture()
        return {
            "schema_version": "2.0.0",
            "project_id": project_id,
            "page_contract_ids": list(TASK1_PAGE_IDS),
            "selection": {
                "style_version_ref": {
                    "id": fixture["style"].style_id,
                    "version": fixture["style"].version,
                    "content_hash": fixture["style"].content_hash,
                    "capability_matrix": dict(fixture["style"].capability_matrix),
                },
                "template_version_ref": {
                    "id": fixture["template"].template_id,
                    "version": fixture["template"].version,
                    "content_hash": fixture["template"].content_hash,
                    "capability_matrix": {},
                },
            },
            "expected_mode": "style_template",
            "idempotency_key": key,
            "confirmed": False,
        }

    def test_staged_reconcile_is_idempotent_and_detects_missing_committed_bytes(self) -> None:
        with TemporaryDirectory() as temp_name:
            manager = ArtifactCommitManager(Path(temp_name))
            staged = manager.stage("project", "artifact", b"immutable bytes", "job-key")
            first = manager.reconcile("project", "job-key")
            second = manager.reconcile("project", "job-key")
            self.assertEqual(first["status"], "reconciled")
            self.assertEqual(second["sha256"], first["artifacts"][0]["sha256"])
            record = manager.commit(staged)
            published = manager.root / record["storage_path"]
            published.unlink()
            with self.assertRaises(ArtifactMissingError):
                manager.reconcile("project", "job-key")

    def test_same_idempotency_key_cannot_change_bytes_or_published_artifact(self) -> None:
        with TemporaryDirectory() as temp_name:
            manager = ArtifactCommitManager(Path(temp_name))
            staged = manager.stage("project", "artifact", b"first", "same")
            manager.commit(staged)
            with self.assertRaises(ArtifactCommitError):
                manager.stage("project", "artifact", b"second", "same")
            other = manager.stage("project", "artifact", b"first", "other")
            self.assertEqual(manager.publish(other).read_bytes(), b"first")

    def test_same_idempotency_key_can_reconcile_multiple_artifacts(self) -> None:
        with TemporaryDirectory() as temp_name:
            manager = ArtifactCommitManager(Path(temp_name))
            manager.stage("project", "page-1.svg", b"one", "job")
            manager.stage("project", "page-2.svg", b"two", "job")
            first = manager.reconcile("project", "job")
            second = manager.reconcile("project", "job")
            self.assertEqual(first["status"], "reconciled")
            self.assertEqual({item["artifact_id"] for item in first["artifacts"]}, {"page-1.svg", "page-2.svg"})
            self.assertEqual({item["artifact_id"] for item in second["artifacts"]}, {"page-1.svg", "page-2.svg"})

    def test_recovery_checkpoint_has_v2_hash_and_committed_outputs(self) -> None:
        from fastppt_runtime.v2_artifacts import RecoveryCheckpoint

        checkpoint = RecoveryCheckpoint("job", "reconciled", "sha256:" + "a" * 64, ("version-1",), "key")
        payload = checkpoint.to_dict()
        self.assertEqual(payload["schema_version"], "2.0.0")
        self.assertEqual(payload["committed_outputs"], ["version-1"])
        self.assertTrue(payload["content_hash"].startswith("sha256:"))

    def test_manifest_recovery_reconciles_every_missing_persistence_record(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_DEPLOYMENT_MODE": "local",
                    "FASTPPT_DATA_DIR": str(root / "data"),
                    "FASTPPT_TEMP_DIR": str(root / "tmp"),
                    "FASTPPT_EXPORT_DIR": str(root / "exports"),
                }
            )
            runtime = build_runtime(settings)
            owner = runtime.local_user
            assert owner is not None
            project = runtime.service.create_project(owner["user_id"], "Recover task one")
            payload = self._style_template_payload(project["project_id"], "recover-after-checkpoint")
            preview = runtime.service.task1_preview(owner["user_id"], project["project_id"], payload)
            payload.update(
                {
                    "confirmed": True,
                    "preview_artifact_hash": preview["design_snapshot"]["preview_artifact_hash"],
                    "confirmed_by": "task1-user",
                    "confirmed_at": "2026-01-01T00:00:00+00:00",
                }
            )
            original_checkpoint = runtime.store.create_v2_checkpoint
            calls = 0

            def interrupt_once(*args, **kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise RuntimeError("injected checkpoint interruption")
                return original_checkpoint(*args, **kwargs)

            runtime.store.create_v2_checkpoint = interrupt_once  # type: ignore[method-assign]
            with self.assertRaisesRegex(RuntimeError, "injected checkpoint interruption"):
                runtime.service.task1_generate(owner["user_id"], project["project_id"], payload)

            runtime = build_runtime(settings)
            self.assertEqual(runtime.service.task1_startup_reconciliation["status"], "completed")
            self.assertEqual(
                runtime.service.task1_startup_reconciliation["reconciled"],
                [{"project_id": project["project_id"], "idempotency_key": payload["idempotency_key"]}],
            )
            recovered = runtime.service.task1_recover(owner["user_id"], project["project_id"], payload["idempotency_key"])
            self.assertEqual(recovered["status"], "recovered")
            with runtime.store.connection() as connection:
                counts = {
                    table: connection.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE project_id=?",
                        (project["project_id"],),
                    ).fetchone()[0]
                    for table in (
                        "v2_design_snapshots",
                        "v2_page_contract_snapshots",
                        "v2_generation_checkpoints",
                        "v2_artifact_commits",
                        "v2_export_snapshots",
                        "v2_export_attempts",
                    )
                }
            self.assertEqual(counts["v2_design_snapshots"], 2)
            self.assertEqual(counts["v2_page_contract_snapshots"], 3)
            self.assertEqual(counts["v2_generation_checkpoints"], 1)
            self.assertEqual(counts["v2_artifact_commits"], 2)
            self.assertEqual(counts["v2_export_snapshots"], 1)
            self.assertEqual(counts["v2_export_attempts"], 1)

    def test_recovery_rejects_tampered_nested_hash_before_any_persistence(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_DEPLOYMENT_MODE": "local",
                    "FASTPPT_DATA_DIR": str(root / "data"),
                    "FASTPPT_TEMP_DIR": str(root / "tmp"),
                    "FASTPPT_EXPORT_DIR": str(root / "exports"),
                }
            )
            runtime = build_runtime(settings)
            owner = runtime.local_user
            assert owner is not None
            project = runtime.service.create_project(owner["user_id"], "Reject tampered recovery")
            payload = self._style_template_payload(project["project_id"], "tampered-checkpoint")
            payload["selection"] = {"style_version_ref": None, "template_version_ref": None}
            payload["expected_mode"] = "none_none"
            output_dir = settings.data_dir / "task1" / project["project_id"] / payload["idempotency_key"]
            Task1Runner().run(payload, output_dir=output_dir)

            manifest_path = output_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["recovery_checkpoint"]["stage"] = "tampered"
            manifest["content_hash"] = sha256_json(
                {key: value for key, value in manifest.items() if key != "content_hash"}
            )
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

            with self.assertRaisesRegex(ConflictError, "RecoveryCheckpoint content hash"):
                runtime.service.task1_recover(
                    owner["user_id"], project["project_id"], payload["idempotency_key"]
                )
            with runtime.store.connection() as connection:
                counts = {
                    table: connection.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE project_id=?",
                        (project["project_id"],),
                    ).fetchone()[0]
                    for table in (
                        "v2_design_snapshots",
                        "v2_page_contract_snapshots",
                        "v2_generation_checkpoints",
                        "v2_artifact_commits",
                        "v2_export_snapshots",
                        "v2_export_attempts",
                    )
                }
            self.assertEqual(set(counts.values()), {0})
