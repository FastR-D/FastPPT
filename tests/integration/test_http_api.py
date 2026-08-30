import json
import base64
from io import BytesIO
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from zipfile import ZipFile

from fastppt_api.server import build_handler
from fastppt_runtime.bootstrap import build_runtime, hash_password
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.task1 import TASK1_PAGE_IDS, load_task1_fixture
from tests.security.test_design_packs import make_bundle


class HttpApiIsolationTests(TestCase):
    def test_session_users_cannot_read_or_mutate_each_others_projects(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_AUTH_MODE": "session",
                    "FASTPPT_DATA_DIR": str(root / "data"),
                    "FASTPPT_TEMP_DIR": str(root / "tmp"),
                    "FASTPPT_EXPORT_DIR": str(root / "exports"),
                }
            )
            runtime = build_runtime(settings)
            alice = runtime.store.create_user("alice@example.com", "Alice", hash_password("alice-password"))
            bob = runtime.store.create_user("bob@example.com", "Bob", hash_password("bob-password"))
            project = runtime.service.create_project(alice["user_id"], "Private")
            artifact = runtime.service._record_artifact(project["project_id"], "test", b"private", "text/plain")
            alice_token = runtime.store.create_auth_session(alice["user_id"])
            bob_token = runtime.store.create_auth_session(bob["user_id"])

            server = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(runtime))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(method: str, path: str, token: str, *, body: dict[str, object] | None = None, origin: str | None = None) -> tuple[int, bytes]:
                connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
                headers = {"Cookie": f"fastppt_session={token}"}
                payload = None
                if body is not None:
                    payload = json.dumps(body)
                    headers["Content-Type"] = "application/json"
                if origin:
                    headers["Origin"] = origin
                connection.request(method, path, body=payload, headers=headers)
                response = connection.getresponse()
                data = response.read()
                status = response.status
                connection.close()
                return status, data

            try:
                private_paths = [
                    f"/api/v1/projects/{project['project_id']}",
                    f"/api/v1/projects/{project['project_id']}/documents",
                    f"/api/v1/projects/{project['project_id']}/artifacts/{artifact['artifact_id']}",
                ]
                for path in private_paths:
                    self.assertEqual(request("GET", path, bob_token)[0], 404)
                status, content = request("GET", private_paths[-1], alice_token)
                self.assertEqual(status, 200)
                self.assertEqual(content, b"private")
                status, _ = request(
                    "PATCH",
                    private_paths[0],
                    alice_token,
                    body={"name": "Cross-site rename"},
                    origin="https://attacker.example",
                )
                self.assertEqual(status, 403)
                self.assertEqual(runtime.store.get_project(alice["user_id"], project["project_id"])["name"], "Private")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


class HttpApiV12RoutesTests(TestCase):
    def test_design_prompt_replay_and_content_export_routes(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            settings = RuntimeSettings.load({
                "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                "FASTPPT_AGENT_BACKEND": "deterministic_test",
                "FASTPPT_DATA_DIR": str(root / "data"),
                "FASTPPT_TEMP_DIR": str(root / "tmp"),
                "FASTPPT_EXPORT_DIR": str(root / "exports"),
            })
            runtime = build_runtime(settings)
            owner = runtime.store.ensure_local_user()
            project = runtime.service.create_project(owner["user_id"], "API v1.2")
            server = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(runtime))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
                connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=20)
                headers = {"Content-Type": "application/json", "Idempotency-Key": f"test-{method}-{path}-{len(json.dumps(body or {}))}"}
                connection.request(method, path, body=json.dumps(body or {}) if method != "GET" else None, headers=headers)
                response = connection.getresponse()
                content = response.read()
                connection.close()
                return response.status, json.loads(content or b"{}")

            prefix = f"/api/v1/projects/{project['project_id']}"
            try:
                status, session = request("POST", prefix + "/sessions", {"workflow_mode": "page_entry", "source_document_ids": []})
                self.assertEqual(status, 201)
                status, selection = request("GET", prefix + f"/sessions/{session['session_id']}/design-selection")
                self.assertEqual((status, selection["selection_source"]), (200, "none"))

                bundle = make_bundle()
                with ZipFile(BytesIO(bundle)) as archive:
                    directory_files = [
                        {
                            "path": f"browser-selected-bundle/{item.filename}",
                            "content_base64": base64.b64encode(archive.read(item)).decode("ascii"),
                        }
                        for item in archive.infolist()
                        if not item.is_dir()
                    ]
                self.assertEqual(request("POST", prefix + "/design-packs/import", {"directory_files": directory_files})[0], 201)
                root_manifest = next(item for item in directory_files if item["path"].endswith("bundle_manifest.json"))
                client_absolute_path = "C" + ":/bundle_manifest.json"
                self.assertEqual(
                    request("POST", prefix + "/design-packs/import", {
                        "directory_files": [{**root_manifest, "path": client_absolute_path}],
                    })[0],
                    400,
                )
                self.assertEqual(
                    request("POST", prefix + "/design-packs/import", {
                        "directory_files": [root_manifest, dict(root_manifest)],
                    })[0],
                    400,
                )
                self.assertEqual(
                    request("POST", prefix + "/design-packs/import", {
                        "directory_files": [root_manifest, {**root_manifest, "path": root_manifest["path"].upper()}],
                    })[0],
                    400,
                )

                status, imported = request("POST", prefix + "/design-packs/import", {"content_base64": base64.b64encode(make_bundle()).decode("ascii")})
                self.assertEqual(status, 201)
                pack_id = imported["packs"][0]["pack_id"]
                self.assertEqual(request("GET", prefix + "/design-packs")[1]["design_packs"][0]["pack_id"], pack_id)
                self.assertEqual(request("GET", prefix + f"/design-packs/{pack_id}")[0], 200)
                self.assertIsNone(request("GET", prefix + f"/sessions/{session['session_id']}/design-selection")[1]["design_selection_id"])
                status, used = request("POST", prefix + f"/sessions/{session['session_id']}/design-selection", {"pack_id": pack_id, "pack_kind": "style"})
                self.assertEqual((status, used["style_pack_id"]), (201, pack_id))

                status, plan = request("POST", prefix + "/plans", {
                    "session_id": session["session_id"],
                    "page_drafts": [{"title": "API page", "body": "Bounded body", "page_type": "cover"}],
                })
                self.assertEqual(status, 201)
                revised_draft = dict(plan["structured_plan"]["pageDrafts"][0])
                revised_draft.update({"central_claim": "Updated through HTTP", "core_point": "Updated through HTTP"})
                status, revised_plan = request("POST", prefix + f"/plans/{plan['plan_id']}/content", {"page_drafts": [revised_draft]})
                self.assertEqual((status, revised_plan["structured_plan"]["pageDrafts"][0]["central_claim"]), (200, "Updated through HTTP"))
                status, runs = request("GET", prefix + "/agent-runs")
                self.assertEqual(status, 200)
                outline = next(item for item in runs["agent_runs"] if item["role"] == "outline_planner")
                self.assertEqual(request("GET", prefix + f"/agent-runs/{outline['agent_run_id']}/context")[1]["status"], "available")
                self.assertEqual(request("GET", prefix + f"/agent-runs/{outline['agent_run_id']}/prompt")[1]["status"], "available")
                self.assertEqual(request("POST", prefix + f"/agent-runs/{outline['agent_run_id']}/replay", {"execute": False})[1]["status"], "ready")
                status, exported = request("POST", prefix + f"/plans/{plan['plan_id']}/content-export", {"format": "docx"})
                self.assertEqual((status, exported["format"]), (201, "docx"))
                self.assertEqual(request("POST", "/api/v1/admin/prompt-retention/cleanup", {"limit": 10})[0], 200)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


class HttpApiTask1RoutesTests(TestCase):
    def test_task1_routes_cover_all_modes_idempotency_and_recovery(self) -> None:
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
            project = runtime.service.create_project(owner["user_id"], "Task one HTTP")
            fixture = load_task1_fixture()
            style_ref = {
                "id": fixture["style"].style_id,
                "version": fixture["style"].version,
                "content_hash": fixture["style"].content_hash,
                "capability_matrix": dict(fixture["style"].capability_matrix),
            }
            template_ref = {
                "id": fixture["template"].template_id,
                "version": fixture["template"].version,
                "content_hash": fixture["template"].content_hash,
                "capability_matrix": {},
            }
            server = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(runtime))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(path: str, body: dict, key: str | None) -> tuple[int, dict]:
                connection = HTTPConnection("127.0.0.1", server.server_address[1], timeout=60)
                headers = {"Content-Type": "application/json"}
                if key is not None:
                    headers["Idempotency-Key"] = key
                connection.request("POST", path, body=json.dumps(body), headers=headers)
                response = connection.getresponse()
                content = response.read()
                connection.close()
                return response.status, json.loads(content or b"{}")

            prefix = f"/api/v1/projects/{project['project_id']}/v2/task1"
            try:
                self.assertEqual(request(prefix + "/preview", {}, None)[0], 400)
                modes = {
                    "none_none": (None, None),
                    "style_only": (style_ref, None),
                    "template_only": (None, template_ref),
                    "style_template": (style_ref, template_ref),
                }
                for mode, (style, template) in modes.items():
                    key = f"http-{mode}"
                    payload = {
                        "schema_version": "2.0.0",
                        "project_id": project["project_id"],
                        "page_contract_ids": list(TASK1_PAGE_IDS),
                        "selection": {
                            "style_version_ref": style,
                            "template_version_ref": template,
                        },
                        "expected_mode": mode,
                    }
                    preview_status, preview = request(prefix + "/preview", payload, key)
                    self.assertEqual(preview_status, 200)
                    if mode == "style_template":
                        payload.update(
                            {
                                "confirmed": True,
                                "preview_artifact_hash": preview["design_snapshot"]["preview_artifact_hash"],
                                "confirmed_by": "task1-user",
                                "confirmed_at": "2026-01-01T00:00:00+00:00",
                            }
                        )
                    generated_status, generated = request(prefix + "/generate", payload, key)
                    self.assertEqual(generated_status, 201, generated)
                    self.assertEqual((generated["status"], generated["mode"]), ("completed", mode))
                    recovered_status, recovered = request(prefix + "/recover", {}, key)
                    self.assertEqual((recovered_status, recovered["status"]), (200, "recovered"))
                    self.assertEqual(recovered["manifest"]["content_hash"], generated["content_hash"])

                repeated_status, repeated = request(
                    prefix + "/generate",
                    {
                        "schema_version": "2.0.0",
                        "project_id": project["project_id"],
                        "page_contract_ids": list(TASK1_PAGE_IDS),
                        "selection": {"style_version_ref": None, "template_version_ref": None},
                        "expected_mode": "none_none",
                    },
                    "http-none_none",
                )
                self.assertEqual((repeated_status, repeated["status"]), (201, "completed"))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
