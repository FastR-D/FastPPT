import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_runtime.artifacts import FilesystemArtifactStore
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.service import ApplicationService
from fastppt_runtime.store import SQLiteMetadataStore


class LocalFlowTests(TestCase):
    @staticmethod
    def _complete_generation(service, store, owner_id: str, project_id: str, plan_id: str) -> dict:
        design = service.confirm_generation_design(owner_id, project_id, plan_id)
        pages = store.list_pages(project_id)
        for page in pages:
            visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
            service.approve_visual(owner_id, project_id, page["page_id"], {
                "contract_revision": 1,
                "visual_artifact_id": visual["artifact_id"],
                "visual_sha256": visual["sha256"],
                "comment": "approved in test",
            })
        for page in pages:
            preflight = service.reconstruction_preflight(owner_id, project_id, page["page_id"])
            service.request_reconstruction(owner_id, project_id, page["page_id"], {
                "disclosure_sha256": preflight["disclosure_sha256"],
                "accept_wait_time": True,
                "accept_supplier_fee_risk": True,
                "accept_visual_difference": True,
                "accept_editable_boundary": True,
                "accepted_unsupported_object_ids": [item["object_id"] for item in preflight["unsupported_items"]],
                "idempotency_key": f"test-reconstruct:{page['page_id']}",
            })
            service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])
        return service.store.get_plan(project_id, plan_id)

    def test_chinese_document_to_versioned_editable_pptx_and_rollback(self) -> None:
        with TemporaryDirectory(prefix="FastPPT 中文 空格 ") as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                    "FASTPPT_AGENT_BACKEND": "deterministic_test",
                    "FASTPPT_DATA_DIR": str(root / "data"),
                    "FASTPPT_TEMP_DIR": str(root / "tmp"),
                    "FASTPPT_EXPORT_DIR": str(root / "exports"),
                }
            )
            settings.prepare_directories()
            store = SQLiteMetadataStore(settings.data_dir / "metadata.sqlite3")
            store.initialize()
            artifacts = FilesystemArtifactStore(settings.data_dir / "artifacts")
            service = ApplicationService(settings, store, artifacts)
            user = store.ensure_local_user()
            project = service.create_project(user["user_id"], "中文项目")
            source = "# 项目进展\n2026年8月完成第一阶段，覆盖率达到 95%。\n\n# 下一步\n计划投入 3 人完成发布。".encode("utf-8")
            document = service.ingest_document(user["user_id"], project["project_id"], "汇报.md", source)
            self.assertEqual(document["parse_status"], "ready")
            self.assertGreaterEqual(len(store.list_facts(project["project_id"])), 3)

            session = service.create_session(user["user_id"], project["project_id"], "document_create", [document["document_id"]])
            plan = service.create_generation_plan(user["user_id"], project["project_id"], session["session_id"])
            self.assertTrue(plan["confirmation_required"])
            content = service.confirm_generation_plan(user["user_id"], project["project_id"], plan["plan_id"])
            self.assertEqual(content["status"], "awaiting_design_confirmation")
            completed_plan = self._complete_generation(service, store, user["user_id"], project["project_id"], plan["plan_id"])
            self.assertEqual(completed_plan["status"], "completed")

            pages_before = store.list_pages(project["project_id"])
            first_contract = service._page_contract(project["project_id"], pages_before[0])
            second_contract = service._page_contract(project["project_id"], pages_before[1])
            first_fact_values = {item["value"] for item in store.list_facts(project["project_id"]) if item["fact_id"] in first_contract.required_fact_ids}
            second_fact_values = {item["value"] for item in store.list_facts(project["project_id"]) if item["fact_id"] in second_contract.required_fact_ids}
            self.assertTrue(any("2026" in value for value in first_fact_values))
            self.assertTrue(any("95" in value for value in first_fact_values))
            self.assertTrue(any("3" in value for value in second_fact_values))
            self.assertFalse(any("95" in value for value in second_fact_values))
            self.assertEqual(first_contract.source_hashes, (document["sha256"],))
            operation = service.create_edit_operation(
                user["user_id"], project["project_id"], "标题保持一行并提高层级", "single", [pages_before[0]["page_id"]]
            )
            self.assertEqual(operation["status"], "planned")
            operation = service.confirm_operation(user["user_id"], project["project_id"], operation["operation_id"])
            self.assertEqual(operation["status"], "completed")
            self.assertNotEqual(store.get_page(project["project_id"], pages_before[0]["page_id"])["current_version_id"], pages_before[0]["current_version_id"])
            rolled_back = service.rollback_operation(user["user_id"], project["project_id"], operation["operation_id"])
            self.assertEqual(rolled_back["status"], "rolled_back")
            self.assertEqual(store.get_page(project["project_id"], pages_before[0]["page_id"])["current_version_id"], pages_before[0]["current_version_id"])

            exported = service.export_project(user["user_id"], project["project_id"])
            self.assertEqual(exported["status"], "degraded")
            self.assertEqual(exported["qa"]["product_version"], "v1.2.0")
            self.assertEqual(exported["qa"]["technical_version"], "1.2.0")
            self.assertEqual(exported["qa"]["schema_version"], "1.2.0")
            content, _ = service.artifact_download(user["user_id"], project["project_id"], exported["artifact_id"])
            pptx_path = root / "result.pptx"
            pptx_path.write_bytes(content)
            with zipfile.ZipFile(pptx_path) as archive:
                self.assertIsNone(archive.testzip())
                slides = [name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
                self.assertEqual(len(slides), 2)
                self.assertTrue(any(b"2026" in archive.read(name) for name in slides))

    def test_pptx_improve_round_trip_preserves_sources_and_confirmation(self) -> None:
        with TemporaryDirectory(prefix="fastppt-pptx-improve-") as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                    "FASTPPT_AGENT_BACKEND": "deterministic_test",
                    "FASTPPT_DATA_DIR": str(root / "data"),
                    "FASTPPT_TEMP_DIR": str(root / "tmp"),
                    "FASTPPT_EXPORT_DIR": str(root / "exports"),
                }
            )
            settings.prepare_directories()
            store = SQLiteMetadataStore(settings.data_dir / "metadata.sqlite3")
            store.initialize()
            artifacts = FilesystemArtifactStore(settings.data_dir / "artifacts")
            service = ApplicationService(settings, store, artifacts)
            user = store.ensure_local_user()

            source_project = service.create_project(user["user_id"], "Source deck")
            service.materialize_pages(
                user["user_id"],
                source_project["project_id"],
                [
                    {"title": "Quarterly progress", "body": "In August 2026, coverage reached 95%.", "page_type": "cover"},
                    {"title": "Next step", "body": "Assign 3 people to complete the release.", "page_type": "content"},
                ],
            )
            source_export = service.export_project(user["user_id"], source_project["project_id"])
            source_pptx, _ = service.artifact_download(
                user["user_id"], source_project["project_id"], source_export["artifact_id"]
            )

            project = service.create_project(user["user_id"], "Improved deck")
            document = service.ingest_document(
                user["user_id"], project["project_id"], "source.pptx", source_pptx
            )
            self.assertEqual(document["parse_status"], "ready")
            self.assertGreaterEqual(len(store.list_facts(project["project_id"])), 3)

            session = service.create_session(
                user["user_id"], project["project_id"], "pptx_improve", [document["document_id"]]
            )
            plan = service.create_generation_plan(
                user["user_id"], project["project_id"], session["session_id"]
            )
            self.assertEqual(plan["structured_plan"]["workflowMode"], "pptx_improve")
            samples = service.confirm_generation_plan(
                user["user_id"], project["project_id"], plan["plan_id"]
            )
            self.assertEqual(samples["status"], "awaiting_design_confirmation")
            completed_plan = self._complete_generation(service, store, user["user_id"], project["project_id"], plan["plan_id"])
            self.assertEqual(completed_plan["status"], "completed")

            pages = store.list_pages(project["project_id"])
            operation = service.create_edit_operation(
                user["user_id"], project["project_id"], "Use a consistent visual hierarchy", "global", []
            )
            self.assertTrue(operation["confirmation_required"])
            self.assertEqual(operation["structured_plan"]["workflowMode"], "pptx_improve")
            completed = service.confirm_operation(
                user["user_id"], project["project_id"], operation["operation_id"]
            )
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(len(completed["result_version_ids"]), 2)

            bound_fact_sets = []
            for page in store.list_pages(project["project_id"]):
                contract = service._page_contract(project["project_id"], page)
                self.assertEqual(contract.source_hashes, (document["sha256"],))
                self.assertGreaterEqual(len(contract.required_fact_ids), 1)
                bound_fact_sets.append(set(contract.required_fact_ids))
            self.assertNotEqual(bound_fact_sets[0], bound_fact_sets[1])

            improved_export = service.export_project(user["user_id"], project["project_id"])
            improved_pptx, _ = service.artifact_download(
                user["user_id"], project["project_id"], improved_export["artifact_id"]
            )
            improved_path = root / "improved.pptx"
            improved_path.write_bytes(improved_pptx)
            with zipfile.ZipFile(improved_path) as archive:
                self.assertIsNone(archive.testzip())
                slides = [
                    name
                    for name in archive.namelist()
                    if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                ]
                self.assertEqual(len(slides), len(pages))
