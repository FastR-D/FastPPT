import io
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from PIL import Image

from fastppt_core.contracts import validate_plan
from fastppt_runtime.artifacts import FilesystemArtifactStore
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.service import ApplicationService, ConflictError
from fastppt_runtime.store import SQLiteMetadataStore


class ReleaseGateTests(TestCase):
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
        project = service.create_project(user["user_id"], "Release gates")
        return service, store, user["user_id"], project["project_id"]

    @staticmethod
    def _approve_page(service, store, owner_id: str, project_id: str, page: dict) -> None:
        visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
        service.approve_visual(owner_id, project_id, page["page_id"], {
            "contract_revision": 1,
            "visual_artifact_id": visual["artifact_id"],
            "visual_sha256": visual["sha256"],
            "comment": "approved in test",
        })

    @staticmethod
    def _plan(page_ids: list[str], changes: list[dict], *, confirmation: bool = True) -> dict:
        return {
            "workflowMode": "pptx_improve",
            "targetScope": "single" if len(page_ids) == 1 else "global",
            "affectedPageIds": page_ids,
            "changes": changes,
            "pageDelta": {"add": [], "remove": [], "split": [], "merge": []},
            "factImpact": {"added": [], "removed": [], "changed": []},
            "unsupported": [],
            "requiresConfirmation": confirmation,
            "confirmationReasons": ["visual_change"] if confirmation else [],
            "estimatedUsage": {"amount": 0, "currency": "CNY"},
        }

    def test_every_supported_visual_change_updates_contract_and_svg(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.materialize_pages(owner_id, project_id, [{"title": "Title", "body": "One\nTwo\nThree\nFour", "page_type": "content"}])
            page_id = store.list_pages(project_id)[0]["page_id"]

            image = io.BytesIO()
            Image.new("RGB", (16, 16), "#23745B").save(image, format="PNG")
            asset = service.ingest_image_asset(owner_id, project_id, "reference.png", "local_asset", image.getvalue(), "image/png")
            changes = [
                ({"kind": "layout_change", "target": "layout", "value": "two_column"}, "layout_intent", "two_column"),
                ({"kind": "hierarchy_change", "target": "page", "value": "emphasis"}, "hierarchy_style", "emphasis"),
                ({"kind": "color_change", "target": "accent", "value": "#126B52"}, "accent_color", "#126B52"),
                ({"kind": "color_change", "target": "background", "value": "#FFFDF8"}, "background_color", "#FFFDF8"),
                ({"kind": "image_change", "target": "image", "value": {"artifactId": asset["artifact_id"]}}, "image_artifact_ids", (asset["artifact_id"],)),
            ]
            previous_svg = service._artifact_bytes(project_id, store.get_page(project_id, page_id)["svg_artifact_id"])
            for change, field, expected in changes:
                plan = self._plan([page_id], [change])
                validate_plan(plan, {page_id})
                operation = store.create_operation(project_id, None, plan)
                completed = service.confirm_operation(owner_id, project_id, operation["operation_id"])
                self.assertEqual(completed["status"], "completed")
                page = store.get_page(project_id, page_id)
                contract = service._page_contract(project_id, page)
                self.assertEqual(getattr(contract, field), expected)
                current_svg = service._artifact_bytes(project_id, page["svg_artifact_id"])
                self.assertNotEqual(current_svg, previous_svg)
                previous_svg = current_svg

            bad = self._plan([page_id], [{"kind": "unimplemented_change"}], confirmation=False)
            failed = service.execute_operation(owner_id, project_id, store.create_operation(project_id, None, bad)["operation_id"])
            self.assertEqual(failed["status"], "failed")
            self.assertIn(page_id, failed["error"]["page_errors"])

    def test_fact_conflicts_block_then_resolve_and_lock(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            first = service.ingest_document(owner_id, project_id, "first.md", "# Revenue\nRevenue reached 95% in 2026.".encode())
            second = service.ingest_document(owner_id, project_id, "second.md", "# Revenue\nRevenue reached 90% in 2026.".encode())
            self.assertEqual(first["parse_status"], "ready")
            self.assertEqual(second["parse_status"], "blocked")
            session = service.create_session(owner_id, project_id, "document_create", [first["document_id"], second["document_id"]])
            with self.assertRaises(ConflictError):
                service.create_generation_plan(owner_id, project_id, session["session_id"])

            conflicts = store.list_fact_conflicts(project_id)
            self.assertGreaterEqual(len(conflicts), 1)
            preferred_ids = []
            for conflict in conflicts:
                preferred = conflict["fact_ids"][0]
                preferred_ids.append(preferred)
                resolved = service.resolve_fact_conflict(owner_id, project_id, conflict["conflict_id"], "prefer", [preferred])
                self.assertEqual(resolved["status"], "resolved")
            locked = {fact["fact_id"] for fact in store.list_facts(project_id) if fact["locked"]}
            self.assertTrue(set(preferred_ids).issubset(locked))
            self.assertTrue(all(item["parse_status"] == "ready" for item in store.list_documents(project_id)))
            self.assertTrue(service.create_generation_plan(owner_id, project_id, session["session_id"])["confirmation_required"])

    def test_partial_operation_retries_only_missing_pages(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.materialize_pages(
                owner_id,
                project_id,
                [
                    {"title": "One", "body": "First page", "page_type": "content"},
                    {"title": "Two", "body": "Second page", "page_type": "content"},
                ],
            )
            page_ids = [item["page_id"] for item in store.list_pages(project_id)]
            plan = self._plan(page_ids, [{"kind": "rewrite_text", "target": "title", "value": "Updated"}])
            plan["confirmationReasons"] = ["multi_page_scope"]
            validate_plan(plan, set(page_ids))
            operation = store.create_operation(project_id, None, plan)
            original_renderer = service._render_contract_visual

            def fail_second(project: str, contract, body: str, page_number: int) -> bytes:
                if page_number == 2:
                    raise RuntimeError("preview backend unavailable")
                return original_renderer(project, contract, body, page_number)

            service._render_contract_visual = fail_second
            partial = service.confirm_operation(owner_id, project_id, operation["operation_id"])
            self.assertEqual(partial["status"], "partial")
            self.assertEqual(len(partial["result_version_ids"]), 1)
            service._render_contract_visual = original_renderer
            completed = service.retry_operation(owner_id, project_id, operation["operation_id"])
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(len(completed["result_version_ids"]), 2)

    def test_representative_confirmation_is_scoped_to_its_plan(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            unrelated = service.materialize_pages(
                owner_id, project_id, [{"title": "Other preview", "body": "Pending", "page_type": "content"}],
                operation_id="plan_" + "f" * 32, preview_only=True,
            )[0]
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(
                owner_id, project_id, session["session_id"], [{"title": "Approved", "body": "Sample", "page_type": "cover"}],
            )
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"], {"representative_preflight": True})
            representative = next(page for page in store.list_pages(project_id) if page["operation_id"] == plan["plan_id"])
            self._approve_page(service, store, owner_id, project_id, representative)
            service.confirm_generation_samples(owner_id, project_id, plan["plan_id"])
            self.assertEqual(store.get_page(project_id, unrelated["page_id"])["version_status"], "previewing")

    def test_cancelled_sample_plan_archives_its_preview_pages(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(
                owner_id, project_id, session["session_id"], [{"title": "Reject", "body": "Sample", "page_type": "cover"}],
            )
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            self.assertEqual(len(store.list_pages(project_id)), 1)
            cancelled = service.cancel_plan(owner_id, project_id, plan["plan_id"])
            self.assertEqual(cancelled["archived_page_count"], 1)
            self.assertEqual(store.list_pages(project_id), [])

    def test_project_name_validation_and_multiline_copy_preserve_contract_body(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.materialize_pages(
                owner_id,
                project_id,
                [{"title": "Long body", "body": "First line\nSecond line\nThird line", "page_type": "content"}],
            )
            source_page = store.list_pages(project_id)[0]
            source_contract = service._page_contract(project_id, source_page)
            self.assertEqual(source_contract.compressible_content, ("First line", "Second line", "Third line"))

            copied = service.copy_project(owner_id, project_id)
            copied_page = store.list_pages(copied["project_id"])[0]
            copied_contract = service._page_contract(copied["project_id"], copied_page)
            self.assertEqual(service._contract_body(copied_contract), "First line\nSecond line\nThird line")
            with self.assertRaises(ValueError):
                service.update_project(owner_id, project_id, name="   ")
            with self.assertRaises(ValueError):
                service.update_project(owner_id, project_id, name="x" * 121)

    def test_previewing_representative_cannot_be_edited_before_confirmation(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(
                owner_id,
                project_id,
                session["session_id"],
                [{"title": "Preview", "body": "Sample", "page_type": "cover"}],
            )
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"], {"representative_preflight": True})
            page_id = store.list_pages(project_id)[0]["page_id"]
            with self.assertRaises(ConflictError):
                service.create_edit_operation(owner_id, project_id, "Change title", "single", [page_id])

    def test_completed_reconstruction_is_idempotent(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(
                owner_id,
                project_id,
                session["session_id"],
                [{"title": "Idempotent", "body": "Editable body", "page_type": "content"}],
            )
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            page = store.list_pages(project_id)[0]
            self._approve_page(service, store, owner_id, project_id, page)
            preflight = service.reconstruction_preflight(owner_id, project_id, page["page_id"])
            service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])
            values = {
                "disclosure_sha256": preflight["disclosure_sha256"],
                "accept_wait_time": True,
                "accept_supplier_fee_risk": True,
                "accept_visual_difference": True,
                "accept_editable_boundary": True,
                "accepted_unsupported_object_ids": [],
                "idempotency_key": "reconstruction-idempotency-test",
            }
            first = service.request_reconstruction(owner_id, project_id, page["page_id"], values)
            second = service.request_reconstruction(owner_id, project_id, page["page_id"], values)
            self.assertEqual(first["job_id"], second["job_id"])
            before = store.get_page(project_id, page["page_id"])["current_version_id"]
            service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])
            self.assertEqual(store.get_page(project_id, page["page_id"])["current_version_id"], before)
