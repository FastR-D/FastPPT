"""Dependency-light FastPPT HTTP API and shared Web UI server."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
import secrets
import sys
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from fastppt_core.version import API_VERSION, SCHEMA_VERSION, VERSION, __version__
from fastppt_runtime.bootstrap import Runtime, build_runtime, verify_password
from fastppt_runtime.service import ConflictError, NotFoundError


MAX_REQUEST_BYTES = 55 * 1024 * 1024
PROJECT = r"(?P<project_id>project_[a-f0-9]{32})"


class ApiHandler(BaseHTTPRequestHandler):
    server_version = f"FastPPT/{__version__}"
    runtime: Runtime
    web_root: Path

    def setup(self) -> None:
        super().setup()
        self.request_id = secrets.token_hex(8)

    def log_message(self, format: str, *args: object) -> None:
        record = {"level": "info", "request_id": self.request_id, "method": self.command, "path": urlsplit(self.path).path, "message": format % args}
        sys.stderr.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        if self.runtime.settings.deployment_mode.value == "local":
            return origin in {f"http://{self.runtime.settings.host}:{self.runtime.settings.port}", f"http://localhost:{self.runtime.settings.port}"}
        return origin in self.runtime.settings.cors_origins

    def _headers(self, status: int, content_type: str, content_length: int, *, cookie: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Request-Id", self.request_id)
        origin = self.headers.get("Origin")
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def _json(self, status: int, payload: Any, *, cookie: str | None = None) -> None:
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(content), cookie=cookie)
        self.wfile.write(content)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message, "request_id": self.request_id}})

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body is empty or too large")
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("Content-Type must be application/json")
        try:
            value = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError("Request body is not valid JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object")
        return value

    def _token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("fastppt_session")
        return morsel.value if morsel else None

    def _user(self) -> dict[str, Any] | None:
        if self.runtime.settings.auth_mode == "local_trusted":
            return self.runtime.local_user  # type: ignore[return-value]
        token = self._token()
        return self.runtime.store.user_for_token(token) if token else None

    def _require_user(self) -> dict[str, Any] | None:
        user = self._user()
        if not user:
            self._error(HTTPStatus.UNAUTHORIZED, "authentication_required", "Authentication is required")
            return None
        return user

    def _require_project(self, owner_id: str, project_id: str) -> bool:
        if self.runtime.store.get_project(owner_id, project_id):
            return True
        self._error(HTTPStatus.NOT_FOUND, "not_found", "Project not found")
        return False

    def _artifact_response(self, owner_id: str, project_id: str, artifact_id: str) -> None:
        if not self._require_project(owner_id, project_id):
            return
        try:
            content, media_type = self.runtime.service.artifact_download(owner_id, project_id, artifact_id)
        except NotFoundError:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Artifact not found")
            return
        except ConflictError as exc:
            self._error(HTTPStatus.CONFLICT, "conflict", str(exc))
            return
        self._headers(HTTPStatus.OK, media_type, len(content))
        self.wfile.write(content)

    def _route(self, pattern: str, path: str) -> re.Match[str] | None:
        return re.fullmatch(pattern, path)

    def _serve_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            resolved.relative_to(self.web_root.resolve())
        except ValueError:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Resource not found")
            return
        if not resolved.is_file():
            resolved = self.web_root / "index.html"
        content = resolved.read_bytes()
        content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        self._headers(HTTPStatus.OK, content_type, len(content))
        self.wfile.write(content)

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self._error(HTTPStatus.FORBIDDEN, "origin_rejected", "Origin is not allowed")
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Request-Id")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        if path == "/api/v1/meta":
            self._json(HTTPStatus.OK, {"product": "FastPPT", "version": VERSION, "technical_version": __version__, "schema_version": SCHEMA_VERSION, "api_version": API_VERSION, "deployment": self.runtime.settings.public_summary()})
            return
        if path == "/api/v1/health":
            health = self.runtime.service.health()
            status = HTTPStatus.OK if health["metadata_store"]["status"] == "ready" and health["artifact_store"]["status"] == "ready" else HTTPStatus.SERVICE_UNAVAILABLE
            self._json(status, health)
            return
        if path == "/api/v1/auth/session":
            user = self._user()
            self._json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"authenticated": bool(user), "user": {key: user[key] for key in ("user_id", "email", "display_name") if key in user} if user else None})
            return
        user = self._require_user()
        if not user:
            return
        owner_id = user["user_id"]
        if path == "/api/v1/projects":
            self._json(HTTPStatus.OK, {"projects": self.runtime.store.list_projects(owner_id, include_archived=query.get("archived") == ["1"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}", path)
        if match:
            project = self.runtime.store.get_project(owner_id, match["project_id"])
            if not project:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Project not found")
            else:
                self._json(HTTPStatus.OK, project)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/documents", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"documents": self.runtime.store.list_documents(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/facts", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, self.runtime.service.list_fact_governance(owner_id, match["project_id"]))
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/assets", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"assets": self.runtime.store.list_project_assets(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"pages": self.runtime.store.list_pages(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>page_[a-f0-9]{{32}})", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            page = self.runtime.store.get_page(match["project_id"], match["page_id"])
            if not page:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Page not found")
            else:
                self._json(HTTPStatus.OK, page)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>page_[a-f0-9]{{32}})/versions", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            page = self.runtime.store.get_page(match["project_id"], match["page_id"])
            if not page:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Page not found")
                return
            if query.get("left") and query.get("right"):
                self._json(HTTPStatus.OK, self.runtime.service.compare_versions(owner_id, match["project_id"], match["page_id"], query["left"][0], query["right"][0]))
            else:
                self._json(HTTPStatus.OK, {"versions": self.runtime.store.versions_for_page(match["project_id"], match["page_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/sessions/(?P<session_id>session_[a-f0-9]{{32}})", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            session = self.runtime.store.get_work_session(match["project_id"], match["session_id"])
            if not session:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Session not found")
            else:
                self._json(HTTPStatus.OK, session)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/operations/(?P<operation_id>operation_[a-f0-9]{{32}})", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            operation = self.runtime.store.get_operation(match["project_id"], match["operation_id"])
            if not operation:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Operation not found")
            else:
                self._json(HTTPStatus.OK, operation)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/operations", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"operations": self.runtime.store.list_operations(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/plans", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"plans": self.runtime.store.list_plans(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/jobs", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"jobs": self.runtime.store.list_jobs(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/usage", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"usage": self.runtime.store.list_usage(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/exports", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"exports": self.runtime.store.list_exports(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/exports/(?P<export_id>export_[a-f0-9]{{32}})", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            export = self.runtime.store.get_export(match["project_id"], match["export_id"])
            if not export:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Export not found")
            else:
                self._json(HTTPStatus.OK, export)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/exports/(?P<export_id>export_[a-f0-9]{{32}})/download", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            export = self.runtime.store.get_export(match["project_id"], match["export_id"])
            if not export or not export.get("artifact_id"):
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Export file not found")
                return
            self._artifact_response(owner_id, match["project_id"], export["artifact_id"])
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/artifacts/(?P<artifact_id>artifact_[a-f0-9]{{32}})", path)
        if match:
            self._artifact_response(owner_id, match["project_id"], match["artifact_id"])
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/events", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            try:
                after = int(query.get("afterSeq", ["0"])[0])
            except ValueError:
                after = 0
            self._json(HTTPStatus.OK, {"events": self.runtime.store.events_after(match["project_id"], max(0, after))})
            return
        if path.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "not_found", "API route not found")
            return
        relative = path.lstrip("/") or "index.html"
        self._serve_file(self.web_root / relative)

    def do_POST(self) -> None:
        if not self._origin_allowed():
            self._error(HTTPStatus.FORBIDDEN, "origin_rejected", "Origin is not allowed")
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/v1/auth/login":
                body = self._read_json()
                user = self.runtime.store.user_by_email(str(body.get("email", "")))
                if not user or not verify_password(str(body.get("password", "")), user.get("password_hash")):
                    self._error(HTTPStatus.UNAUTHORIZED, "invalid_credentials", "Invalid credentials")
                    return
                token = self.runtime.store.create_auth_session(user["user_id"])
                secure = "; Secure" if self.runtime.settings.deployment_mode.value == "server" else ""
                cookie = f"fastppt_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200{secure}"
                self.runtime.store.audit(user["user_id"], "auth.login")
                self._json(HTTPStatus.OK, {"authenticated": True, "user": {"user_id": user["user_id"], "email": user["email"], "display_name": user["display_name"]}}, cookie=cookie)
                return
            if path == "/api/v1/auth/logout":
                token = self._token()
                if token:
                    self.runtime.store.delete_auth_session(token)
                self._json(HTTPStatus.OK, {"authenticated": False}, cookie="fastppt_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
                return
            user = self._require_user()
            if not user:
                return
            owner_id = user["user_id"]
            body = self._read_json()
            if path == "/api/v1/projects":
                self._json(HTTPStatus.CREATED, self.runtime.service.create_project(owner_id, str(body.get("name", ""))))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/copy", path)
            if match:
                self._json(HTTPStatus.CREATED, self.runtime.service.copy_project(owner_id, match["project_id"]))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/(?P<action>archive|restore)", path)
            if match:
                status = "archived" if match["action"] == "archive" else "draft"
                self._json(HTTPStatus.OK, self.runtime.service.update_project(owner_id, match["project_id"], status=status))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/sessions", path)
            if match:
                session = self.runtime.service.create_session(owner_id, match["project_id"], str(body.get("workflow_mode", "page_entry")), list(body.get("source_document_ids") or []))
                self._json(HTTPStatus.CREATED, session)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/documents", path)
            if match:
                try:
                    content = base64.b64decode(str(body.get("content_base64", "")), validate=True)
                except ValueError as exc:
                    raise ValueError("content_base64 is invalid") from exc
                document = self.runtime.service.ingest_document(owner_id, match["project_id"], str(body.get("file_name", "")), content)
                self._json(HTTPStatus.CREATED, document)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/assets", path)
            if match:
                try:
                    content = base64.b64decode(str(body.get("content_base64", "")), validate=True)
                except ValueError as exc:
                    raise ValueError("content_base64 is invalid") from exc
                asset = self.runtime.service.ingest_image_asset(owner_id, match["project_id"], str(body.get("file_name", "")), str(body.get("role", "local_asset")), content, str(body.get("media_type", "")))
                self._json(HTTPStatus.CREATED, asset)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/facts/(?P<fact_id>fact_[a-f0-9]{{32}})/lock", path)
            if match:
                self._json(HTTPStatus.OK, self.runtime.service.set_fact_locked(owner_id, match["project_id"], match["fact_id"], bool(body.get("locked", True))))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/conflicts/(?P<conflict_id>conflict_[a-f0-9]{{32}})/resolve", path)
            if match:
                result = self.runtime.service.resolve_fact_conflict(owner_id, match["project_id"], match["conflict_id"], str(body.get("resolution", "")), list(body.get("fact_ids") or []))
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans", path)
            if match:
                plan = self.runtime.service.create_generation_plan(owner_id, match["project_id"], str(body.get("session_id", "")), body.get("page_drafts"))
                self._json(HTTPStatus.CREATED, plan)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans/(?P<plan_id>plan_[a-f0-9]{{32}})/(?P<action>confirm|cancel)", path)
            if match:
                result = self.runtime.service.confirm_generation_plan(owner_id, match["project_id"], match["plan_id"]) if match["action"] == "confirm" else self.runtime.service.cancel_plan(owner_id, match["project_id"], match["plan_id"])
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans/(?P<plan_id>plan_[a-f0-9]{{32}})/samples/confirm", path)
            if match:
                self._json(HTTPStatus.OK, self.runtime.service.confirm_generation_samples(owner_id, match["project_id"], match["plan_id"]))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/operations", path)
            if match:
                result = self.runtime.service.create_edit_operation(owner_id, match["project_id"], str(body.get("instruction", "")), str(body.get("target_scope", "single")), list(body.get("page_ids") or []), str(body.get("workflow_mode", "pptx_improve")))
                self._json(HTTPStatus.CREATED, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/operations/(?P<operation_id>operation_[a-f0-9]{{32}})/(?P<action>confirm|retry|rollback|cancel)", path)
            if match:
                action = match["action"]
                if action == "confirm":
                    result = self.runtime.service.confirm_operation(owner_id, match["project_id"], match["operation_id"])
                elif action == "rollback":
                    result = self.runtime.service.rollback_operation(owner_id, match["project_id"], match["operation_id"])
                elif action == "cancel":
                    result = self.runtime.service.cancel_operation(owner_id, match["project_id"], match["operation_id"])
                else:
                    result = self.runtime.service.retry_operation(owner_id, match["project_id"], match["operation_id"])
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/jobs/(?P<job_id>job_[a-f0-9]{{32}})/retry", path)
            if match:
                self._json(HTTPStatus.OK, self.runtime.service.retry_job(owner_id, match["project_id"], match["job_id"]))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>page_[a-f0-9]{{32}})/versions/(?P<version_id>version_[a-f0-9]{{32}})/restore", path)
            if match:
                self.runtime.service._project(owner_id, match["project_id"])
                if not self.runtime.store.restore_version(match["project_id"], match["page_id"], match["version_id"]):
                    raise NotFoundError("Version not found")
                self._json(HTTPStatus.OK, {"page_id": match["page_id"], "current_version_id": match["version_id"]})
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/exports", path)
            if match:
                self._json(HTTPStatus.CREATED, self.runtime.service.export_project(owner_id, match["project_id"]))
                return
            self._error(HTTPStatus.NOT_FOUND, "not_found", "API route not found")
        except NotFoundError as exc:
            self._error(HTTPStatus.NOT_FOUND, "not_found", str(exc))
        except ConflictError as exc:
            self._error(HTTPStatus.CONFLICT, "conflict", str(exc))
        except (ValueError, KeyError) as exc:
            self._error(HTTPStatus.BAD_REQUEST, "invalid_request", str(exc))
        except Exception:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "internal_error", "The request failed; use the request ID to inspect server logs")

    def do_PATCH(self) -> None:
        if not self._origin_allowed():
            self._error(HTTPStatus.FORBIDDEN, "origin_rejected", "Origin is not allowed")
            return
        path = urlsplit(self.path).path
        user = self._require_user()
        if not user:
            return
        try:
            body = self._read_json()
            match = self._route(rf"/api/v1/projects/{PROJECT}", path)
            if not match:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "API route not found")
                return
            result = self.runtime.service.update_project(user["user_id"], match["project_id"], name=body.get("name"), status=body.get("status"))
            self._json(HTTPStatus.OK, result)
        except NotFoundError as exc:
            self._error(HTTPStatus.NOT_FOUND, "not_found", str(exc))
        except ValueError as exc:
            self._error(HTTPStatus.BAD_REQUEST, "invalid_request", str(exc))


def build_handler(runtime: Runtime) -> type[ApiHandler]:
    web_root = runtime.settings.repository_root / "apps" / "web" / "public"
    return type("ConfiguredApiHandler", (ApiHandler,), {"runtime": runtime, "web_root": web_root})


def serve(runtime: Runtime | None = None) -> None:
    active = runtime or build_runtime()
    address = (active.settings.host, active.settings.port)
    server = ThreadingHTTPServer(address, build_handler(active))
    sys.stderr.write(json.dumps({"level": "info", "event": "runtime.started", "host": active.settings.host, "port": active.settings.port, "deployment": active.settings.public_summary()}, ensure_ascii=False) + "\n")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    serve()


if __name__ == "__main__":
    main()
