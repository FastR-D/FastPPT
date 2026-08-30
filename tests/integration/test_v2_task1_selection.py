import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_runtime.bootstrap import build_runtime
from fastppt_runtime.config import RuntimeSettings
from fastppt_core.v2 import DesignConfirmationRequired, V2ContractError
from fastppt_runtime.task1 import TASK1_PAGE_IDS, TASK1_MODES, Task1Runner, load_task1_fixture


class V2Task1SelectionTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_task1_fixture()
        cls.style_ref = {
            "id": cls.fixture["style"].style_id,
            "version": cls.fixture["style"].version,
            "content_hash": cls.fixture["style"].content_hash,
            "capability_matrix": dict(cls.fixture["style"].capability_matrix),
        }
        cls.template_ref = {
            "id": cls.fixture["template"].template_id,
            "version": cls.fixture["template"].version,
            "content_hash": cls.fixture["template"].content_hash,
            "capability_matrix": dict(cls.fixture["template"].capacity),
        }

    def _payload(self, mode: str, key: str, *, confirmed: bool = False) -> dict:
        return {
            "schema_version": "2.0.0",
            "project_id": "task1-selection-project",
            "page_contract_ids": list(TASK1_PAGE_IDS),
            "selection": {
                "style_version_ref": self.style_ref if "style" in mode else None,
                "template_version_ref": self.template_ref if "template" in mode else None,
            },
            "expected_mode": mode,
            "idempotency_key": key,
            "confirmed": confirmed,
        }

    def _confirmed_payload(self, runner: Task1Runner, payload: dict, output_dir: Path) -> dict:
        preview = runner.preview(payload, output_dir=output_dir)
        return {
            **payload,
            "confirmed": True,
            "preview_artifact_hash": preview.manifest["design_snapshot"]["preview_artifact_hash"],
            "confirmed_by": "task1-user",
            "confirmed_at": "2026-01-01T00:00:00+00:00",
        }

    def test_all_four_modes_validate_and_only_combo_generates_golden_deck(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            for mode in TASK1_MODES:
                runner = Task1Runner()
                payload = self._payload(mode, "mode-" + mode)
                if mode == "style_template":
                    payload = self._confirmed_payload(runner, payload, root / mode / "preview")
                result = runner.run(payload, output_dir=root / mode)
                self.assertEqual(result.mode, mode)
                self.assertEqual(result.status, "completed" if mode == "style_template" else "active")
                self.assertEqual((root / mode / "manifest.json").is_file(), True)
                self.assertEqual((root / mode / "task1-golden.pptx").is_file(), mode == "style_template")

    def test_style_template_preview_confirmation_and_idempotency(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runner = Task1Runner()
            payload = self._payload("style_template", "same-request")
            preview = runner.preview(payload, output_dir=root / "preview")
            self.assertEqual(preview.status, "preview_required")
            self.assertTrue(preview.manifest["design_snapshot"]["preview_artifact_hash"].startswith("sha256:"))
            with self.assertRaises(DesignConfirmationRequired):
                runner.run(payload, output_dir=root / "unconfirmed")
            confirmed = {
                **self._payload("style_template", "same-request", confirmed=True),
                "preview_artifact_hash": preview.manifest["design_snapshot"]["preview_artifact_hash"],
                "confirmed_by": "task1-user",
                "confirmed_at": "2026-01-01T00:00:00+00:00",
            }
            with self.assertRaises(DesignConfirmationRequired):
                Task1Runner().run(confirmed, output_dir=root / "bypass")
            first = runner.run(confirmed, output_dir=root / "run")
            second = runner.run(confirmed, output_dir=root / "other")
            self.assertEqual(first.manifest["content_hash"], second.manifest["content_hash"])
            changed = dict(confirmed)
            changed["confirmed"] = False
            with self.assertRaises(V2ContractError):
                runner.run(changed, output_dir=root / "changed")
            other_project = self._payload("style_template", "same-request", confirmed=False)
            other_project["project_id"] = "different-project"
            other_project = self._confirmed_payload(runner, other_project, root / "other-project-preview")
            independent = runner.run(other_project, output_dir=root / "other-project")
            self.assertNotEqual(first.manifest["export_snapshot"]["export_snapshot_id"], independent.manifest["export_snapshot"]["export_snapshot_id"])

    def test_runtime_registers_task1_pptx_in_artifact_store(self) -> None:
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
            project = runtime.service.create_project(owner["user_id"], "Task one")
            payload = self._payload("style_template", "runtime-task1")
            payload["project_id"] = project["project_id"]
            preview = runtime.service.task1_preview(owner["user_id"], project["project_id"], payload)
            preview_descriptor = preview["preview_artifact"]
            self.assertIsNotNone(runtime.store.get_artifact(project["project_id"], preview_descriptor["artifact_id"]))
            runtime = build_runtime(settings)
            restarted_owner = runtime.local_user
            assert restarted_owner is not None
            self.assertEqual(restarted_owner["user_id"], owner["user_id"])
            payload.update(
                {
                    "confirmed": True,
                    "preview_artifact_hash": preview["design_snapshot"]["preview_artifact_hash"],
                    "confirmed_by": "task1-user",
                    "confirmed_at": "2026-01-01T00:00:00+00:00",
                }
            )
            result = runtime.service.task1_generate(owner["user_id"], project["project_id"], payload)
            descriptor = result["pptx_artifact"]
            stored = runtime.store.get_artifact(project["project_id"], descriptor["artifact_id"])
            self.assertIsNotNone(stored)
            self.assertEqual(stored["sha256"], descriptor["sha256"].removeprefix("sha256:"))
            content, media_type = runtime.service.artifact_download(owner["user_id"], project["project_id"], descriptor["artifact_id"])
            self.assertEqual(len(content), descriptor["size_bytes"])
            self.assertEqual(media_type, descriptor["media_type"])

            mismatched = dict(payload)
            mismatched["project_id"] = "different-project"
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                runtime.service.task1_generate(owner["user_id"], project["project_id"], mismatched)

            other = runtime.service.create_project(owner["user_id"], "Task one second project")
            first_light = self._payload("none_none", "shared-runtime-key")
            first_light["project_id"] = project["project_id"]
            second_light = self._payload("none_none", "shared-runtime-key")
            second_light["project_id"] = other["project_id"]
            first_result = runtime.service.task1_generate(owner["user_id"], project["project_id"], first_light)
            second_result = runtime.service.task1_generate(owner["user_id"], other["project_id"], second_light)
            self.assertNotEqual(first_result["export_snapshot"]["export_snapshot_id"], second_result["export_snapshot"]["export_snapshot_id"])
            with self.assertRaises(V2ContractError):
                runtime.service.task1_recover(owner["user_id"], project["project_id"], "..")

    def test_task1_identifiers_reject_path_traversal_tokens(self) -> None:
        runner = Task1Runner()
        with self.assertRaises(V2ContractError):
            runner.run(self._payload("none_none", "../escape"))
        project_payload = self._payload("none_none", "safe-key")
        project_payload["project_id"] = ".."
        with self.assertRaises(V2ContractError):
            runner.run(project_payload)

    def test_project_copies_deployment_default_version_references(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            environment = {
                "FASTPPT_DEPLOYMENT_MODE": "local",
                "FASTPPT_DATA_DIR": str(root / "data"),
                "FASTPPT_TEMP_DIR": str(root / "tmp"),
                "FASTPPT_EXPORT_DIR": str(root / "exports"),
                "FASTPPT_DEFAULT_STYLE_REF": json.dumps(self.style_ref),
                "FASTPPT_DEFAULT_TEMPLATE_REF": json.dumps(self.template_ref),
            }
            runtime = build_runtime(RuntimeSettings.load(environment))
            owner = runtime.local_user
            assert owner is not None
            project = runtime.service.create_project(owner["user_id"], "Deployment defaults")
            self.assertEqual(
                project["v2_default_selection"],
                {"style_version_ref": self.style_ref, "template_version_ref": self.template_ref},
            )

            changed_environment = {key: value for key, value in environment.items() if not key.startswith("FASTPPT_DEFAULT_")}
            restarted = build_runtime(RuntimeSettings.load(changed_environment))
            stored = restarted.store.get_project(owner["user_id"], project["project_id"])
            self.assertEqual(stored["v2_default_selection"], project["v2_default_selection"])
