import hashlib
import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from zipfile import ZipFile

from PIL import Image

from fastppt_agent_harness.harness import AgentBackend, AgentResult, DeterministicAdapter
from fastppt_agent_harness.image import ImageAdapterError
from fastppt_core.prompting import provider_prompt, sha256_json
from fastppt_runtime.artifacts import FilesystemArtifactStore
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.service import ApplicationService, ConflictError
from fastppt_runtime.store import SQLiteMetadataStore
from tests.security.test_design_packs import make_bundle


class ReconstructionFixtureAdapter:
    def __init__(self) -> None:
        self.fallback = DeterministicAdapter()

    async def run(self, settings, request):
        role = request.metadata.get("role")
        if role == "reconstruction_planner":
            return AgentResult(
                output={
                    "objects": [{
                        "object_id": "object_agent_title",
                        "source_object_id": None,
                        "type": "text",
                        "bounds": {"x": 0.5, "y": 0.4, "width": 12.0, "height": 1.0, "unit": "inch"},
                        "z_index": 3,
                        "artifact_id": None,
                        "editable_level": "text_native",
                        "recognition_confidence": 0.96,
                        "requires_user_confirmation": False,
                    }],
                    "unresolvedItems": [],
                    "editableBoundary": "native_partial",
                },
                backend=settings.backend.value,
                model=settings.model,
            )
        if role == "qa_reviewer":
            return AgentResult(
                output={
                    "passed": False,
                    "issues": [{"code": "text_overflow", "object_id": "object_agent_title", "message": "Review title width"}],
                    "recommendations": ["Shorten the title or widen its bounds."],
                },
                backend=settings.backend.value,
                model=settings.model,
            )
        return await self.fallback.run(settings, request)


class VisualEditFixtureAdapter:
    def __init__(self) -> None:
        self.fallback = DeterministicAdapter()

    async def run(self, settings, request):
        if request.metadata.get("role") == "edit_planner":
            page_ids = list(request.metadata["page_ids"])
            return AgentResult(
                output={
                    "workflowMode": request.metadata["workflow_mode"],
                    "targetScope": request.metadata["target_scope"],
                    "affectedPageIds": page_ids,
                    "changes": [{"kind": "color_change", "target": "accent", "value": "#126B52"}],
                    "pageDelta": {"add": [], "remove": [], "split": [], "merge": []},
                    "factImpact": {"added": [], "removed": [], "changed": []},
                    "unsupported": [],
                    "requiresConfirmation": True,
                    "confirmationReasons": ["visual_change"],
                    "estimatedUsage": {"imageUnits": 1, "amount": 0, "currency": "CNY"},
                },
                backend=settings.backend.value,
                model=settings.model,
            )
        return await self.fallback.run(settings, request)


class InvalidStageFixtureAdapter:
    async def run(self, settings, request):
        return AgentResult(output={"objects": ["not-an-object"]}, backend=settings.backend.value, model=settings.model)


class UnknownSubmissionImageAdapter:
    async def generate(self, settings, request):
        raise ImageAdapterError(
            "Provider response timed out after submission",
            code="provider_timeout",
            retryable=True,
            submission_unknown=True,
        )


class V12WorkflowTests(TestCase):
    def _service(self, root: Path):
        settings = RuntimeSettings.load({
            "FASTPPT_ENABLE_TEST_FIXTURES": "1",
            "FASTPPT_AGENT_BACKEND": "deterministic_test",
            "FASTPPT_DATA_DIR": str(root / "data"),
            "FASTPPT_TEMP_DIR": str(root / "tmp"),
            "FASTPPT_EXPORT_DIR": str(root / "exports"),
        })
        settings.prepare_directories()
        store = SQLiteMetadataStore(settings.data_dir / "metadata.sqlite3")
        store.initialize()
        service = ApplicationService(settings, store, FilesystemArtifactStore(settings.data_dir / "artifacts"))
        user = store.ensure_local_user()
        project = service.create_project(user["user_id"], "v1.2 workflow")
        return service, store, user["user_id"], project["project_id"]

    def test_page_count_modes_logic_diagnosis_and_default_design_none(self) -> None:
        drafts = [
            {"title": "One", "body": "First", "page_type": "cover"},
            {"title": "Two", "body": "Second", "page_type": "content"},
        ]
        exact, _ = ApplicationService._apply_page_count_policy(drafts, {"mode": "exact", "exact": 3})
        ranged, _ = ApplicationService._apply_page_count_policy(drafts, {"mode": "range", "min": 4, "max": 6})
        automatic, _ = ApplicationService._apply_page_count_policy(drafts, {"mode": "auto"})
        self.assertEqual((len(exact), len(ranged), len(automatic)), (3, 4, 2))

        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [], {
                "page_count": {"mode": "exact", "exact": 3},
                "logic_diagnosis_enabled": True,
                "output_formats": ["markdown", "txt", "docx"],
                "audience": "Engineering",
                "purpose": "Decision",
            })
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], drafts)
            structured = plan["structured_plan"]
            self.assertEqual(structured["pageCount"]["value"], 3)
            self.assertEqual(set(structured["contentExportArtifactIds"]), {"markdown", "txt", "docx"})
            docx_qa_id = structured["contentExportQaArtifactIds"]["docx"]
            docx_qa = json.loads(service._artifact_bytes(project_id, docx_qa_id).decode("utf-8"))
            self.assertTrue(docx_qa["required"])
            self.assertIn(docx_qa["status"], {"passed", "unavailable"})
            if docx_qa["status"] == "passed":
                self.assertEqual(docx_qa["word_page_count"], docx_qa["pdf_page_count"])
                self.assertFalse(docx_qa["release_blocking"])
            else:
                self.assertTrue(docx_qa["release_blocking"])
            self.assertIsNone(structured["designSnapshot"])
            self.assertEqual(structured["designSelectionDraft"]["selection_source"], "none")
            self.assertTrue(structured["logicAnalysisArtifactIds"])
            roles = {(item["role"], item["status"]) for item in store.list_agent_runs(project_id)}
            self.assertIn(("source_analyst", "not_required"), roles)
            self.assertIn(("fact_reviewer", "not_required"), roles)
            self.assertIn(("outline_planner", "completed"), roles)
            self.assertIn(("content_logic_reviewer", "completed"), roles)
            confirmed = service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            self.assertEqual(confirmed["structured_plan"]["designSnapshot"]["selection_source"], "none")
            self.assertNotIn("designSelectionDraft", confirmed["structured_plan"])

    def test_selected_design_reaches_outline_before_snapshot_is_frozen(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            imported = service.import_design_bundle(owner_id, project_id, make_bundle(pack_id="pack_outline_context"))
            pack_id = imported["packs"][0]["pack_id"]
            selection = service.select_design_pack(owner_id, project_id, session["session_id"], pack_id, "style")
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], [{"title": "Design context", "body": "Bounded content"}])

            self.assertIsNone(plan["structured_plan"]["designSnapshot"])
            self.assertEqual(plan["structured_plan"]["designSelectionDraft"]["style_pack_id"], pack_id)
            outline_run = next(item for item in store.list_agent_runs(project_id) if item["role"] == "outline_planner")
            envelope = json.loads(service._artifact_bytes(project_id, outline_run["prompt_artifact_id"]).decode("utf-8"))
            self.assertEqual(outline_run["design_selection_id"], selection["design_selection_id"])
            self.assertEqual(envelope["rendered_context"]["design_snapshot"]["style_pack_id"], pack_id)

            confirmed = service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            self.assertEqual(confirmed["structured_plan"]["designSnapshot"]["style_pack_id"], pack_id)

    def test_page_writer_receives_and_preserves_locked_facts_and_verbatim_text(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            document = service.ingest_document(owner_id, project_id, "source.md", b"# Revenue\nRevenue reached 95% in 2026.")
            metric = next(item for item in store.list_facts(project_id) if item["value"] == "95%")
            service.set_fact_locked(owner_id, project_id, metric["fact_id"], True)
            session = service.create_session(owner_id, project_id, "document_create", [document["document_id"]])
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], [{
                "title": "Revenue",
                "body": "Revenue reached 95% in 2026.",
                "fact_ids": [metric["fact_id"]],
                "verbatim_text": ["Revenue reached 95%"],
            }])

            draft = plan["structured_plan"]["pageDrafts"][0]
            self.assertIn(metric["fact_id"], draft["fact_ids"])
            self.assertIn("Revenue reached 95%", draft["verbatim_text"])
            writer_run = next(item for item in store.list_agent_runs(project_id) if item["role"] == "page_writer")
            envelope = json.loads(service._artifact_bytes(project_id, writer_run["prompt_artifact_id"]).decode("utf-8"))
            context = envelope["rendered_context"]
            self.assertEqual(context["locked_facts"][0]["value"], "95%")
            self.assertEqual(context["verbatim_text"], ["Revenue reached 95%"])

    def test_truncation_summary_is_registered_and_inspectable(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            run = service._record_stage_agent_run(
                owner_id,
                project_id,
                role="source_analyst",
                session_id=None,
                summary={"summary": "x" * 420_000},
            )
            inspection = service.inspect_agent_run(owner_id, project_id, run["agent_run_id"])
            report = inspection["truncation_report"]
            summary_artifact_id = report["summary_artifact_id"]
            self.assertTrue(summary_artifact_id)
            summary_artifact = store.get_artifact(project_id, summary_artifact_id)
            self.assertEqual(summary_artifact["kind"], "context_summary")
            summary = json.loads(service._artifact_bytes(project_id, summary_artifact_id).decode("utf-8"))
            self.assertEqual(summary["records"][0]["action"], "summarized")

    def test_agent_run_idempotency_does_not_create_orphan_prompt_envelopes(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            values = {
                "role": "outline_planner",
                "prompt": "Create a bounded outline.",
                "context": {"user_options": {"purpose": "Decision"}},
                "idempotency_key": "same-client-request",
            }
            first = service.create_agent_run_record(owner_id, project_id, values)
            second = service.create_agent_run_record(owner_id, project_id, values)
            self.assertEqual(second["agent_run_id"], first["agent_run_id"])
            self.assertEqual(len(store.list_agent_runs(project_id)), 1)
            self.assertEqual(len(store.list_prompt_envelopes(project_id)), 1)
            other = service.create_project(owner_id, "v1.2 other project")
            other_run = service.create_agent_run_record(owner_id, other["project_id"], values)
            self.assertNotEqual(other_run["agent_run_id"], first["agent_run_id"])
            self.assertEqual(other_run["project_id"], other["project_id"])

    def test_agent_output_contract_failure_closes_run_and_usage(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.harness._adapters[AgentBackend.DETERMINISTIC_TEST] = InvalidStageFixtureAdapter()
            run = service.create_agent_run_record(owner_id, project_id, {
                "role": "reconstruction_planner",
                "prompt": "Return a reconstruction plan.",
                "idempotency_key": "invalid-stage-output",
            })
            completed = service.execute_agent_run_record(owner_id, project_id, run["agent_run_id"], {})
            self.assertEqual(completed["status"], "failed")
            self.assertEqual(completed["error"]["code"], "output_contract_violation")
            self.assertEqual(store.usage_by_request(run["usage_request_id"])["submission_status"], "failed")

    def test_image_prompt_attempt_binds_reference_bytes_media_type_and_hash(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            image = BytesIO()
            Image.new("RGB", (20, 12), "#126B52").save(image, format="PNG")
            reference_bytes = image.getvalue()
            asset = service.ingest_image_asset(owner_id, project_id, "reference.png", "local_asset", reference_bytes, "image/png")
            page = service.materialize_pages(
                owner_id,
                project_id,
                [{"title": "Image page", "body": "Keep this text", "page_type": "content"}],
                create_visual_reference=False,
            )[0]
            service._queue_visual_runs(owner_id, project_id, [page])
            run = store.list_image_runs(project_id)[0]
            envelope = json.loads(service._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8"))
            self.assertEqual(envelope["role"], "image_prompt")
            self.assertEqual(envelope["prompt_digest"], sha256_json(provider_prompt(envelope)))
            self.assertIn(asset["artifact_id"], envelope["input_artifact_ids"])
            self.assertTrue(envelope["rendered_context"]["parent_outputs"])
            self.assertEqual(
                envelope["rendered_context"]["parent_outputs"][0]["imagePromptCandidate"],
                "One complete slide reference matching the PageContract.",
            )

            completed = service.execute_image_run(owner_id, project_id, run["image_run_id"])
            self.assertEqual(completed["status"], "completed")
            attempt = store.list_image_attempts(project_id, run["image_run_id"])[0]
            summary = attempt["input_summary"][0]
            self.assertEqual(summary["sha256"], hashlib.sha256(reference_bytes).hexdigest())
            self.assertEqual(summary["size_bytes"], len(reference_bytes))
            self.assertEqual(summary["media_type"], "image/png")
            output = store.get_artifact(project_id, attempt["output_artifact_ids"][0])
            self.assertEqual(output["sha256"], hashlib.sha256(service._artifact_bytes(project_id, output["artifact_id"])).hexdigest())
            self.assertEqual(attempt["output_digest"], sha256_json(attempt["output_hashes"]))

    def test_unknown_image_submission_requires_explicit_duplicate_risk_acceptance(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            page = service.materialize_pages(
                owner_id,
                project_id,
                [{"title": "Unknown submission", "body": "Retry must be explicit", "page_type": "content"}],
                create_visual_reference=False,
            )[0]
            service._queue_visual_runs(owner_id, project_id, [page])
            run = store.list_image_runs(project_id)[0]

            with patch("fastppt_runtime.service.DeterministicImageAdapter", UnknownSubmissionImageAdapter):
                result = service.execute_image_run(owner_id, project_id, run["image_run_id"])

            self.assertEqual(result["status"], "awaiting_user_decision")
            attempt = store.list_image_attempts(project_id, run["image_run_id"])[0]
            self.assertEqual(attempt["status"], "submission_unknown")
            with self.assertRaises(ConflictError):
                service.execute_image_run(owner_id, project_id, run["image_run_id"])
            with self.assertRaises(ConflictError):
                service.image_run_decision(owner_id, project_id, run["image_run_id"], "retry_same")

            queued = service.image_run_decision(
                owner_id,
                project_id,
                run["image_run_id"],
                "retry_same",
                accept_duplicate_risk=True,
            )
            self.assertEqual(queued["status"], "queued")
            self.assertEqual(store.list_image_attempts(project_id, run["image_run_id"])[0]["status"], "abandoned")

    def test_reconstruction_planner_and_qa_outputs_affect_manifest(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.harness._adapters[AgentBackend.DETERMINISTIC_TEST] = ReconstructionFixtureAdapter()
            page = service.materialize_pages(owner_id, project_id, [{"title": "Agent title", "body": "Editable content", "page_type": "content"}])[0]
            visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
            service.approve_visual(owner_id, project_id, page["page_id"], {
                "contract_revision": 1,
                "visual_artifact_id": visual["artifact_id"],
                "visual_sha256": visual["sha256"],
            })
            preflight = service.reconstruction_preflight(owner_id, project_id, page["page_id"])
            result = service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])
            self.assertEqual(result["status"], "partial")
            state = store.get_page_production_state(project_id, page["page_id"])
            manifest = store.get_reconstruction_manifest(project_id, state["reconstruction_manifest_id"])
            self.assertEqual(manifest["objects"][0]["object_id"], "object_agent_title")
            self.assertEqual(manifest["objects"][0]["editable_level"], "text_native")
            self.assertEqual(manifest["unresolved_items"][0]["code"], "text_overflow")
            runs = {item["role"]: item for item in store.list_agent_runs(project_id) if item["role"] in {"reconstruction_planner", "qa_reviewer"}}
            self.assertEqual(runs["qa_reviewer"]["parent_run_id"], runs["reconstruction_planner"]["agent_run_id"])
            self.assertEqual(runs["qa_reviewer"]["parent_output_artifact_ids"], runs["reconstruction_planner"]["output_artifact_ids"])

    def test_prompt_inspect_replay_digest_guard_and_retention_cleanup(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            run = service._record_stage_agent_run(
                owner_id,
                project_id,
                role="outline_planner",
                session_id=None,
                summary={"page_drafts": [{"title": "One", "body": "Body"}], "workflow_mode": "page_entry"},
            )
            inspection = service.inspect_agent_run(owner_id, project_id, run["agent_run_id"])
            self.assertEqual(inspection["status"], "available")
            self.assertEqual(inspection["prompt_envelope"]["prompt_digest"], run["prompt_digest"])
            self.assertEqual(service.replay_agent_run(owner_id, project_id, run["agent_run_id"])["status"], "ready")
            replayed = service.replay_agent_run(owner_id, project_id, run["agent_run_id"], execute=True)
            self.assertEqual(replayed["status"], "completed")
            self.assertNotEqual(replayed["replay_agent_run"]["agent_run_id"], run["agent_run_id"])
            self.assertEqual(store.get_agent_run(project_id, run["agent_run_id"])["output_artifact_ids"], run["output_artifact_ids"])

            prompt_artifact = store.get_artifact(project_id, run["prompt_artifact_id"])
            prompt_path = service.artifacts.root / prompt_artifact["storage_key"]
            payload = json.loads(prompt_path.read_text(encoding="utf-8"))
            payload["user_prompt"] = payload["user_prompt"] + " changed"
            changed = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
            prompt_path.write_bytes(changed)
            with store.transaction() as connection:
                connection.execute("UPDATE artifacts SET sha256=?,size_bytes=? WHERE artifact_id=?", (hashlib.sha256(changed).hexdigest(), len(changed), prompt_artifact["artifact_id"]))
            unavailable = service.replay_agent_run(owner_id, project_id, run["agent_run_id"])
            self.assertEqual(unavailable["status"], "replay_unavailable")
            self.assertFalse(unavailable["digest_match"])

            with store.transaction() as connection:
                connection.execute("UPDATE prompt_envelopes SET expires_at='2000-01-01T00:00:00+00:00' WHERE agent_run_id=?", (run["agent_run_id"],))
            cleaned = service.cleanup_expired_prompt_content(owner_id)
            self.assertEqual(cleaned["deleted_envelopes"], 1)
            self.assertEqual(service.inspect_agent_run(owner_id, project_id, run["agent_run_id"])["status"], "retention_expired")

    def test_content_plan_edits_persist_and_preserve_agent_provenance(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            document = service.ingest_document(owner_id, project_id, "source.md", b"# Revenue\nRevenue reached 95% in 2026.")
            session = service.create_session(owner_id, project_id, "document_create", [document["document_id"]])
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"])
            original = dict(plan["structured_plan"]["pageDrafts"][0])
            fact_id = store.list_facts(project_id)[0]["fact_id"]
            requested = {
                **original,
                "title": "Confirmed revenue",
                "central_claim": "The target was reached.",
                "body": "Coverage reached the confirmed threshold.",
                "fact_ids": [fact_id],
                "visual_suggestion": "Use a single metric callout.",
                "source_hashes": ["tampered"],
                "page_writer_run_id": "agent_run_tampered",
            }
            updated = service.update_generation_plan_content(owner_id, project_id, plan["plan_id"], [requested])
            draft = updated["structured_plan"]["pageDrafts"][0]
            self.assertEqual(draft["title"], "Confirmed revenue")
            self.assertEqual(draft["central_claim"], "The target was reached.")
            self.assertEqual(draft["fact_ids"], [fact_id])
            self.assertEqual(draft["source_hashes"], original["source_hashes"])
            self.assertEqual(draft["page_writer_run_id"], original["page_writer_run_id"])
            export_id = updated["structured_plan"]["contentExportArtifactIds"]["markdown"]
            exported = service._artifact_bytes(project_id, export_id).decode("utf-8")
            self.assertIn("Confirmed revenue", exported)
            self.assertIn("The target was reached.", exported)

    def test_content_plan_page_count_edits_and_post_confirmation_invalidation(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], [
                {"title": "One", "body": "First"},
                {"title": "Two", "body": "Second"},
            ])
            first = dict(plan["structured_plan"]["pageDrafts"][0])
            preconfirmed = service.update_generation_plan_content(owner_id, project_id, plan["plan_id"], [
                first,
                {"title": "Replacement", "body": "New second page"},
                {"title": "Three", "body": "New third page"},
            ])
            pre_drafts = preconfirmed["structured_plan"]["pageDrafts"]
            self.assertEqual(preconfirmed["structured_plan"]["pageCount"]["value"], 3)
            self.assertEqual(pre_drafts[0]["page_draft_id"], first["page_draft_id"])
            self.assertEqual(len({item["page_draft_id"] for item in pre_drafts}), 3)

            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            current = store.get_plan(project_id, plan["plan_id"])
            request_drafts = [dict(item) for item in current["structured_plan"]["pageDrafts"]]
            request_drafts.append({"title": "Four", "body": "Added after confirmation"})
            warning = service.update_generation_plan_content(owner_id, project_id, plan["plan_id"], request_drafts)
            self.assertTrue(warning["confirmation_required"])
            self.assertIn("page_count_change", warning["confirmation_reasons"])

            continued = service.update_generation_plan_content(owner_id, project_id, plan["plan_id"], request_drafts, confirm_invalidation=True)
            self.assertEqual(continued["structured_plan"]["pageCount"]["value"], 4)
            self.assertEqual(continued["structured_plan"]["consistencyStatus"], "mixed_content")
            self.assertEqual(len(store.list_pages(project_id)), 4)
            self.assertEqual(len(continued["structured_plan"]["generatedDraftIds"]), 4)

    def test_high_fidelity_plan_records_only_applicable_role_chain(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, _project_id = self._service(Path(temp_name))
            source_project = service.create_project(owner_id, "High fidelity source")
            service.materialize_pages(owner_id, source_project["project_id"], [{"title": "Imported title", "body": "Keep this exact slide text.", "page_type": "cover"}])
            source_export = service.export_project(owner_id, source_project["project_id"])
            source_pptx, _media_type = service.artifact_download(owner_id, source_project["project_id"], source_export["artifact_id"])

            project = service.create_project(owner_id, "High fidelity target")
            document = service.ingest_document(owner_id, project["project_id"], "source.pptx", source_pptx)
            session = service.create_session(owner_id, project["project_id"], "pptx_improve", [document["document_id"]], {"improvement_mode": "high_fidelity"})
            plan = service.create_generation_plan(owner_id, project["project_id"], session["session_id"])
            runs = {item["role"]: item for item in store.list_agent_runs(project["project_id"]) if item.get("session_id") == session["session_id"]}
            self.assertEqual(runs["import_analyst"]["status"], "completed")
            for role in ("source_analyst", "fact_reviewer", "outline_planner", "page_writer"):
                self.assertEqual(runs[role]["status"], "not_required")
                self.assertTrue(runs[role]["error"]["message"])
            draft = plan["structured_plan"]["pageDrafts"][0]
            self.assertEqual(draft["page_writer_status"], "not_required")
            self.assertEqual(draft["import_analyst_run_id"], runs["import_analyst"]["agent_run_id"])

    def test_long_source_uses_chunk_runs_and_an_aggregate_run(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            content = ("# Long source\n" + ("context evidence " * 32_000)).encode("utf-8")
            document = service.ingest_document(owner_id, project_id, "long.md", content)
            session = service.create_session(owner_id, project_id, "document_create", [document["document_id"]])
            service.create_generation_plan(owner_id, project_id, session["session_id"], [{"title": "Long source", "body": "Bounded summary"}])

            source_runs = [item for item in store.list_agent_runs(project_id) if item["role"] == "source_analyst" and item["status"] == "completed"]
            staged: dict[str, list[dict]] = {"chunk": [], "aggregate": []}
            for run in source_runs:
                envelope = json.loads(service._artifact_bytes(project_id, run["prompt_artifact_id"]).decode("utf-8"))
                stage = (envelope.get("rendered_context", {}).get("source_metadata") or {}).get("hierarchical_stage")
                if stage in staged:
                    staged[stage].append(run)
            self.assertGreater(len(staged["chunk"]), 1)
            self.assertEqual(len(staged["aggregate"]), 1)
            aggregate = staged["aggregate"][0]
            chunk_outputs = {artifact_id for run in staged["chunk"] for artifact_id in run["output_artifact_ids"]}
            self.assertTrue(chunk_outputs.issubset(set(aggregate["input_artifact_ids"])))
            self.assertEqual(aggregate["parent_run_id"], staged["chunk"][0]["agent_run_id"])

    def test_audit_package_is_redacted_and_excludes_private_pack_bytes(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            private_marker = b"private-pack-material-must-not-export"
            service.import_design_bundle(owner_id, project_id, make_bundle(resource=b"\x89PNG\r\n\x1a\n" + private_marker, preview=True))
            secret = "sk-audit-secret-1234567890abcdef"  # hygiene: allow-likely_api_key
            store.audit(owner_id, "test.audit.secret", project_id=project_id, detail={"authorization": f"Bearer {secret}", "secret_reference": "env:FASTPPT_SECRET"})
            service._record_stage_agent_run(owner_id, project_id, role="outline_planner", session_id=None, summary={"page_drafts": [{"title": "Audit", "body": "Bounded"}], "authorization": f"Bearer {secret}"})

            archive_bytes, file_name = service.export_audit_package(owner_id, project_id)
            self.assertTrue(file_name.endswith("-audit.zip"))
            with ZipFile(BytesIO(archive_bytes)) as archive:
                names = archive.namelist()
                contents = b"\n".join(archive.read(name) for name in names)
            self.assertNotIn(secret.encode("utf-8"), contents)
            self.assertNotIn(private_marker, contents)
            self.assertFalse(any("private-packs" in name for name in names))
            self.assertIn(b"[REDACTED]", contents)
            self.assertIn(b"private_design_pack_resources", contents)

    def test_image_prompt_envelope_is_removed_by_retention_cleanup(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            page = service.materialize_pages(owner_id, project_id, [{"title": "Image prompt", "body": "Temporary context", "page_type": "content"}], create_visual_reference=False)[0]
            service._queue_visual_runs(owner_id, project_id, [page])
            run = store.list_image_runs(project_id)[0]
            generated = service._record_artifact(project_id, "generated_image", b"temporary generated image", "image/png")
            store.create_image_attempt(run["image_run_id"], {"status": "completed", "output_artifact_ids": [generated["artifact_id"]]})
            context = store.get_context_manifest(project_id, run["image_run_id"])
            truncation = store.get_truncation_report(project_id, run["image_run_id"])
            artifact_ids = [run["prompt_artifact_id"], context["artifact_id"], truncation["artifact_id"], generated["artifact_id"]]
            paths = [service.artifacts.root / store.get_artifact(project_id, artifact_id)["storage_key"] for artifact_id in artifact_ids]
            self.assertTrue(all(path.is_file() for path in paths))
            with store.transaction() as connection:
                connection.execute("UPDATE prompt_envelopes SET expires_at='2000-01-01T00:00:00+00:00' WHERE agent_run_id=?", (run["image_run_id"],))
            cleaned = service.cleanup_expired_prompt_content(owner_id)
            self.assertEqual(cleaned["deleted_envelopes"], 1)
            self.assertTrue(all(not path.exists() for path in paths))

    def test_natural_visual_edit_records_full_role_and_image_chain(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            service.harness._adapters[AgentBackend.DETERMINISTIC_TEST] = VisualEditFixtureAdapter()
            page = service.materialize_pages(owner_id, project_id, [{"title": "Before", "body": "Editable", "page_type": "content"}])[0]
            operation = service.create_edit_operation(owner_id, project_id, "Change the accent color to green.", "single", [page["page_id"]])
            self.assertEqual(operation["status"], "planned")
            completed = service.confirm_operation(owner_id, project_id, operation["operation_id"])
            self.assertEqual(completed["status"], "completed")

            runs = store.list_agent_runs(project_id)
            by_role = {role: [item for item in runs if item["role"] == role] for role in ("edit_planner", "visual_director", "reconstruction_planner", "qa_reviewer")}
            self.assertTrue(all(by_role.values()))
            reconstruction = by_role["reconstruction_planner"][-1]
            qa = by_role["qa_reviewer"][-1]
            self.assertEqual(qa["parent_run_id"], reconstruction["agent_run_id"])
            image_run = store.list_image_runs(project_id)[-1]
            envelope = json.loads(service._artifact_bytes(project_id, image_run["prompt_artifact_id"]).decode("utf-8"))
            self.assertEqual(envelope["role"], "image_prompt")
            self.assertEqual(envelope["input_artifact_ids"][0], store.get_page(project_id, page["page_id"])["page_contract_artifact_id"])

    def test_mixed_design_reaches_ungenerated_pages_and_export_qa(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [], {"representative_preflight": True})
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], [
                {"title": "One", "body": "First", "page_type": "cover"},
                {"title": "Two", "body": "Second", "page_type": "content"},
                {"title": "Three", "body": "Third", "page_type": "content"},
            ])
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            imported = service.import_design_bundle(owner_id, project_id, make_bundle(pack_id="pack_style_mixed"))
            pack_id = imported["packs"][0]["pack_id"]
            service.select_design_pack(owner_id, project_id, session["session_id"], pack_id, "style")
            mixed = store.get_plan(project_id, plan["plan_id"])
            self.assertEqual(mixed["structured_plan"]["consistencyStatus"], "mixed_design")
            self.assertEqual(mixed["structured_plan"]["pageDrafts"][2]["design_snapshot"]["style_pack_id"], pack_id)

            representatives = store.list_pages(project_id)
            for page in representatives:
                visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
                service.approve_visual(owner_id, project_id, page["page_id"], {"contract_revision": 1, "visual_artifact_id": visual["artifact_id"], "visual_sha256": visual["sha256"]})
            service.confirm_generation_samples(owner_id, project_id, plan["plan_id"])
            pages = store.list_pages(project_id)
            self.assertEqual(len(pages), 3)
            snapshots = [service._page_contract(project_id, page).design_snapshot for page in pages]
            self.assertTrue(all(snapshot["style_pack_id"] is None for snapshot in snapshots[:2]))
            self.assertEqual(snapshots[2]["style_pack_id"], pack_id)

            for page in pages:
                visual = store.get_artifact(project_id, page["visual_preview_artifact_id"])
                service.approve_visual(owner_id, project_id, page["page_id"], {"contract_revision": 1, "visual_artifact_id": visual["artifact_id"], "visual_sha256": visual["sha256"]})
                preflight = service.reconstruction_preflight(owner_id, project_id, page["page_id"])
                service.execute_reconstruction(owner_id, project_id, page["page_id"], preflight["disclosure_sha256"])
            exported = service.export_project(owner_id, project_id)
            self.assertEqual(exported["qa"]["consistency_status"], "mixed_design")
            self.assertGreater(len(set(exported["qa"]["page_design_digests"])), 1)

    def test_restart_from_scratch_supersedes_mixed_plan_and_is_idempotent(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store, owner_id, project_id = self._service(Path(temp_name))
            session = service.create_session(owner_id, project_id, "page_entry", [])
            plan = service.create_generation_plan(owner_id, project_id, session["session_id"], [
                {"title": "One", "body": "First", "page_type": "cover"},
                {"title": "Two", "body": "Second", "page_type": "content"},
            ])
            service.confirm_generation_plan(owner_id, project_id, plan["plan_id"])
            service.confirm_generation_design(owner_id, project_id, plan["plan_id"])
            imported = service.import_design_bundle(owner_id, project_id, make_bundle(pack_id="pack_restart_style"))
            pack_id = imported["packs"][0]["pack_id"]
            service.select_design_pack(owner_id, project_id, session["session_id"], pack_id, "style")
            self.assertEqual(store.get_plan(project_id, plan["plan_id"])["structured_plan"]["consistencyStatus"], "mixed_design")

            replacement = service.restart_generation_plan(owner_id, project_id, plan["plan_id"])
            repeated = service.restart_generation_plan(owner_id, project_id, plan["plan_id"])
            old = store.get_plan(project_id, plan["plan_id"])
            self.assertEqual(repeated["plan_id"], replacement["plan_id"])
            self.assertEqual(old["status"], "superseded")
            self.assertEqual(old["structured_plan"]["supersededByPlanId"], replacement["plan_id"])
            self.assertEqual(replacement["structured_plan"]["restartOfPlanId"], plan["plan_id"])
            self.assertIsNone(replacement["structured_plan"]["designSnapshot"])
            self.assertEqual(replacement["structured_plan"]["designSelectionDraft"]["style_pack_id"], pack_id)
            self.assertEqual(store.list_pages(project_id), [])
