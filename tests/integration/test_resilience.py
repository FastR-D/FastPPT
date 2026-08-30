import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_core.svg import render_page_svg
from fastppt_runtime.artifacts import FilesystemArtifactStore
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.service import ApplicationService
from fastppt_runtime.store import SQLiteMetadataStore


class ResilienceTests(TestCase):
    def _service(self, root: Path) -> tuple[ApplicationService, SQLiteMetadataStore, str, str]:
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
        service = ApplicationService(settings, store, FilesystemArtifactStore(settings.data_dir / "artifacts"))
        user = store.ensure_local_user()
        project = service.create_project(user["user_id"], "Resilience")
        return service, store, user["user_id"], project["project_id"]

    @staticmethod
    def _approve_and_reconstruct(service, store, owner_id: str, project_id: str) -> None:
        for page in store.list_pages(project_id):
            visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
            service.approve_visual(owner_id, project_id, page["page_id"], {
                "contract_revision": 1,
                "visual_artifact_id": visual["artifact_id"],
                "visual_sha256": visual["sha256"],
                "comment": "approved in test",
            })
        for page in store.list_pages(project_id):
            preflight = service.reconstruction_preflight(owner_id, project_id, page["page_id"])
            service.request_reconstruction(owner_id, project_id, page["page_id"], {
                "disclosure_sha256": preflight["disclosure_sha256"],
                "accept_wait_time": True,
                "accept_supplier_fee_risk": True,
                "accept_visual_difference": True,
                "accept_editable_boundary": True,
                "accepted_unsupported_object_ids": [],
                "idempotency_key": f"test-reconstruct:{page['page_id']}",
            })
            service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])

    def test_replayed_parse_plan_and_operation_do_not_duplicate_results(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            document = service.ingest_document(owner_id, project_id, "source.md", "# One\n2026 年完成 3 项。".encode())
            fact_count = len(store.list_facts(project_id))
            service.parse_document_record(owner_id, project_id, document["document_id"])
            self.assertEqual(len(store.list_facts(project_id)), fact_count)

            session = service.create_session(owner_id, project_id, "document_create", [document["document_id"]])
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"])
            first_content = service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            second_content = service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            self.assertEqual(first_content["status"], second_content["status"])
            first_samples = service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            second_samples = service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            self.assertEqual(first_samples["pages"], second_samples["pages"])
            self.assertEqual(len(store.list_pages(project_id)), 1)
            self._approve_and_reconstruct(service, store, owner_id, project_id)
            page_id = store.list_pages(project_id)[0]["page_id"]

            operation = service.create_edit_operation(owner_id, project_id, "标题保持一行", "single", [page_id])
            operation = service.confirm_operation(owner_id, project_id, operation["operation_id"])
            before_replay = store.versions_for_page(project_id, page_id)
            replayed = service.execute_operation(owner_id, project_id, operation["operation_id"])
            self.assertEqual(replayed["result_version_ids"], operation["result_version_ids"])
            self.assertEqual(len(store.versions_for_page(project_id, page_id)), len(before_replay))

    def test_export_consumes_the_locked_versions_after_pages_change(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.materialize_pages(
                owner_id,
                project_id,
                [{"title": "LOCKED TITLE", "body": "Approved 2026 fact", "page_type": "cover"}],
            )
            original = store.list_pages(project_id)[0]
            export = store.create_export(project_id, [{"page_id": original["page_id"], "version_id": original["current_version_id"]}])

            marker = "MUTATED VERSION"
            svg = render_page_svg(marker, "This must not enter the locked export", page_number=1, page_role="cover").encode()
            svg_artifact = service._record_artifact(project_id, "svg", svg, "image/svg+xml")
            store.create_page_version(
                project_id,
                original["page_id"],
                {
                    "page_contract_artifact_id": original["page_contract_artifact_id"],
                    "quick_preview_artifact_id": svg_artifact["artifact_id"],
                    "visual_preview_artifact_id": svg_artifact["artifact_id"],
                    "svg_artifact_id": svg_artifact["artifact_id"],
                    "editable_level": "native_structure",
                    "status": "ready",
                    "qa": {},
                },
            )
            completed = service.execute_export(owner_id, project_id, export["export_id"])
            content, _ = service.artifact_download(owner_id, project_id, completed["artifact_id"])
            pptx = Path(temp_name) / "locked.pptx"
            pptx.write_bytes(content)
            with zipfile.ZipFile(pptx) as archive:
                slide_xml = b"".join(archive.read(name) for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            self.assertIn(b"LOCKED TITLE", slide_xml)
            self.assertNotIn(marker.encode(), slide_xml)
            self.assertEqual(completed["qa"]["version_lock"], export["version_lock"])
