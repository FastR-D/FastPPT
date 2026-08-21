import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_api.server import build_handler
from fastppt_runtime.bootstrap import build_runtime, hash_password
from fastppt_runtime.config import RuntimeSettings


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
