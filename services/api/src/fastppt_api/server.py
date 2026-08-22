"""Dependency-light FastPPT HTTP API and shared Web UI server."""

from __future__ import annotations

import base64
import hashlib
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
from fastppt_runtime.bootstrap import Runtime, build_runtime, hash_password, verify_password
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
            return origin in {
                f"http://{self.runtime.settings.host}:{self.runtime.settings.port}",
                f"http://localhost:{self.runtime.settings.port}",
                "http://127.0.0.1:4173",
                "http://localhost:4173",
                "http://127.0.0.1:5173",
                "http://localhost:5173",
                *self.runtime.settings.cors_origins,
            }
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

    def _error(self, status: int, code: str, message: str, *, retryable: bool = False, detail: dict[str, Any] | None = None) -> None:
        self._json(status, {"error": {"code": code, "message": message, "retryable": retryable, "detail": detail or {}, "request_id": self.request_id}})

    @staticmethod
    def _conflict_code(message: str) -> str:
        lowered = message.casefold()
        if "agent provider" in lowered or "image provider" in lowered or "provider profile" in lowered:
            return "profile_unavailable"
        if "confirm" in lowered or "approval" in lowered:
            return "confirmation_required"
        if "fact conflict" in lowered:
            return "fact_conflict"
        if "qa" in lowered:
            return "qa_failed"
        return "conflict"

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

    def _require_admin(self, user: dict[str, Any]) -> bool:
        if user.get("role") == "admin":
            return True
        self._error(HTTPStatus.FORBIDDEN, "forbidden", "Administrator role is required")
        return False

    def _require_idempotency_key(self) -> str | None:
        value = self.headers.get("Idempotency-Key", "").strip()
        if not value or len(value) > 200:
            self._error(HTTPStatus.BAD_REQUEST, "validation_failed", "Idempotency-Key is required for this action")
            return None
        return value

    @staticmethod
    def _stable_id(prefix: str, key: str) -> str:
        return f"{prefix}_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]}"

    @staticmethod
    def _public_profile(profile: dict[str, Any] | None) -> dict[str, Any] | None:
        if profile is None:
            return None
        safe = dict(profile)
        safe.pop("secret_reference", None)
        return safe

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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Request-Id,Idempotency-Key")
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
            self._json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"authenticated": bool(user), "user": {key: user[key] for key in ("user_id", "email", "display_name", "role") if key in user} if user else None})
            return
        user = self._require_user()
        if not user:
            return
        owner_id = user["user_id"]
        if path == "/api/v1/admin/provider-profiles":
            if not self._require_admin(user):
                return
            profiles = self.runtime.service.list_provider_profiles(owner_id, include_archived=query.get("archived") == ["1"])
            self._json(HTTPStatus.OK, {"profiles": [self._public_profile(profile) for profile in profiles]})
            return
        match = self._route(r"/api/v1/admin/provider-profiles/(?P<profile_id>[^/]+)", path)
        if match:
            if not self._require_admin(user):
                return
            profile = self.runtime.store.get_provider_profile(match["profile_id"])
            if not profile:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Provider profile not found")
            else:
                self._json(HTTPStatus.OK, {"profile": self._public_profile(profile)})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/model-policy", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, self.runtime.service.get_model_policy(owner_id, match["project_id"]))
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/text-sources", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"sources": self.runtime.service.list_source_texts(owner_id, match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/agent-runs", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"agent_runs": self.runtime.service.list_agent_runs(owner_id, match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/agent-runs/(?P<agent_run_id>[^/]+)", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            run = self.runtime.store.get_agent_run(match["project_id"], match["agent_run_id"])
            if not run:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Agent run not found")
            else:
                self._json(HTTPStatus.OK, run)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/image-runs/(?P<image_run_id>[^/]+)/attempts", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"attempts": self.runtime.store.list_image_attempts(match["project_id"], match["image_run_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/image-runs", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"image_runs": self.runtime.store.list_image_runs(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/image-runs/(?P<image_run_id>[^/]+)", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            run = self.runtime.store.get_image_run(match["project_id"], match["image_run_id"])
            if not run:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Image run not found")
            else:
                self._json(HTTPStatus.OK, run)
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/deck-revisions", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"deck_revisions": self.runtime.store.list_deck_revisions(match["project_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/deck-revisions/(?P<deck_revision_id>[^/]+)", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            revision = self.runtime.store.get_deck_revision(match["project_id"], match["deck_revision_id"])
            if not revision:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Deck revision not found")
            else:
                self._json(HTTPStatus.OK, revision)
            return
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
        match = self._route(rf"/api/v1/projects/{PROJECT}/documents/(?P<document_id>[^/]+)/manifest", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            manifest = self.runtime.store.get_pptx_import_manifest(match["project_id"], match["document_id"])
            if not manifest:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "PPTX import manifest not found")
            else:
                self._json(HTTPStatus.OK, manifest)
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
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>[^/]+)/visual/approvals", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, {"approvals": self.runtime.store.list_visual_approvals(match["project_id"], match["page_id"])})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>[^/]+)/production-state", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            state = self.runtime.store.get_page_production_state(match["project_id"], match["page_id"])
            self._json(HTTPStatus.OK if state else HTTPStatus.NOT_FOUND, state or {"error": {"code": "not_found", "message": "Page production state not found"}})
            return
        match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>[^/]+)/reconstruction/preflight", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            self._json(HTTPStatus.OK, self.runtime.service.reconstruction_preflight(owner_id, match["project_id"], match["page_id"]))
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
        match = self._route(rf"/api/v1/projects/{PROJECT}/artifacts/(?P<artifact_id>artifact_[a-f0-9]{{32}})/metadata", path)
        if match:
            if not self._require_project(owner_id, match["project_id"]):
                return
            artifact = self.runtime.store.get_artifact(match["project_id"], match["artifact_id"])
            if not artifact:
                self._error(HTTPStatus.NOT_FOUND, "not_found", "Artifact not found")
            else:
                self._json(HTTPStatus.OK, {key: artifact.get(key) for key in ("artifact_id", "project_id", "kind", "media_type", "sha256", "size_bytes", "created_at")})
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
                self._json(HTTPStatus.OK, {"authenticated": True, "user": {"user_id": user["user_id"], "email": user["email"], "display_name": user["display_name"], "role": user.get("role", "member")}}, cookie=cookie)
                return
            if path == "/api/v1/auth/bootstrap-admin":
                body = self._read_json()
                email = str(body.get("email", "")).strip().casefold()
                display_name = str(body.get("display_name", "FastPPT Administrator")).strip()
                password = str(body.get("password", ""))
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or not display_name or len(password) < 12:
                    raise ValueError("A valid email, display name, and password of at least 12 characters are required")
                user = self.runtime.store.consume_admin_bootstrap_token(
                    str(body.get("bootstrap_token", "")),
                    email,
                    display_name,
                    hash_password(password),
                )
                if not user:
                    self._error(HTTPStatus.FORBIDDEN, "forbidden", "The administrator bootstrap token is invalid, used, or no longer applicable")
                    return
                token = self.runtime.store.create_auth_session(user["user_id"])
                cookie = f"fastppt_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure"
                self.runtime.store.audit(user["user_id"], "admin.bootstrap", entity_type="user", entity_id=user["user_id"])
                self._json(HTTPStatus.CREATED, {"authenticated": True, "user": {key: user[key] for key in ("user_id", "email", "display_name", "role")}}, cookie=cookie)
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
            if path == "/api/v1/admin/provider-profiles":
                if not self._require_admin(user):
                    return
                key = self._require_idempotency_key()
                if not key:
                    return
                body["profile_id"] = self._stable_id("profile", key)
                self._json(HTTPStatus.CREATED, self._public_profile(self.runtime.service.create_provider_profile(owner_id, body)))
                return
            match = self._route(r"/api/v1/admin/provider-profiles/(?P<profile_id>[^/]+)/test", path)
            if match:
                if not self._require_admin(user) or not self._require_idempotency_key():
                    return
                result = self.runtime.service.test_provider_profile(owner_id, match["profile_id"], str(body.get("capability", "agent")))
                result["profile"] = self._public_profile(result.get("profile"))
                self._json(HTTPStatus.ACCEPTED, result)
                return
            match = self._route(r"/api/v1/admin/provider-profiles/(?P<profile_id>[^/]+)/default", path)
            if match:
                if not self._require_admin(user) or not self._require_idempotency_key():
                    return
                profile = self.runtime.store.get_provider_profile(match["profile_id"], include_archived=False)
                if not profile:
                    raise NotFoundError("Provider profile not found")
                self.runtime.store.audit(owner_id, "provider_profile.default", entity_type="provider_profile", entity_id=match["profile_id"], detail={"capability": body.get("capability", "agent")})
                self._json(HTTPStatus.OK, {"profile_id": match["profile_id"], "capability": body.get("capability", "agent"), "status": "default"})
                return
            if path == "/api/v1/projects":
                self._json(HTTPStatus.CREATED, self.runtime.service.create_project(owner_id, str(body.get("name", ""))))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/agent-runs", path)
            if match:
                key = self._require_idempotency_key()
                if not key:
                    return
                body["idempotency_key"] = key
                self._json(HTTPStatus.ACCEPTED, self.runtime.service.create_agent_run_record(owner_id, match["project_id"], body))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/agent-runs/(?P<agent_run_id>[^/]+)/decision", path)
            if match:
                if not self._require_project(owner_id, match["project_id"]):
                    return
                if not self._require_idempotency_key():
                    return
                result = self.runtime.store.update_agent_run(match["project_id"], match["agent_run_id"], status=str(body.get("status", "failed")), error=dict(body.get("error") or {}))
                if not result:
                    raise NotFoundError("Agent run not found")
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/agent-runs/(?P<agent_run_id>[^/]+)/reconcile", path)
            if match:
                if not self._require_project(owner_id, match["project_id"]):
                    return
                if not self._require_idempotency_key():
                    return
                result = self.runtime.store.update_agent_run(match["project_id"], match["agent_run_id"], status=str(body.get("status", "failed")), provider_request_id=body.get("provider_request_id"), error=dict(body.get("error") or {}))
                if not result:
                    raise NotFoundError("Agent run not found")
                self._json(HTTPStatus.OK, result)
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
                if not self._require_idempotency_key():
                    return
                session = self.runtime.service.create_session(owner_id, match["project_id"], str(body.get("workflow_mode", "page_entry")), list(body.get("source_document_ids") or []), dict(body.get("options") or {}))
                self._json(HTTPStatus.CREATED, session)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/model-policy", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.OK, self.runtime.service.update_model_policy(owner_id, match["project_id"], body))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/text-sources", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.ACCEPTED, self.runtime.service.create_source_text(owner_id, match["project_id"], str(body.get("text", ""))))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/image-runs", path)
            if match:
                key = self._require_idempotency_key()
                if not key:
                    return
                body["image_run_id"] = self._stable_id("image_run", key)
                self._json(HTTPStatus.ACCEPTED, self.runtime.service.create_image_run(owner_id, match["project_id"], body))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/image-runs/(?P<image_run_id>[^/]+)/decision", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.OK, self.runtime.service.image_run_decision(
                    owner_id,
                    match["project_id"],
                    match["image_run_id"],
                    str(body.get("decision", "")),
                    output_artifact_ids=list(body.get("output_artifact_ids") or []),
                    accept_duplicate_risk=bool(body.get("accept_duplicate_risk", False)),
                    profile_id=str(body.get("profile_id")) if body.get("profile_id") else None,
                ))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/image-attempts/(?P<image_attempt_id>[^/]+)/reconcile", path)
            if match:
                if not self._require_project(owner_id, match["project_id"]):
                    return
                if not self._require_idempotency_key():
                    return
                attempt = self.runtime.store.get_image_attempt(match["project_id"], match["image_attempt_id"])
                if not attempt:
                    raise NotFoundError("Image attempt not found")
                status = str(body.get("status", "failed"))
                if status not in {"completed", "failed", "abandoned"}:
                    raise ValueError("Reconcile status is invalid")
                result = self.runtime.store.update_image_attempt(match["image_attempt_id"], status=status, provider_request_id=body.get("provider_request_id"), output_artifact_ids=list(body.get("output_artifact_ids") or []), output_hashes=list(body.get("output_hashes") or []), error=dict(body.get("error") or {}))
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>[^/]+)/visual/(?P<action>approve|reject)", path)
            if match:
                if not self._require_idempotency_key():
                    return
                result = self.runtime.service.approve_visual(owner_id, match["project_id"], match["page_id"], body) if match["action"] == "approve" else self.runtime.service.reject_visual(owner_id, match["project_id"], match["page_id"], body)
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/pages/(?P<page_id>[^/]+)/reconstruct", path)
            if match:
                key = self._require_idempotency_key()
                if not key:
                    return
                result = self.runtime.service.request_reconstruction(owner_id, match["project_id"], match["page_id"], {**body, "idempotency_key": key})
                self._json(HTTPStatus.ACCEPTED, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/deck-revisions", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.CREATED, self.runtime.service.create_deck_revision(owner_id, match["project_id"], body))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/documents", path)
            if match:
                if not self._require_idempotency_key():
                    return
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
                asset = self.runtime.service.ingest_image_asset(owner_id, match["project_id"], str(body.get("file_name", "")), str(body.get("role", "local_asset")), content, str(body.get("media_type", "")), scope=str(body.get("scope", "project")), page_id=str(body.get("page_id")) if body.get("page_id") else None)
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
                if not self._require_idempotency_key():
                    return
                plan = self.runtime.service.create_generation_plan(owner_id, match["project_id"], str(body.get("session_id", "")), body.get("page_drafts"))
                self._json(HTTPStatus.CREATED, plan)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans/(?P<plan_id>plan_[a-f0-9]{{32}})/(?P<action>confirm|cancel)", path)
            if match:
                if not self._require_idempotency_key():
                    return
                result = self.runtime.service.confirm_generation_plan(owner_id, match["project_id"], match["plan_id"]) if match["action"] == "confirm" else self.runtime.service.cancel_plan(owner_id, match["project_id"], match["plan_id"])
                self._json(HTTPStatus.OK, result)
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans/(?P<plan_id>plan_[a-f0-9]{{32}})/samples/confirm", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.OK, self.runtime.service.confirm_generation_samples(owner_id, match["project_id"], match["plan_id"]))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/plans/(?P<plan_id>plan_[a-f0-9]{{32}})/design/confirm", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.ACCEPTED, self.runtime.service.confirm_generation_design(owner_id, match["project_id"], match["plan_id"], body))
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
            self._error(HTTPStatus.CONFLICT, self._conflict_code(str(exc)), str(exc))
        except (ValueError, KeyError) as exc:
            self._error(HTTPStatus.BAD_REQUEST, "validation_failed", str(exc))
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
            match = self._route(r"/api/v1/admin/provider-profiles/(?P<profile_id>[^/]+)", path)
            if match:
                if not self._require_admin(user) or not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.OK, self._public_profile(self.runtime.service.update_provider_profile(user["user_id"], match["profile_id"], body)))
                return
            match = self._route(rf"/api/v1/projects/{PROJECT}/model-policy", path)
            if match:
                if not self._require_idempotency_key():
                    return
                self._json(HTTPStatus.OK, self.runtime.service.update_model_policy(user["user_id"], match["project_id"], body))
                return
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

    def do_DELETE(self) -> None:
        if not self._origin_allowed():
            self._error(HTTPStatus.FORBIDDEN, "origin_rejected", "Origin is not allowed")
            return
        user = self._require_user()
        if not user:
            return
        path = urlsplit(self.path).path
        match = self._route(r"/api/v1/admin/provider-profiles/(?P<profile_id>[^/]+)", path)
        if not match:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "API route not found")
            return
        if not self._require_admin(user) or not self._require_idempotency_key():
            return
        try:
            self._json(HTTPStatus.OK, self._public_profile(self.runtime.service.archive_provider_profile(user["user_id"], match["profile_id"])))
        except NotFoundError as exc:
            self._error(HTTPStatus.NOT_FOUND, "not_found", str(exc))


def build_handler(runtime: Runtime) -> type[ApiHandler]:
    web_root = runtime.settings.repository_root / "apps" / "web" / "dist"
    if not (web_root / "index.html").is_file():
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
