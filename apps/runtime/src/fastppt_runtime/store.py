"""Transactional metadata stores shared by all FastPPT services."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator, Protocol

from fastppt_core.contracts import (
    AGENT_RUN_TRANSITIONS,
    IMAGE_ATTEMPT_TRANSITIONS,
    IMAGE_RUN_TRANSITIONS,
    validate_transition,
)
from fastppt_core.ids import new_id
from fastppt_core.version import SCHEMA_VERSION


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


SQLITE_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  password_hash TEXT, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_bootstrap_tokens (
  token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),
  name TEXT NOT NULL, status TEXT NOT NULL, current_deck_revision_id TEXT,
  v2_default_selection_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_sessions (
  session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  workflow_mode TEXT NOT NULL, source_document_ids TEXT NOT NULL, options_json TEXT NOT NULL, plan_id TEXT,
  status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  kind TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, media_type TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  file_name TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  parse_status TEXT NOT NULL, summary TEXT, error TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(project_id, sha256)
);
CREATE TABLE IF NOT EXISTS facts (
  fact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  kind TEXT NOT NULL, value TEXT NOT NULL, normalized_value TEXT NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES documents(document_id), source_locator TEXT NOT NULL,
  confidence REAL NOT NULL, locked INTEGER NOT NULL DEFAULT 0, conflict_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fact_conflicts (
  conflict_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  conflict_key TEXT NOT NULL, kind TEXT NOT NULL, fact_ids TEXT NOT NULL,
  status TEXT NOT NULL, resolution TEXT, resolved_fact_ids TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, conflict_key)
);
CREATE TABLE IF NOT EXISTS project_assets (
  asset_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), file_name TEXT NOT NULL,
  role TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project', page_id TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  current_version_id TEXT, order_index INTEGER NOT NULL, page_type TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  fact_anchor_ids TEXT NOT NULL, UNIQUE(project_id, order_index)
);
CREATE TABLE IF NOT EXISTS page_versions (
  version_id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(page_id),
  parent_version_id TEXT, operation_id TEXT, page_contract_artifact_id TEXT NOT NULL,
  prompt_snapshot_artifact_id TEXT, quick_preview_artifact_id TEXT,
  visual_preview_artifact_id TEXT, svg_artifact_id TEXT, pptx_render_artifact_id TEXT,
  editable_level TEXT NOT NULL, status TEXT NOT NULL, qa_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT REFERENCES work_sessions(session_id), structured_plan TEXT NOT NULL,
  confirmation_required INTEGER NOT NULL, confirmed_at TEXT, status TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  operation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT, target_scope TEXT NOT NULL, requested_page_ids TEXT NOT NULL,
  resolved_page_ids TEXT NOT NULL, structured_plan TEXT NOT NULL,
  confirmation_required INTEGER NOT NULL, confirmed_at TEXT, result_version_ids TEXT NOT NULL,
  status TEXT NOT NULL, error_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS export_jobs (
  export_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  version_lock TEXT NOT NULL, artifact_id TEXT, status TEXT NOT NULL,
  qa_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_ledger (
  ledger_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  operation_id TEXT, request_id TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, model TEXT NOT NULL, price_snapshot TEXT NOT NULL,
  reserved TEXT NOT NULL, settled TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
  submission_status TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_owner TEXT, lease_expires_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, project_id TEXT, session_id TEXT, operation_id TEXT,
  page_id TEXT, version_id TEXT, export_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  project_id TEXT, entity_type TEXT, entity_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workers (
  worker_id TEXT PRIMARY KEY, worker_kind TEXT NOT NULL, status TEXT NOT NULL,
  detail TEXT NOT NULL, last_heartbeat TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_profiles (
  profile_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, endpoint_mode TEXT NOT NULL,
  base_url TEXT, secret_reference TEXT NOT NULL, capability_settings TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
  connection_status_by_capability TEXT NOT NULL, last_tested_at_by_capability TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(user_id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_model_policies (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id),
  agent_profile_id TEXT, agent_model TEXT,
  image_generation_profile_id TEXT, image_generation_model TEXT,
  image_edit_profile_id TEXT, image_edit_model TEXT,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_texts (
  source_text_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), text_content TEXT NOT NULL,
  sha256 TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  agent_run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT, parent_run_id TEXT, role TEXT NOT NULL, profile_id TEXT NOT NULL,
  model TEXT NOT NULL, input_artifact_ids TEXT NOT NULL, output_artifact_ids TEXT NOT NULL,
  context_digest TEXT NOT NULL, status TEXT NOT NULL, usage_request_id TEXT NOT NULL,
  retry_of_run_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, provider_request_id TEXT,
  provider_snapshot TEXT NOT NULL, error_json TEXT NOT NULL,
  prompt_artifact_id TEXT, prompt_id TEXT NOT NULL DEFAULT '', prompt_version TEXT NOT NULL DEFAULT 'legacy',
  input_contract_version TEXT NOT NULL DEFAULT 'legacy', output_schema_version TEXT NOT NULL DEFAULT 'legacy',
  input_context_digest TEXT NOT NULL DEFAULT '', prompt_digest TEXT NOT NULL DEFAULT '', output_digest TEXT NOT NULL DEFAULT '',
  context_manifest_artifact_id TEXT, truncation_report_artifact_id TEXT,
  parent_output_artifact_ids TEXT NOT NULL DEFAULT '[]', design_selection_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image_runs (
  image_run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  page_id TEXT, purpose TEXT NOT NULL, prompt_artifact_id TEXT NOT NULL,
  input_artifact_ids TEXT NOT NULL, input_hashes TEXT NOT NULL, status TEXT NOT NULL,
  selected_output_artifact_ids TEXT NOT NULL, decision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image_attempts (
  image_attempt_id TEXT PRIMARY KEY, image_run_id TEXT NOT NULL REFERENCES image_runs(image_run_id),
  retry_of_attempt_id TEXT, attempt_number INTEGER NOT NULL, profile_id TEXT NOT NULL,
  provider_snapshot TEXT NOT NULL, endpoint_mode TEXT NOT NULL, model TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE, provider_request_id TEXT, usage_request_id TEXT NOT NULL,
  status TEXT NOT NULL, output_artifact_ids TEXT NOT NULL, output_hashes TEXT NOT NULL,
  error_json TEXT NOT NULL, prompt_artifact_id TEXT, input_summary TEXT NOT NULL DEFAULT '{}',
  output_digest TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_envelopes (
  envelope_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_run_id TEXT, prompt_artifact_id TEXT NOT NULL, prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL, input_contract_version TEXT NOT NULL, output_schema_version TEXT NOT NULL,
  input_context_digest TEXT NOT NULL, prompt_digest TEXT NOT NULL, provider_snapshot TEXT NOT NULL,
  expires_at TEXT NOT NULL, content_deleted_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS context_manifests (
  context_manifest_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_run_id TEXT NOT NULL, artifact_id TEXT NOT NULL, input_context_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS truncation_reports (
  truncation_report_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_run_id TEXT NOT NULL, artifact_id TEXT NOT NULL, long_context INTEGER NOT NULL,
  original_estimated_tokens INTEGER NOT NULL, retained_estimated_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_packs (
  pack_id TEXT PRIMARY KEY, pack_kind TEXT NOT NULL, scope TEXT NOT NULL,
  owner_id TEXT REFERENCES users(user_id), display_name TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL, current_version TEXT NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_pack_versions (
  pack_id TEXT NOT NULL REFERENCES design_packs(pack_id), version TEXT NOT NULL,
  bundle_id TEXT NOT NULL, content_hash TEXT NOT NULL, manifest_json TEXT NOT NULL,
  storage_path TEXT NOT NULL, validation_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(pack_id, version)
);
CREATE TABLE IF NOT EXISTS design_pack_membership (
  bundle_id TEXT NOT NULL, pack_id TEXT NOT NULL REFERENCES design_packs(pack_id),
  version TEXT NOT NULL, dependency_ids TEXT NOT NULL, PRIMARY KEY(bundle_id, pack_id, version)
);
CREATE TABLE IF NOT EXISTS design_selections (
  design_selection_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT, plan_id TEXT, page_id TEXT, style_pack_id TEXT, style_version TEXT,
  style_content_hash TEXT, template_pack_id TEXT, template_version TEXT, template_content_hash TEXT,
  selection_scope TEXT NOT NULL, selected_by TEXT NOT NULL, selection_source TEXT NOT NULL,
  status TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS logic_analysis_artifacts (
  logic_analysis_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT, plan_id TEXT, agent_run_id TEXT, artifact_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visual_approvals (
  visual_approval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  page_id TEXT NOT NULL, contract_revision INTEGER NOT NULL, visual_artifact_id TEXT NOT NULL,
  visual_sha256 TEXT NOT NULL, decision TEXT NOT NULL, comment TEXT NOT NULL,
  actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconstruction_manifests (
  reconstruction_manifest_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  page_id TEXT NOT NULL, version_id TEXT NOT NULL, page_contract_artifact_id TEXT NOT NULL,
  visual_approval_id TEXT NOT NULL, source_import_manifest_id TEXT, objects_json TEXT NOT NULL,
  unresolved_items TEXT NOT NULL, qa_report_id TEXT NOT NULL, aggregate_sha256 TEXT NOT NULL,
  schema_version TEXT NOT NULL, artifact_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_production_states (
  page_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  contract_revision INTEGER NOT NULL, current_image_run_id TEXT, selected_visual_artifact_id TEXT,
  visual_approval_id TEXT, reconstruction_manifest_id TEXT, reconstruction_status TEXT NOT NULL,
  render_authority_record_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS render_authority_records (
  render_authority_record_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  page_id TEXT NOT NULL, version_id TEXT NOT NULL, pptx_artifact_id TEXT NOT NULL, pptx_sha256 TEXT NOT NULL,
  render_worker TEXT NOT NULL, office_version TEXT, status TEXT NOT NULL,
  output_png_artifact_id TEXT, output_png_sha256 TEXT, qa_report_id TEXT, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pptx_import_manifests (
  manifest_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  document_id TEXT NOT NULL, source_artifact_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
  page_size TEXT NOT NULL, pages_json TEXT NOT NULL, aggregate_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deck_revisions (
  deck_revision_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  parent_revision_id TEXT, source_session_id TEXT NOT NULL, source_mode TEXT NOT NULL,
  ordered_pages TEXT NOT NULL, status TEXT NOT NULL, aggregate_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_design_snapshots (
  snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  idempotency_key TEXT NOT NULL, mode TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS v2_page_contract_snapshots (
  snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  page_id TEXT NOT NULL, version_id TEXT NOT NULL, contract_json TEXT NOT NULL,
  content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, page_id, version_id)
);
CREATE TABLE IF NOT EXISTS v2_generation_checkpoints (
  checkpoint_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  idempotency_key TEXT NOT NULL, stage TEXT NOT NULL, checkpoint_json TEXT NOT NULL,
  content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS v2_artifact_commits (
  commit_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  idempotency_key TEXT NOT NULL, artifact_json TEXT NOT NULL, content_hash TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS v2_export_snapshots (
  export_snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  snapshot_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_export_attempts (
  export_attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id),
  export_snapshot_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, status TEXT NOT NULL,
  attempt_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(project_id, export_snapshot_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_conflicts_project ON fact_conflicts(project_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_project ON project_assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_ledger(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_versions_page ON page_versions(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, seq);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_active ON provider_profiles(enabled, archived_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_envelopes_project ON prompt_envelopes(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_packs_owner ON design_packs(owner_id, scope, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_design_selections_project ON design_selections(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_runs_project ON image_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_attempts_run ON image_attempts(image_run_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_reconstruction_project ON reconstruction_manifests(project_id, page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_revisions_project ON deck_revisions(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v2_design_snapshots_project ON v2_design_snapshots(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v2_checkpoints_project ON v2_generation_checkpoints(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v2_export_snapshots_project ON v2_export_snapshots(project_id, created_at);
"""


POSTGRES_SCHEMA = SQLITE_SCHEMA.replace("PRAGMA foreign_keys = ON;", "").replace(
    "seq INTEGER PRIMARY KEY AUTOINCREMENT", "seq BIGSERIAL PRIMARY KEY"
)


class Store(Protocol):
    def health(self) -> dict[str, str]: ...


class MetadataStore:
    placeholder = "?"

    def __init__(self) -> None:
        self._write_lock = threading.RLock()

    @contextmanager
    def connection(self) -> Iterator[Any]:
        raise NotImplementedError

    def initialize(self) -> None:
        raise NotImplementedError

    @contextmanager
    def transaction(self) -> Iterator[Any]:
        with self._write_lock, self.connection() as connection:
            try:
                # SQLite's default deferred transaction allows two worker
                # processes to select the same queued row before either one
                # writes.  Acquire the write reservation before the read.
                if self.placeholder == "?":
                    connection.execute("BEGIN IMMEDIATE")
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def _sql(self, statement: str) -> str:
        return statement if self.placeholder == "?" else statement.replace("?", self.placeholder)

    @staticmethod
    def _dict(row: Any) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def health(self) -> dict[str, str]:
        try:
            with self.connection() as connection:
                connection.execute("SELECT 1").fetchone()
            return {"status": "ready", "backend": self.__class__.__name__}
        except Exception as exc:
            return {"status": "failed", "backend": self.__class__.__name__, "detail": str(exc)}

    def ensure_local_user(self) -> dict[str, Any]:
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM users WHERE email = ?" if self.placeholder == "?" else "SELECT * FROM users WHERE email = %s", ("local@fastppt.invalid",)).fetchone()
            if row:
                return dict(row)
            now = utc_now()
            user_id = new_id("user")
            connection.execute(
                self._sql("INSERT INTO users(user_id,email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)"),
                (user_id, "local@fastppt.invalid", "Local User", None, "admin", now),
            )
            return {"user_id": user_id, "email": "local@fastppt.invalid", "display_name": "Local User", "role": "admin", "created_at": now}

    def create_user(self, email: str, display_name: str, password_hash: str, role: str = "member") -> dict[str, Any]:
        if role not in {"admin", "member"}:
            raise ValueError("User role must be admin or member")
        now, user_id = utc_now(), new_id("user")
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO users(user_id,email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)"),
                (user_id, email.casefold(), display_name, password_hash, role, now),
            )
        return {"user_id": user_id, "email": email.casefold(), "display_name": display_name, "role": role, "created_at": now}

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM users WHERE user_id=?"), (user_id,)).fetchone())

    def ensure_admin_bootstrap_token(self, token: str) -> None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO admin_bootstrap_tokens(token_hash,created_at,used_at) VALUES(?,?,?) ON CONFLICT(token_hash) DO NOTHING"),
                (token_hash, utc_now(), None),
            )

    def consume_admin_bootstrap_token(
        self,
        token: str,
        email: str,
        display_name: str,
        password_hash: str,
    ) -> dict[str, Any] | None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = utc_now()
        with self.transaction() as connection:
            row = connection.execute(
                self._sql("SELECT used_at FROM admin_bootstrap_tokens WHERE token_hash=?"),
                (token_hash,),
            ).fetchone()
            if not row or row["used_at"] is not None:
                return None
            existing_admin = connection.execute(
                self._sql("SELECT user_id FROM users WHERE role=? LIMIT 1"),
                ("admin",),
            ).fetchone()
            if existing_admin:
                return None
            user_id = new_id("user")
            connection.execute(
                self._sql("INSERT INTO users(user_id,email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)"),
                (user_id, email.casefold(), display_name, password_hash, "admin", now),
            )
            connection.execute(
                self._sql("UPDATE admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL"),
                (now, token_hash),
            )
        return {"user_id": user_id, "email": email.casefold(), "display_name": display_name, "role": "admin", "created_at": now}

    def user_by_email(self, email: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM users WHERE email = ?"), (email.casefold(),)).fetchone())

    def create_auth_session(self, user_id: str, ttl_hours: int = 12) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = datetime.now(UTC)
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)"),
                (token_hash, user_id, (now + timedelta(hours=ttl_hours)).isoformat(), now.isoformat()),
            )
        return token

    def user_for_token(self, token: str) -> dict[str, Any] | None:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.connection() as connection:
            return self._dict(
                connection.execute(
                    self._sql("SELECT u.* FROM auth_sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?"),
                    (token_hash, utc_now()),
                ).fetchone()
            )

    def delete_auth_session(self, token: str) -> None:
        with self.transaction() as connection:
            connection.execute(self._sql("DELETE FROM auth_sessions WHERE token_hash=?"), (hashlib.sha256(token.encode()).hexdigest(),))

    def create_project(self, owner_id: str, name: str, *, v2_default_selection: Mapping[str, Any] | None = None) -> dict[str, Any]:
        project_id, now = new_id("project"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO projects(project_id,owner_id,name,status,current_deck_revision_id,v2_default_selection_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"),
                (project_id, owner_id, name, "draft", None, json.dumps(dict(v2_default_selection or {}), ensure_ascii=False), now, now),
            )
        return self.get_project(owner_id, project_id) or {}

    @staticmethod
    def _decode_project(row: dict[str, Any] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        row["v2_default_selection"] = MetadataStore._json_load(row.pop("v2_default_selection_json", None), {})
        return row

    def get_project(self, owner_id: str, project_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM projects WHERE owner_id=? AND project_id=?"), (owner_id, project_id)).fetchone())
        return self._decode_project(row)

    def list_projects(self, owner_id: str, *, include_archived: bool = False) -> list[dict[str, Any]]:
        statement = "SELECT * FROM projects WHERE owner_id=?"
        values: tuple[Any, ...] = (owner_id,)
        if not include_archived:
            statement += " AND status<>'archived'"
        statement += " ORDER BY updated_at DESC"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(statement), values).fetchall()]
        return [item for item in (self._decode_project(row) for row in rows) if item is not None]

    def update_project(self, owner_id: str, project_id: str, *, name: str | None = None, status: str | None = None) -> dict[str, Any] | None:
        current = self.get_project(owner_id, project_id)
        if not current:
            return None
        with self.transaction() as connection:
            connection.execute(
                self._sql("UPDATE projects SET name=?,status=?,updated_at=? WHERE owner_id=? AND project_id=?"),
                (name or current["name"], status or current["status"], utc_now(), owner_id, project_id),
            )
        return self.get_project(owner_id, project_id)

    def add_artifact(self, project_id: str, kind: str, storage_key: str, sha256: str, size_bytes: int, media_type: str, *, artifact_id: str | None = None) -> dict[str, Any]:
        artifact_id, now = artifact_id or new_id("artifact"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO artifacts(artifact_id,project_id,kind,storage_key,sha256,size_bytes,media_type,created_at) VALUES(?,?,?,?,?,?,?,?)"),
                (artifact_id, project_id, kind, storage_key, sha256, size_bytes, media_type, now),
            )
        return {"artifact_id": artifact_id, "project_id": project_id, "kind": kind, "sha256": sha256, "size_bytes": size_bytes, "media_type": media_type, "created_at": now}

    def get_artifact(self, project_id: str, artifact_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM artifacts WHERE project_id=? AND artifact_id=?"), (project_id, artifact_id)).fetchone())

    def add_document(self, project_id: str, file_name: str, media_type: str, sha256: str, size_bytes: int, artifact_id: str, created_by: str, parse_status: str, summary: str | None = None, error: str | None = None) -> dict[str, Any]:
        document_id, now = new_id("document"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO documents(document_id,project_id,file_name,media_type,sha256,size_bytes,artifact_id,parse_status,summary,error,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"),
                (document_id, project_id, file_name, media_type, sha256, size_bytes, artifact_id, parse_status, summary, error, created_by, now),
            )
        return self.get_document(project_id, document_id) or {}

    def get_document(self, project_id: str, document_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM documents WHERE project_id=? AND document_id=?"), (project_id, document_id)).fetchone())

    def document_by_hash(self, project_id: str, sha256: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM documents WHERE project_id=? AND sha256=?"), (project_id, sha256)).fetchone())

    def list_documents(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(self._sql("SELECT * FROM documents WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]

    def update_document_parse(self, project_id: str, document_id: str, status: str, summary: str | None, error: str | None) -> None:
        with self.transaction() as connection:
            connection.execute(self._sql("UPDATE documents SET parse_status=?,summary=?,error=? WHERE project_id=? AND document_id=?"), (status, summary, error, project_id, document_id))

    def add_fact(self, project_id: str, kind: str, value: str, normalized_value: str, document_id: str, source_locator: str, confidence: float, locked: bool = False, conflict_key: str = "") -> dict[str, Any]:
        fact_id, now = new_id("fact"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO facts(fact_id,project_id,kind,value,normalized_value,source_document_id,source_locator,confidence,locked,conflict_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"),
                (fact_id, project_id, kind, value, normalized_value, document_id, source_locator, confidence, int(locked), conflict_key, now),
            )
        return {"fact_id": fact_id, "kind": kind, "value": value, "normalized_value": normalized_value, "source_document_id": document_id, "source_locator": source_locator, "confidence": confidence, "locked": locked, "conflict_key": conflict_key}

    def replace_document_facts(self, project_id: str, document_id: str, facts: list[dict[str, Any]]) -> None:
        """Atomically replace parser output so a retried parse cannot duplicate facts."""
        with self.transaction() as connection:
            connection.execute(
                self._sql("DELETE FROM facts WHERE project_id=? AND source_document_id=?"),
                (project_id, document_id),
            )
            now = utc_now()
            for fact in facts:
                connection.execute(
                    self._sql("INSERT INTO facts(fact_id,project_id,kind,value,normalized_value,source_document_id,source_locator,confidence,locked,conflict_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"),
                    (
                        new_id("fact"),
                        project_id,
                        fact["kind"],
                        fact["value"],
                        fact["normalized_value"],
                        document_id,
                        fact["source_locator"],
                        float(fact["confidence"]),
                        int(bool(fact.get("locked", False))),
                        str(fact.get("conflict_key", "")),
                        now,
                    ),
                )

    def list_facts(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(self._sql("SELECT * FROM facts WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]

    def set_fact_locked(self, project_id: str, fact_id: str, locked: bool) -> dict[str, Any] | None:
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE facts SET locked=? WHERE project_id=? AND fact_id=?"), (int(locked), project_id, fact_id))
        if cursor.rowcount != 1:
            return None
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM facts WHERE project_id=? AND fact_id=?"), (project_id, fact_id)).fetchone())

    def rebuild_fact_conflicts(self, project_id: str) -> list[dict[str, Any]]:
        facts = self.list_facts(project_id)
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for fact in facts:
            key = str(fact.get("conflict_key") or "")
            if key:
                groups.setdefault((fact["kind"], key), []).append(fact)
        detected = {
            key: values
            for key, values in groups.items()
            if len({item["source_document_id"] for item in values}) > 1
            and len({item["normalized_value"] for item in values}) > 1
        }
        now = utc_now()
        with self.transaction() as connection:
            current_rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM fact_conflicts WHERE project_id=?"), (project_id,)).fetchall()]
            current = {row["conflict_key"]: row for row in current_rows}
            active_keys: set[str] = set()
            for (kind, conflict_key), values in detected.items():
                active_keys.add(conflict_key)
                fact_ids = [item["fact_id"] for item in values]
                previous = current.get(conflict_key)
                previous_fact_ids = set(json.loads(previous["fact_ids"])) if previous else set()
                same_candidates = previous is not None and previous_fact_ids == set(fact_ids)
                status = previous["status"] if same_candidates and previous["status"] != "stale" else "detected"
                resolved = json.loads(previous["resolved_fact_ids"]) if same_candidates else []
                if resolved and not set(resolved).issubset(fact_ids):
                    status, resolved = "detected", []
                if previous:
                    connection.execute(self._sql("UPDATE fact_conflicts SET kind=?,fact_ids=?,status=?,resolved_fact_ids=?,updated_at=? WHERE project_id=? AND conflict_key=?"), (kind, json.dumps(fact_ids), status, json.dumps(resolved), now, project_id, conflict_key))
                else:
                    connection.execute(self._sql("INSERT INTO fact_conflicts(conflict_id,project_id,conflict_key,kind,fact_ids,status,resolution,resolved_fact_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"), (new_id("conflict"), project_id, conflict_key, kind, json.dumps(fact_ids), "detected", None, json.dumps([]), now, now))
            for conflict_key in set(current).difference(active_keys):
                connection.execute(self._sql("UPDATE fact_conflicts SET status='stale',updated_at=? WHERE project_id=? AND conflict_key=?"), (now, project_id, conflict_key))
        return self.list_fact_conflicts(project_id)

    def list_fact_conflicts(self, project_id: str, *, include_stale: bool = False) -> list[dict[str, Any]]:
        statement = "SELECT * FROM fact_conflicts WHERE project_id=?"
        if not include_stale:
            statement += " AND status<>'stale'"
        statement += " ORDER BY created_at"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(statement), (project_id,)).fetchall()]
        facts = {item["fact_id"]: item for item in self.list_facts(project_id)}
        for row in rows:
            row["fact_ids"] = json.loads(row["fact_ids"])
            row["resolved_fact_ids"] = json.loads(row["resolved_fact_ids"])
            row["facts"] = [facts[fact_id] for fact_id in row["fact_ids"] if fact_id in facts]
        return rows

    def resolve_fact_conflict(self, project_id: str, conflict_id: str, resolution: str, fact_ids: list[str]) -> dict[str, Any] | None:
        if resolution not in {"prefer", "keep_both", "ignore"}:
            raise ValueError("Invalid fact conflict resolution")
        with self.transaction() as connection:
            row = connection.execute(self._sql("SELECT * FROM fact_conflicts WHERE project_id=? AND conflict_id=? AND status<>'stale'"), (project_id, conflict_id)).fetchone()
            if not row:
                return None
            allowed = set(json.loads(row["fact_ids"]))
            selected = list(dict.fromkeys(fact_ids))
            if not set(selected).issubset(allowed):
                raise ValueError("Conflict resolution references an unrelated fact")
            if resolution == "prefer" and len(selected) != 1:
                raise ValueError("Prefer resolution requires exactly one fact")
            if resolution == "keep_both":
                selected = [fact_id for fact_id in json.loads(row["fact_ids"]) if fact_id in allowed]
            if resolution == "ignore":
                selected = []
            for fact_id in allowed:
                connection.execute(self._sql("UPDATE facts SET locked=0 WHERE project_id=? AND fact_id=?"), (project_id, fact_id))
            for fact_id in selected:
                connection.execute(self._sql("UPDATE facts SET locked=1 WHERE project_id=? AND fact_id=?"), (project_id, fact_id))
            connection.execute(self._sql("UPDATE fact_conflicts SET status='resolved',resolution=?,resolved_fact_ids=?,updated_at=? WHERE project_id=? AND conflict_id=?"), (resolution, json.dumps(selected), utc_now(), project_id, conflict_id))
        return next((item for item in self.list_fact_conflicts(project_id) if item["conflict_id"] == conflict_id), None)

    def add_project_asset(self, project_id: str, artifact_id: str, file_name: str, role: str, media_type: str, sha256: str, created_by: str, *, scope: str = "project", page_id: str | None = None) -> dict[str, Any]:
        asset_id, now = new_id("asset"), utc_now()
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO project_assets(asset_id,project_id,artifact_id,file_name,role,media_type,sha256,scope,page_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"), (asset_id, project_id, artifact_id, file_name, role, media_type, sha256, scope, page_id, created_by, now))
        return {"asset_id": asset_id, "project_id": project_id, "artifact_id": artifact_id, "file_name": file_name, "role": role, "media_type": media_type, "sha256": sha256, "scope": scope, "page_id": page_id, "created_at": now}

    def list_project_assets(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(self._sql("SELECT * FROM project_assets WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]

    def create_page_with_version(self, project_id: str, order_index: int, page_type: str, fact_anchor_ids: list[str], version: dict[str, Any], *, page_id: str | None = None) -> dict[str, Any]:
        page_id, version_id, now = page_id or new_id("page"), new_id("version"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO pages(page_id,project_id,current_version_id,order_index,page_type,locked,archived,fact_anchor_ids) VALUES(?,?,?,?,?,?,?,?)"),
                (page_id, project_id, None, order_index, page_type, 0, 0, json.dumps(fact_anchor_ids)),
            )
            connection.execute(
                self._sql("INSERT INTO page_versions(version_id,page_id,parent_version_id,operation_id,page_contract_artifact_id,prompt_snapshot_artifact_id,quick_preview_artifact_id,visual_preview_artifact_id,svg_artifact_id,pptx_render_artifact_id,editable_level,status,qa_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),
                (version_id, page_id, None, version.get("operation_id"), version["page_contract_artifact_id"], version.get("prompt_snapshot_artifact_id"), version.get("quick_preview_artifact_id"), version.get("visual_preview_artifact_id"), version.get("svg_artifact_id"), version.get("pptx_render_artifact_id"), version.get("editable_level", "native_structure"), version.get("status", "ready"), json.dumps(version.get("qa", {})), now),
            )
            connection.execute(self._sql("UPDATE pages SET current_version_id=? WHERE page_id=?"), (version_id, page_id))
        return {"page_id": page_id, "version_id": version_id, "order_index": order_index, "page_type": page_type}

    def list_pages(self, project_id: str) -> list[dict[str, Any]]:
        statement = """SELECT p.*,v.operation_id,v.status AS version_status,v.editable_level,v.page_contract_artifact_id,v.prompt_snapshot_artifact_id,v.quick_preview_artifact_id,v.visual_preview_artifact_id,v.svg_artifact_id,v.pptx_render_artifact_id,v.qa_json,v.created_at AS version_created_at FROM pages p LEFT JOIN page_versions v ON v.version_id=p.current_version_id WHERE p.project_id=? AND p.archived=0 ORDER BY p.order_index"""
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(statement), (project_id,)).fetchall()]
        for row in rows:
            row["fact_anchor_ids"] = json.loads(row["fact_anchor_ids"])
            row["qa"] = json.loads(row.pop("qa_json") or "{}")
        return rows

    def get_page(self, project_id: str, page_id: str) -> dict[str, Any] | None:
        pages = [page for page in self.list_pages(project_id) if page["page_id"] == page_id]
        return pages[0] if pages else None

    def create_page_version(self, project_id: str, page_id: str, version: dict[str, Any]) -> dict[str, Any] | None:
        page = self.get_page(project_id, page_id)
        if not page:
            return None
        version_id, now = new_id("version"), utc_now()
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO page_versions(version_id,page_id,parent_version_id,operation_id,page_contract_artifact_id,prompt_snapshot_artifact_id,quick_preview_artifact_id,visual_preview_artifact_id,svg_artifact_id,pptx_render_artifact_id,editable_level,status,qa_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),
                (version_id, page_id, page["current_version_id"], version.get("operation_id"), version["page_contract_artifact_id"], version.get("prompt_snapshot_artifact_id"), version.get("quick_preview_artifact_id"), version.get("visual_preview_artifact_id"), version.get("svg_artifact_id"), version.get("pptx_render_artifact_id"), version.get("editable_level", "native_structure"), version.get("status", "ready"), json.dumps(version.get("qa", {})), now),
            )
            connection.execute(self._sql("UPDATE pages SET current_version_id=? WHERE project_id=? AND page_id=?"), (version_id, project_id, page_id))
        return {"version_id": version_id, "page_id": page_id, "parent_version_id": page["current_version_id"], "created_at": now}

    def versions_for_page(self, project_id: str, page_id: str) -> list[dict[str, Any]]:
        statement = "SELECT v.* FROM page_versions v JOIN pages p ON p.page_id=v.page_id WHERE p.project_id=? AND v.page_id=? ORDER BY v.created_at DESC"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(statement), (project_id, page_id)).fetchall()]
        for row in rows:
            row["qa"] = json.loads(row.pop("qa_json") or "{}")
        return rows

    def versions_for_operation(self, project_id: str, operation_id: str) -> list[dict[str, Any]]:
        statement = "SELECT v.*,p.order_index,p.page_type FROM page_versions v JOIN pages p ON p.page_id=v.page_id WHERE p.project_id=? AND v.operation_id=? ORDER BY p.order_index,v.created_at,v.version_id"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(statement), (project_id, operation_id)).fetchall()]
        for row in rows:
            row["qa"] = json.loads(row.pop("qa_json") or "{}")
        return rows

    def get_version(self, project_id: str, version_id: str) -> dict[str, Any] | None:
        statement = "SELECT v.* FROM page_versions v JOIN pages p ON p.page_id=v.page_id WHERE p.project_id=? AND v.version_id=?"
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(statement), (project_id, version_id)).fetchone())
        if row:
            row["qa"] = json.loads(row.pop("qa_json") or "{}")
        return row

    def restore_version(self, project_id: str, page_id: str, version_id: str) -> bool:
        with self.transaction() as connection:
            exists = connection.execute(self._sql("SELECT 1 FROM page_versions v JOIN pages p ON p.page_id=v.page_id WHERE p.project_id=? AND v.page_id=? AND v.version_id=?"), (project_id, page_id, version_id)).fetchone()
            if not exists:
                return False
            connection.execute(self._sql("UPDATE pages SET current_version_id=? WHERE project_id=? AND page_id=?"), (version_id, project_id, page_id))
        return True

    def set_page_fact_anchors(self, project_id: str, page_id: str, fact_ids: list[str]) -> bool:
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE pages SET fact_anchor_ids=? WHERE project_id=? AND page_id=?"), (json.dumps(list(dict.fromkeys(fact_ids))), project_id, page_id))
        return cursor.rowcount == 1

    def create_work_session(self, project_id: str, workflow_mode: str, source_document_ids: list[str], created_by: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        session_id, now = new_id("session"), utc_now()
        session_options = dict(options or {})
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO work_sessions(session_id,project_id,workflow_mode,source_document_ids,options_json,plan_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"), (session_id, project_id, workflow_mode, json.dumps(source_document_ids), json.dumps(session_options), None, "draft", created_by, now, now))
        return {"session_id": session_id, "project_id": project_id, "workflow_mode": workflow_mode, "source_document_ids": source_document_ids, "options": session_options, "status": "draft", "created_at": now, "updated_at": now}

    def get_work_session(self, project_id: str, session_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM work_sessions WHERE project_id=? AND session_id=?"), (project_id, session_id)).fetchone())
        if row:
            row["source_document_ids"] = json.loads(row["source_document_ids"])
            row["options"] = self._json_load(row.pop("options_json", None), {})
        return row

    def create_plan(self, project_id: str, session_id: str | None, plan: dict[str, Any], confirmation_required: bool, created_by: str) -> dict[str, Any]:
        plan_id, now = new_id("plan"), utc_now()
        status = str(plan.get("generationStage") or ("planned" if confirmation_required else "confirmed"))
        confirmed_at = None if confirmation_required else now
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO plans(plan_id,project_id,session_id,structured_plan,confirmation_required,confirmed_at,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)"), (plan_id, project_id, session_id, json.dumps(plan), int(confirmation_required), confirmed_at, status, created_by, now))
            if session_id:
                connection.execute(self._sql("UPDATE work_sessions SET plan_id=?,status=?,updated_at=? WHERE session_id=? AND project_id=?"), (plan_id, status, now, session_id, project_id))
        return {"plan_id": plan_id, "structured_plan": plan, "confirmation_required": confirmation_required, "confirmed_at": confirmed_at, "status": status, "created_at": now}

    def update_plan_status(self, project_id: str, plan_id: str, status: str) -> bool:
        now = utc_now()
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE plans SET status=?,confirmed_at=? WHERE project_id=? AND plan_id=?"), (status, now if status == "confirmed" else None, project_id, plan_id))
        return cursor.rowcount == 1

    def update_plan(self, project_id: str, plan_id: str, *, status: str, structured_plan: dict[str, Any] | None = None, confirmed: bool = False) -> bool:
        now = utc_now()
        with self.transaction() as connection:
            cursor = connection.execute(
                self._sql("UPDATE plans SET status=?,structured_plan=COALESCE(?,structured_plan),confirmed_at=CASE WHEN ?=1 THEN COALESCE(confirmed_at,?) ELSE confirmed_at END WHERE project_id=? AND plan_id=?"),
                (status, json.dumps(structured_plan) if structured_plan is not None else None, int(confirmed), now, project_id, plan_id),
            )
            connection.execute(self._sql("UPDATE work_sessions SET status=?,updated_at=? WHERE project_id=? AND plan_id=?"), (status, now, project_id, plan_id))
        return cursor.rowcount == 1

    def get_plan(self, project_id: str, plan_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM plans WHERE project_id=? AND plan_id=?"), (project_id, plan_id)).fetchone())
        if row:
            row["structured_plan"] = json.loads(row["structured_plan"])
            row["confirmation_required"] = bool(row["confirmation_required"])
        return row

    def list_plans(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM plans WHERE project_id=? ORDER BY created_at DESC LIMIT 100"), (project_id,)).fetchall()]
        for row in rows:
            row["structured_plan"] = json.loads(row["structured_plan"])
            row["confirmation_required"] = bool(row["confirmation_required"])
        return rows

    def create_operation(self, project_id: str, session_id: str | None, plan: dict[str, Any]) -> dict[str, Any]:
        operation_id, now = new_id("operation"), utc_now()
        requested = list(plan.get("affectedPageIds", []))
        required = bool(plan.get("requiresConfirmation"))
        status = "planned" if required else "confirmed"
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO operations(operation_id,project_id,session_id,target_scope,requested_page_ids,resolved_page_ids,structured_plan,confirmation_required,confirmed_at,result_version_ids,status,error_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), (operation_id, project_id, session_id, plan["targetScope"], json.dumps(requested), json.dumps(requested), json.dumps(plan), int(required), None if required else now, json.dumps([]), status, json.dumps({}), now, now))
        return {"operation_id": operation_id, "status": status, "confirmation_required": required, "requested_page_ids": requested, "resolved_page_ids": requested, "created_at": now}

    def update_operation_status(self, project_id: str, operation_id: str, status: str, *, result_version_ids: list[str] | None = None, confirmed: bool = False, error: dict[str, Any] | None = None) -> bool:
        now = utc_now()
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE operations SET status=?,result_version_ids=COALESCE(?,result_version_ids),confirmed_at=CASE WHEN ?=1 THEN ? ELSE confirmed_at END,error_json=?,updated_at=? WHERE project_id=? AND operation_id=?"), (status, json.dumps(result_version_ids) if result_version_ids is not None else None, int(confirmed), now, json.dumps(error or {}), now, project_id, operation_id))
        return cursor.rowcount == 1

    def get_operation(self, project_id: str, operation_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM operations WHERE project_id=? AND operation_id=?"), (project_id, operation_id)).fetchone())
        if row:
            for key in ("requested_page_ids", "resolved_page_ids", "result_version_ids", "structured_plan"):
                row[key] = json.loads(row[key])
            row["error"] = json.loads(row.pop("error_json") or "{}")
            row["confirmation_required"] = bool(row["confirmation_required"])
        return row

    def list_operations(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM operations WHERE project_id=? ORDER BY created_at DESC LIMIT 100"), (project_id,)).fetchall()]
        result = []
        for row in rows:
            for key in ("requested_page_ids", "resolved_page_ids", "result_version_ids", "structured_plan"):
                row[key] = json.loads(row[key])
            row["error"] = json.loads(row.pop("error_json") or "{}")
            row["confirmation_required"] = bool(row["confirmation_required"])
            result.append(row)
        return result

    def create_export(self, project_id: str, version_lock: list[dict[str, str]]) -> dict[str, Any]:
        export_id, now = new_id("export"), utc_now()
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO export_jobs(export_id,project_id,version_lock,artifact_id,status,qa_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"), (export_id, project_id, json.dumps(version_lock), None, "queued", json.dumps({}), now, now))
        return {"export_id": export_id, "project_id": project_id, "version_lock": version_lock, "status": "queued", "created_at": now, "updated_at": now}

    def complete_export(self, project_id: str, export_id: str, artifact_id: str | None, status: str, qa: dict[str, Any]) -> bool:
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE export_jobs SET artifact_id=?,status=?,qa_json=?,updated_at=? WHERE project_id=? AND export_id=?"), (artifact_id, status, json.dumps(qa), utc_now(), project_id, export_id))
        return cursor.rowcount == 1

    def get_export(self, project_id: str, export_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM export_jobs WHERE project_id=? AND export_id=?"), (project_id, export_id)).fetchone())
        if row:
            row["version_lock"] = json.loads(row["version_lock"])
            row["qa"] = json.loads(row.pop("qa_json") or "{}")
        return row

    def list_exports(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            export_ids = [row["export_id"] for row in connection.execute(self._sql("SELECT export_id FROM export_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100"), (project_id,)).fetchall()]
        return [item for export_id in export_ids if (item := self.get_export(project_id, export_id))]

    def archive_pages_for_operation(self, project_id: str, operation_id: str) -> int:
        with self.transaction() as connection:
            cursor = connection.execute(
                self._sql("UPDATE pages SET archived=1 WHERE project_id=? AND current_version_id IN (SELECT version_id FROM page_versions WHERE operation_id=?)"),
                (project_id, operation_id),
            )
        return cursor.rowcount

    def reserve_usage(self, project_id: str, operation_id: str | None, request_id: str, provider: str, model: str, price_snapshot: dict[str, Any], reserved: dict[str, Any]) -> dict[str, Any]:
        existing = self.usage_by_request(request_id)
        if existing:
            return existing
        ledger_id, now = new_id("usage"), utc_now()
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO usage_ledger(ledger_id,project_id,operation_id,request_id,provider,model,price_snapshot,reserved,settled,retry_count,submission_status,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), (ledger_id, project_id, operation_id, request_id, provider, model, json.dumps(price_snapshot), json.dumps(reserved), None, 0, "reserved", None, now, now))
        return self.usage_by_request(request_id) or {}

    def usage_by_request(self, request_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM usage_ledger WHERE request_id=?"), (request_id,)).fetchone())
        if row:
            for key in ("price_snapshot", "reserved", "settled"):
                row[key] = json.loads(row[key]) if row[key] else None
        return row

    def update_usage(self, request_id: str, status: str, *, settled: dict[str, Any] | None = None, error: str | None = None, increment_retry: bool = False, operation_id: str | None = None) -> dict[str, Any] | None:
        allowed = {"reserved", "submitted", "settled", "released", "submission_unknown", "failed"}
        if status not in allowed:
            raise ValueError("Invalid usage ledger status")
        transitions = {
            "reserved": {"reserved", "submitted", "released", "failed"},
            "submitted": {"submitted", "settled", "released", "submission_unknown", "failed"},
            "submission_unknown": {"submission_unknown", "settled", "released", "failed"},
            "failed": {"failed", "submitted", "released"},
            "settled": {"settled", "released"},
            "released": {"released"},
        }
        with self.transaction() as connection:
            current = connection.execute(self._sql("SELECT submission_status FROM usage_ledger WHERE request_id=?"), (request_id,)).fetchone()
            if not current:
                return None
            current_status = current["submission_status"]
            if status not in transitions.get(current_status, set()):
                raise ValueError(f"Invalid usage ledger transition: {current_status} -> {status}")
            if increment_retry and not (current_status == "failed" and status == "submitted"):
                raise ValueError("Usage retry is only valid after a known failed submission")
            cursor = connection.execute(self._sql("UPDATE usage_ledger SET submission_status=?,settled=COALESCE(?,settled),last_error=?,retry_count=retry_count+?,operation_id=COALESCE(?,operation_id),updated_at=? WHERE request_id=?"), (status, json.dumps(settled) if settled is not None else None, error, int(increment_retry), operation_id, utc_now(), request_id))
        return self.usage_by_request(request_id) if cursor.rowcount == 1 else None

    def retry_usage(self, request_id: str) -> dict[str, Any] | None:
        return self.update_usage(request_id, "submitted", increment_retry=True)

    def list_usage(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            request_ids = [row["request_id"] for row in connection.execute(self._sql("SELECT request_id FROM usage_ledger WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]
        return [item for request_id in request_ids if (item := self.usage_by_request(request_id))]

    def enqueue_job(self, project_id: str, kind: str, payload: dict[str, Any], idempotency_key: str, max_attempts: int = 3) -> dict[str, Any]:
        job_id, now = new_id("job"), utc_now()
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM jobs WHERE idempotency_key=?"), (idempotency_key,)).fetchone()
            if existing:
                return dict(existing)
            connection.execute(self._sql("INSERT INTO jobs(job_id,project_id,kind,payload,status,idempotency_key,attempts,max_attempts,lease_owner,lease_expires_at,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"), (job_id, project_id, kind, json.dumps(payload), "queued", idempotency_key, 0, max_attempts, None, None, None, now, now))
        return {"job_id": job_id, "project_id": project_id, "kind": kind, "payload": payload, "status": "queued", "attempts": 0, "max_attempts": max_attempts}

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM jobs WHERE job_id=?"), (job_id,)).fetchone())
        if row:
            row["payload"] = json.loads(row["payload"])
        return row

    def list_jobs(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100"), (project_id,)).fetchall()]
        for row in rows:
            row["payload"] = json.loads(row["payload"])
        return rows

    def retry_job(self, project_id: str, job_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            row = connection.execute(self._sql("SELECT * FROM jobs WHERE project_id=? AND job_id=?"), (project_id, job_id)).fetchone()
            if not row:
                return None
            if row["status"] not in {"failed", "cancelled"}:
                raise ValueError("Only failed or cancelled jobs can be retried")
            connection.execute(self._sql("UPDATE jobs SET status='queued',attempts=0,error=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE project_id=? AND job_id=?"), (utc_now(), project_id, job_id))
        return self.get_job(job_id)

    def claim_job(self, worker_id: str, lease_seconds: int = 60, *, kinds: tuple[str, ...] | None = None) -> dict[str, Any] | None:
        now_dt = datetime.now(UTC)
        now, expires = now_dt.isoformat(), (now_dt + timedelta(seconds=lease_seconds)).isoformat()
        with self.transaction() as connection:
            suffix = " FOR UPDATE SKIP LOCKED" if self.placeholder != "?" else ""
            statement = "SELECT * FROM jobs WHERE (status='queued' OR (status='running' AND lease_expires_at<?)) AND attempts<max_attempts"
            values: list[Any] = [now]
            if kinds:
                statement += " AND kind IN (" + ",".join("?" for _ in kinds) + ")"
                values.extend(kinds)
            statement += " ORDER BY created_at LIMIT 1" + suffix
            row = connection.execute(self._sql(statement), tuple(values)).fetchone()
            if not row:
                return None
            job = dict(row)
            connection.execute(self._sql("UPDATE jobs SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE job_id=?"), (worker_id, expires, now, job["job_id"]))
        job["payload"] = json.loads(job["payload"])
        job["status"] = "running"
        job["attempts"] += 1
        return job

    def complete_job(self, job_id: str, worker_id: str, *, error: str | None = None) -> bool:
        with self.transaction() as connection:
            current = connection.execute(self._sql("SELECT attempts,max_attempts FROM jobs WHERE job_id=? AND lease_owner=?"), (job_id, worker_id)).fetchone()
            if not current:
                return False
            status = "queued" if error and current["attempts"] < current["max_attempts"] else ("failed" if error else "completed")
            cursor = connection.execute(self._sql("UPDATE jobs SET status=?,error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND lease_owner=?"), (status, error, utc_now(), job_id, worker_id))
        return cursor.rowcount == 1

    def heartbeat_worker(self, worker_id: str, worker_kind: str, status: str = "ready", detail: dict[str, Any] | None = None) -> None:
        now = utc_now()
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT 1 FROM workers WHERE worker_id=?"), (worker_id,)).fetchone()
            if existing:
                connection.execute(self._sql("UPDATE workers SET worker_kind=?,status=?,detail=?,last_heartbeat=? WHERE worker_id=?"), (worker_kind, status, json.dumps(detail or {}), now, worker_id))
            else:
                connection.execute(self._sql("INSERT INTO workers(worker_id,worker_kind,status,detail,last_heartbeat) VALUES(?,?,?,?,?)"), (worker_id, worker_kind, status, json.dumps(detail or {}), now))

    def worker_health(self, worker_kind: str, stale_seconds: int = 30) -> dict[str, Any]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM workers WHERE worker_kind=? ORDER BY last_heartbeat DESC"), (worker_kind,)).fetchall()]
        cutoff = datetime.now(UTC) - timedelta(seconds=stale_seconds)
        active = [row for row in rows if datetime.fromisoformat(row["last_heartbeat"]) >= cutoff]
        return {"status": "ready" if active else "unavailable", "active": len(active), "configured": len(rows)}

    def emit_event(self, event_type: str, *, project_id: str | None = None, session_id: str | None = None, operation_id: str | None = None, page_id: str | None = None, version_id: str | None = None, export_id: str | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        event_id, now = new_id("event"), utc_now()
        with self.transaction() as connection:
            statement = "INSERT INTO events(event_id,event_type,project_id,session_id,operation_id,page_id,version_id,export_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
            if self.placeholder != "?":
                statement += " RETURNING seq"
            cursor = connection.execute(self._sql(statement), (event_id, event_type, project_id, session_id, operation_id, page_id, version_id, export_id, json.dumps(payload or {}), now))
            seq = cursor.fetchone()["seq"] if self.placeholder != "?" else cursor.lastrowid
        return {"seq": seq, "event_id": event_id, "event_type": event_type, "project_id": project_id, "session_id": session_id, "operation_id": operation_id, "page_id": page_id, "version_id": version_id, "export_id": export_id, "payload": payload or {}, "created_at": now}

    def events_after(self, project_id: str, after_seq: int) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM events WHERE project_id=? AND seq>? ORDER BY seq LIMIT 500"), (project_id, after_seq)).fetchall()]
        for row in rows:
            row["payload"] = json.loads(row["payload"])
        return rows

    def audit(self, actor_id: str, action: str, *, project_id: str | None = None, entity_type: str | None = None, entity_id: str | None = None, detail: dict[str, Any] | None = None) -> None:
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO audit_log(audit_id,actor_id,action,project_id,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?)"), (secrets.token_hex(16), actor_id, action, project_id, entity_type, entity_id, json.dumps(detail or {}), utc_now()))

    def list_project_audit(self, project_id: str, *, limit: int = 5000) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(
                self._sql("SELECT * FROM audit_log WHERE project_id=? ORDER BY created_at,audit_id LIMIT ?"),
                (project_id, limit),
            ).fetchall()]
        for row in rows:
            row["detail"] = self._json_load(row.get("detail"), {})
        return rows

    # v1.1 immutable run and configuration records ---------------------
    @staticmethod
    def _json_load(value: Any, default: Any) -> Any:
        if value in (None, ""):
            return default
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return default

    def list_provider_profiles(self, *, include_archived: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM provider_profiles" + ("" if include_archived else " WHERE archived_at IS NULL") + " ORDER BY created_at"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(query)).fetchall()]
        for row in rows:
            for key in ("capability_settings", "connection_status_by_capability", "last_tested_at_by_capability"):
                row[key] = self._json_load(row.get(key), {})
            row["enabled"] = bool(row.get("enabled"))
        return rows

    def create_provider_profile(self, created_by: str, profile: dict[str, Any]) -> dict[str, Any]:
        profile_id, now = profile.get("profile_id") or new_id("profile"), utc_now()
        status = profile.get("connection_status_by_capability") or {"agent": "untested", "image_generation": "untested", "image_edit": "untested"}
        tested = profile.get("last_tested_at_by_capability") or {key: None for key in status}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM provider_profiles WHERE profile_id=?"), (profile_id,)).fetchone()
            if existing:
                return self.get_provider_profile(profile_id) or {}
            connection.execute(self._sql("INSERT INTO provider_profiles(profile_id,display_name,endpoint_mode,base_url,secret_reference,capability_settings,enabled,archived_at,connection_status_by_capability,last_tested_at_by_capability,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"), (profile_id, profile["display_name"], profile["endpoint_mode"], profile.get("base_url"), profile["secret_reference"], json.dumps(profile.get("capability_settings") or {}), int(profile.get("enabled", True)), profile.get("archived_at"), json.dumps(status), json.dumps(tested), created_by, now, now))
        return self.get_provider_profile(profile_id) or {}

    def get_provider_profile(self, profile_id: str, *, include_archived: bool = True) -> dict[str, Any] | None:
        query = "SELECT * FROM provider_profiles WHERE profile_id=?" + ("" if include_archived else " AND archived_at IS NULL")
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(query), (profile_id,)).fetchone())
        if row:
            for key in ("capability_settings", "connection_status_by_capability", "last_tested_at_by_capability"):
                row[key] = self._json_load(row.get(key), {})
            row["enabled"] = bool(row.get("enabled"))
        return row

    def update_provider_profile(self, profile_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_provider_profile(profile_id)
        if not current:
            return None
        allowed = {"display_name", "endpoint_mode", "base_url", "secret_reference", "capability_settings", "enabled", "archived_at", "connection_status_by_capability", "last_tested_at_by_capability"}
        updates = {key: value for key, value in values.items() if key in allowed}
        if not updates:
            return current
        encoded = {key: json.dumps(value) if key in {"capability_settings", "connection_status_by_capability", "last_tested_at_by_capability"} else (int(value) if key == "enabled" else value) for key, value in updates.items()}
        assignments = ",".join(f"{key}=?" for key in encoded) + ",updated_at=?"
        with self.transaction() as connection:
            connection.execute(self._sql(f"UPDATE provider_profiles SET {assignments} WHERE profile_id=?"), tuple(encoded.values()) + (utc_now(), profile_id))
        return self.get_provider_profile(profile_id)

    def archive_provider_profile(self, profile_id: str) -> dict[str, Any] | None:
        return self.update_provider_profile(profile_id, {"enabled": False, "archived_at": utc_now()})

    def update_provider_capability_test(self, profile_id: str, capability: str, status: str) -> dict[str, Any] | None:
        profile = self.get_provider_profile(profile_id)
        if not profile:
            return None
        statuses = dict(profile.get("connection_status_by_capability") or {})
        tested = dict(profile.get("last_tested_at_by_capability") or {})
        statuses[capability], tested[capability] = status, utc_now()
        return self.update_provider_profile(profile_id, {"connection_status_by_capability": statuses, "last_tested_at_by_capability": tested})

    def get_model_policy(self, project_id: str) -> dict[str, Any]:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM project_model_policies WHERE project_id=?"), (project_id,)).fetchone())
        return row or {"project_id": project_id, "agent_profile_id": None, "agent_model": None, "image_generation_profile_id": None, "image_generation_model": None, "image_edit_profile_id": None, "image_edit_model": None, "updated_by": None, "updated_at": None}

    def upsert_model_policy(self, project_id: str, updated_by: str, policy: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        values = (project_id, policy.get("agent_profile_id"), policy.get("agent_model"), policy.get("image_generation_profile_id"), policy.get("image_generation_model"), policy.get("image_edit_profile_id"), policy.get("image_edit_model"), updated_by, now)
        with self.transaction() as connection:
            if self.placeholder == "?":
                statement = "INSERT INTO project_model_policies(project_id,agent_profile_id,agent_model,image_generation_profile_id,image_generation_model,image_edit_profile_id,image_edit_model,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET agent_profile_id=excluded.agent_profile_id,agent_model=excluded.agent_model,image_generation_profile_id=excluded.image_generation_profile_id,image_generation_model=excluded.image_generation_model,image_edit_profile_id=excluded.image_edit_profile_id,image_edit_model=excluded.image_edit_model,updated_by=excluded.updated_by,updated_at=excluded.updated_at"
            else:
                statement = "INSERT INTO project_model_policies(project_id,agent_profile_id,agent_model,image_generation_profile_id,image_generation_model,image_edit_profile_id,image_edit_model,updated_by,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(project_id) DO UPDATE SET agent_profile_id=EXCLUDED.agent_profile_id,agent_model=EXCLUDED.agent_model,image_generation_profile_id=EXCLUDED.image_generation_profile_id,image_generation_model=EXCLUDED.image_generation_model,image_edit_profile_id=EXCLUDED.image_edit_profile_id,image_edit_model=EXCLUDED.image_edit_model,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at"
            connection.execute(statement, values)
        return self.get_model_policy(project_id)

    def create_source_text(self, project_id: str, artifact_id: str, text_content: str, sha256: str, created_by: str) -> dict[str, Any]:
        source_text_id, now = new_id("source_text"), utc_now()
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO source_texts(source_text_id,project_id,artifact_id,text_content,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?)"), (source_text_id, project_id, artifact_id, text_content, sha256, created_by, now))
        return {"source_text_id": source_text_id, "project_id": project_id, "artifact_id": artifact_id, "text": text_content, "sha256": sha256, "created_by": created_by, "created_at": now}

    def list_source_texts(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT source_text_id,project_id,artifact_id,text_content,sha256,created_by,created_at FROM source_texts WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]
        for row in rows:
            row["text"] = row.pop("text_content")
        return rows

    def get_source_text(self, project_id: str, source_text_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT source_text_id,project_id,artifact_id,text_content,sha256,created_by,created_at FROM source_texts WHERE project_id=? AND source_text_id=?"), (project_id, source_text_id)).fetchone())
        if row:
            row["text"] = row.pop("text_content")
        return row

    def create_pptx_import_manifest(self, project_id: str, document_id: str, values: dict[str, Any]) -> dict[str, Any]:
        manifest_id, now = values.get("manifest_id") or new_id("pptx_manifest"), utc_now()
        row = {"manifest_id": manifest_id, "project_id": project_id, "document_id": document_id, "source_artifact_id": values["source_artifact_id"], "source_sha256": values["source_sha256"], "page_size": values["page_size"], "pages": values.get("pages") or [], "aggregate_sha256": values["aggregate_sha256"], "created_at": now}
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO pptx_import_manifests(manifest_id,project_id,document_id,source_artifact_id,source_sha256,page_size,pages_json,aggregate_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)"), (manifest_id, project_id, document_id, row["source_artifact_id"], row["source_sha256"], json.dumps(row["page_size"]), json.dumps(row["pages"]), row["aggregate_sha256"], now))
        return row

    def get_pptx_import_manifest(self, project_id: str, document_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM pptx_import_manifests WHERE project_id=? AND document_id=?"), (project_id, document_id)).fetchone())
        if row:
            row["page_size"] = self._json_load(row.pop("page_size"), {})
            row["pages"] = self._json_load(row.pop("pages_json"), [])
        return row

    def create_prompt_envelope(
        self,
        project_id: str,
        agent_run_id: str,
        prompt_artifact_id: str,
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        created_at = str(envelope.get("created_at") or utc_now())
        try:
            expires_at = (datetime.fromisoformat(created_at) + timedelta(days=30)).isoformat()
        except ValueError:
            expires_at = (datetime.now(UTC) + timedelta(days=30)).isoformat()
        row = {
            "envelope_id": str(envelope["envelope_id"]),
            "project_id": project_id,
            "agent_run_id": agent_run_id,
            "prompt_artifact_id": prompt_artifact_id,
            "prompt_id": str(envelope["prompt_id"]),
            "prompt_version": str(envelope["prompt_version"]),
            "input_contract_version": str(envelope["input_contract_version"]),
            "output_schema_version": str(envelope["output_schema_version"]),
            "input_context_digest": str(envelope["input_context_digest"]),
            "prompt_digest": str(envelope["prompt_digest"]),
            "provider_snapshot": dict(envelope.get("provider_snapshot") or {}),
            "expires_at": expires_at,
            "content_deleted_at": None,
            "created_at": created_at,
        }
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO prompt_envelopes(envelope_id,project_id,agent_run_id,prompt_artifact_id,prompt_id,prompt_version,input_contract_version,output_schema_version,input_context_digest,prompt_digest,provider_snapshot,expires_at,content_deleted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),
                (
                    row["envelope_id"], project_id, agent_run_id, prompt_artifact_id, row["prompt_id"],
                    row["prompt_version"], row["input_contract_version"], row["output_schema_version"],
                    row["input_context_digest"], row["prompt_digest"], json.dumps(row["provider_snapshot"]),
                    expires_at, None, created_at,
                ),
            )
        return row

    def create_context_manifest(self, project_id: str, agent_run_id: str, artifact_id: str, input_context_digest: str) -> dict[str, Any]:
        row = {
            "context_manifest_id": new_id("context_manifest"),
            "project_id": project_id,
            "agent_run_id": agent_run_id,
            "artifact_id": artifact_id,
            "input_context_digest": input_context_digest,
            "created_at": utc_now(),
        }
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO context_manifests(context_manifest_id,project_id,agent_run_id,artifact_id,input_context_digest,created_at) VALUES(?,?,?,?,?,?)"),
                tuple(row.values()),
            )
        return row

    def create_truncation_report(self, project_id: str, agent_run_id: str, artifact_id: str, report: dict[str, Any]) -> dict[str, Any]:
        row = {
            "truncation_report_id": new_id("truncation_report"),
            "project_id": project_id,
            "agent_run_id": agent_run_id,
            "artifact_id": artifact_id,
            "long_context": bool(report.get("long_context")),
            "original_estimated_tokens": int(report.get("original_estimated_tokens") or 0),
            "retained_estimated_tokens": int(report.get("retained_estimated_tokens") or 0),
            "created_at": utc_now(),
        }
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO truncation_reports(truncation_report_id,project_id,agent_run_id,artifact_id,long_context,original_estimated_tokens,retained_estimated_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)"),
                (
                    row["truncation_report_id"], project_id, agent_run_id, artifact_id,
                    int(row["long_context"]), row["original_estimated_tokens"], row["retained_estimated_tokens"], row["created_at"],
                ),
            )
        return row

    def get_prompt_envelope(self, project_id: str, agent_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM prompt_envelopes WHERE project_id=? AND agent_run_id=? ORDER BY created_at DESC LIMIT 1"), (project_id, agent_run_id)).fetchone())
        if row:
            row["provider_snapshot"] = self._json_load(row.get("provider_snapshot"), {})
        return row

    def expired_prompt_envelopes(self, now: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM prompt_envelopes WHERE content_deleted_at IS NULL AND expires_at<=? ORDER BY expires_at LIMIT ?"), (now or utc_now(), limit)).fetchall()]
        for row in rows:
            row["provider_snapshot"] = self._json_load(row.get("provider_snapshot"), {})
        return rows

    def list_prompt_envelopes(self, project_id: str, *, active_only: bool = False) -> list[dict[str, Any]]:
        scope = " AND content_deleted_at IS NULL AND expires_at>?" if active_only else ""
        params: tuple[Any, ...] = (project_id, utc_now()) if active_only else (project_id,)
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(
                self._sql("SELECT * FROM prompt_envelopes WHERE project_id=?" + scope + " ORDER BY created_at,envelope_id"),
                params,
            ).fetchall()]
        for row in rows:
            row["provider_snapshot"] = self._json_load(row.get("provider_snapshot"), {})
        return rows

    def mark_prompt_envelope_deleted(self, envelope_id: str) -> None:
        with self.transaction() as connection:
            connection.execute(self._sql("UPDATE prompt_envelopes SET content_deleted_at=? WHERE envelope_id=? AND content_deleted_at IS NULL"), (utc_now(), envelope_id))

    def get_context_manifest(self, project_id: str, agent_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM context_manifests WHERE project_id=? AND agent_run_id=? ORDER BY created_at DESC LIMIT 1"), (project_id, agent_run_id)).fetchone())

    def get_truncation_report(self, project_id: str, agent_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM truncation_reports WHERE project_id=? AND agent_run_id=? ORDER BY created_at DESC LIMIT 1"), (project_id, agent_run_id)).fetchone())

    def create_logic_analysis(self, project_id: str, session_id: str | None, plan_id: str | None, agent_run_id: str, artifact_id: str) -> dict[str, Any]:
        row = {
            "logic_analysis_id": new_id("logic_analysis"),
            "project_id": project_id,
            "session_id": session_id,
            "plan_id": plan_id,
            "agent_run_id": agent_run_id,
            "artifact_id": artifact_id,
            "created_at": utc_now(),
        }
        with self.transaction() as connection:
            connection.execute(
                self._sql("INSERT INTO logic_analysis_artifacts(logic_analysis_id,project_id,session_id,plan_id,agent_run_id,artifact_id,created_at) VALUES(?,?,?,?,?,?,?)"),
                tuple(row.values()),
            )
        return row

    def register_design_bundle(self, owner_id: str, bundle: dict[str, Any], members: list[dict[str, Any]], storage_paths: dict[tuple[str, str], str]) -> list[dict[str, Any]]:
        now = utc_now()
        rows: list[dict[str, Any]] = []
        with self.transaction() as connection:
            for item in members:
                manifest = dict(item["manifest"])
                pack_id, version = manifest["pack_id"], manifest["version"]
                existing = connection.execute(self._sql("SELECT owner_id FROM design_packs WHERE pack_id=?"), (pack_id,)).fetchone()
                if existing and existing["owner_id"] != owner_id:
                    raise ValueError("pack_id is already owned by another user")
                if existing:
                    connection.execute(
                        self._sql("UPDATE design_packs SET display_name=?,description=?,status=?,current_version=?,updated_at=? WHERE pack_id=? AND owner_id=?"),
                        (manifest["display_name"], str(manifest.get("description") or ""), manifest["status"], version, now, pack_id, owner_id),
                    )
                else:
                    connection.execute(
                        self._sql("INSERT INTO design_packs(pack_id,pack_kind,scope,owner_id,display_name,description,status,current_version,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"),
                        (pack_id, manifest["pack_kind"], "private", owner_id, manifest["display_name"], str(manifest.get("description") or ""), manifest["status"], version, "private_import", now, now),
                    )
                connection.execute(
                    self._sql("INSERT INTO design_pack_versions(pack_id,version,bundle_id,content_hash,manifest_json,storage_path,validation_json,created_at) VALUES(?,?,?,?,?,?,?,?)"),
                    (pack_id, version, bundle["bundle_id"], manifest["content_hash"], json.dumps(manifest, ensure_ascii=False), storage_paths[(pack_id, version)], json.dumps({"status": "valid", "resource_hashes": item.get("resource_hashes") or {}}, ensure_ascii=False), now),
                )
                connection.execute(
                    self._sql("INSERT INTO design_pack_membership(bundle_id,pack_id,version,dependency_ids) VALUES(?,?,?,?)"),
                    (bundle["bundle_id"], pack_id, version, json.dumps(item.get("dependencies") or [])),
                )
                rows.append({**manifest, "bundle_id": bundle["bundle_id"], "storage_path": storage_paths[(pack_id, version)], "created_at": now})
        return rows

    @staticmethod
    def _decode_design_pack(row: dict[str, Any]) -> dict[str, Any]:
        row["manifest"] = MetadataStore._json_load(row.pop("manifest_json", None), {})
        row["validation"] = MetadataStore._json_load(row.pop("validation_json", None), {})
        return row

    def list_design_packs(self, viewer_id: str, *, include_all_private: bool = False, pack_kind: str | None = None) -> list[dict[str, Any]]:
        scope = "1=1" if include_all_private else "(p.scope='system' OR p.owner_id=?)"
        params: list[Any] = [] if include_all_private else [viewer_id]
        if pack_kind:
            scope += " AND p.pack_kind=?"
            params.append(pack_kind)
        query = f"SELECT p.*,v.content_hash,v.bundle_id,v.manifest_json,v.storage_path,v.validation_json,v.created_at AS version_created_at FROM design_packs p JOIN design_pack_versions v ON v.pack_id=p.pack_id AND v.version=p.current_version WHERE {scope} ORDER BY p.display_name,p.pack_id"
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql(query), tuple(params)).fetchall()]
        return [self._decode_design_pack(row) for row in rows]

    def get_design_pack(self, viewer_id: str, pack_id: str, *, include_all_private: bool = False) -> dict[str, Any] | None:
        scope = "" if include_all_private else " AND (p.scope='system' OR p.owner_id=?)"
        params: tuple[Any, ...] = (pack_id,) if include_all_private else (pack_id, viewer_id)
        query = "SELECT p.*,v.content_hash,v.bundle_id,v.manifest_json,v.storage_path,v.validation_json,v.created_at AS version_created_at FROM design_packs p JOIN design_pack_versions v ON v.pack_id=p.pack_id AND v.version=p.current_version WHERE p.pack_id=?" + scope
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(query), params).fetchone())
        return self._decode_design_pack(row) if row else None

    def get_design_pack_version(self, viewer_id: str, pack_id: str, version: str, *, include_all_private: bool = False) -> dict[str, Any] | None:
        scope = "" if include_all_private else " AND (p.scope='system' OR p.owner_id=?)"
        params: tuple[Any, ...] = (pack_id, version) if include_all_private else (pack_id, version, viewer_id)
        query = "SELECT p.*,v.version,v.content_hash,v.bundle_id,v.manifest_json,v.storage_path,v.validation_json,v.created_at AS version_created_at FROM design_packs p JOIN design_pack_versions v ON v.pack_id=p.pack_id WHERE p.pack_id=? AND v.version=?" + scope
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(query), params).fetchone())
        return self._decode_design_pack(row) if row else None

    def get_design_pack_membership(self, pack_id: str, version: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(
                self._sql("SELECT * FROM design_pack_membership WHERE pack_id=? AND version=?"),
                (pack_id, version),
            ).fetchone())
        if row:
            row["dependency_ids"] = self._json_load(row.get("dependency_ids"), [])
        return row

    def get_bundle_design_pack(self, viewer_id: str, bundle_id: str, pack_id: str) -> dict[str, Any] | None:
        query = "SELECT p.*,v.version,v.content_hash,v.bundle_id,v.manifest_json,v.storage_path,v.validation_json,v.created_at AS version_created_at FROM design_pack_membership m JOIN design_pack_versions v ON v.pack_id=m.pack_id AND v.version=m.version JOIN design_packs p ON p.pack_id=v.pack_id WHERE m.bundle_id=? AND m.pack_id=? AND (p.scope='system' OR p.owner_id=?)"
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(query), (bundle_id, pack_id, viewer_id)).fetchone())
        return self._decode_design_pack(row) if row else None

    def archive_design_pack(self, owner_id: str, pack_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE design_packs SET status='archived',updated_at=? WHERE pack_id=? AND owner_id=? AND scope='private'"), (utc_now(), pack_id, owner_id))
        return self.get_design_pack(owner_id, pack_id) if cursor.rowcount else None

    def create_design_selection(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        row = {
            "design_selection_id": new_id("design_selection"),
            "project_id": project_id,
            "session_id": values.get("session_id"),
            "plan_id": values.get("plan_id"),
            "page_id": values.get("page_id"),
            "style_pack_id": values.get("style_pack_id"),
            "style_version": values.get("style_version"),
            "style_content_hash": values.get("style_content_hash"),
            "template_pack_id": values.get("template_pack_id"),
            "template_version": values.get("template_version"),
            "template_content_hash": values.get("template_content_hash"),
            "selection_scope": values.get("selection_scope") or "session",
            "selected_by": values["selected_by"],
            "selection_source": values.get("selection_source") or "none",
            "status": values.get("status") or "draft",
            "snapshot": values.get("snapshot") or {},
            "created_at": now,
            "used_at": values.get("used_at"),
        }
        with self.transaction() as connection:
            if row["session_id"]:
                connection.execute(self._sql("UPDATE design_selections SET status='superseded' WHERE project_id=? AND session_id=? AND status='draft'"), (project_id, row["session_id"]))
            connection.execute(
                self._sql("INSERT INTO design_selections(design_selection_id,project_id,session_id,plan_id,page_id,style_pack_id,style_version,style_content_hash,template_pack_id,template_version,template_content_hash,selection_scope,selected_by,selection_source,status,snapshot_json,created_at,used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),
                (row["design_selection_id"], project_id, row["session_id"], row["plan_id"], row["page_id"], row["style_pack_id"], row["style_version"], row["style_content_hash"], row["template_pack_id"], row["template_version"], row["template_content_hash"], row["selection_scope"], row["selected_by"], row["selection_source"], row["status"], json.dumps(row["snapshot"], ensure_ascii=False), now, row["used_at"]),
            )
        return row

    @staticmethod
    def _decode_design_selection(row: dict[str, Any]) -> dict[str, Any]:
        row["snapshot"] = MetadataStore._json_load(row.pop("snapshot_json", None), {})
        return row

    def get_design_selection(self, project_id: str, design_selection_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM design_selections WHERE project_id=? AND design_selection_id=?"), (project_id, design_selection_id)).fetchone())
        return self._decode_design_selection(row) if row else None

    def get_session_design_selection(self, project_id: str, session_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM design_selections WHERE project_id=? AND session_id=? AND status IN ('draft','used','mixed') ORDER BY created_at DESC LIMIT 1"), (project_id, session_id)).fetchone())
        return self._decode_design_selection(row) if row else None

    def use_design_selection(self, project_id: str, design_selection_id: str, plan_id: str, snapshot: dict[str, Any]) -> dict[str, Any] | None:
        now = utc_now()
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE design_selections SET plan_id=?,status='used',snapshot_json=?,used_at=? WHERE project_id=? AND design_selection_id=? AND status='draft'"), (plan_id, json.dumps(snapshot, ensure_ascii=False), now, project_id, design_selection_id))
        return self.get_design_selection(project_id, design_selection_id) if cursor.rowcount else None

    def create_agent_run(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        run_id, now = values.get("agent_run_id") or new_id("agent_run"), utc_now()
        row = {
            "agent_run_id": run_id,
            "project_id": project_id,
            "session_id": values.get("session_id"),
            "parent_run_id": values.get("parent_run_id"),
            "role": values["role"],
            "profile_id": values.get("profile_id") or "profile_unconfigured",
            "model": values.get("model") or "unknown",
            "input_artifact_ids": values.get("input_artifact_ids") or [],
            "output_artifact_ids": values.get("output_artifact_ids") or [],
            # Retained for legacy reads only. New calls use the three explicit digests below.
            "context_digest": values.get("context_digest") or values.get("input_context_digest") or "",
            "prompt_artifact_id": values.get("prompt_artifact_id"),
            "prompt_id": values.get("prompt_id") or "",
            "prompt_version": values.get("prompt_version") or "legacy",
            "input_contract_version": values.get("input_contract_version") or "legacy",
            "output_schema_version": values.get("output_schema_version") or "legacy",
            "input_context_digest": values.get("input_context_digest") or "",
            "prompt_digest": values.get("prompt_digest") or "",
            "output_digest": values.get("output_digest") or "",
            "context_manifest_artifact_id": values.get("context_manifest_artifact_id"),
            "truncation_report_artifact_id": values.get("truncation_report_artifact_id"),
            "parent_output_artifact_ids": values.get("parent_output_artifact_ids") or [],
            "design_selection_id": values.get("design_selection_id"),
            "status": values.get("status", "queued"),
            "usage_request_id": values.get("usage_request_id") or new_id("request"),
            "retry_of_run_id": values.get("retry_of_run_id"),
            "idempotency_key": values.get("idempotency_key") or f"agent:{run_id}",
            "provider_request_id": values.get("provider_request_id"),
            "provider_snapshot": values.get("provider_snapshot") or {},
            "error": values.get("error") or {},
            "created_at": now,
            "updated_at": now,
        }
        if row["status"] not in AGENT_RUN_TRANSITIONS:
            raise ValueError("Invalid AgentRun status")
        with self.transaction() as connection:
            existing = connection.execute(
                self._sql("SELECT * FROM agent_runs WHERE project_id=? AND idempotency_key=?"),
                (project_id, row["idempotency_key"]),
            ).fetchone()
            if existing:
                return self._decode_agent_run(dict(existing))
            connection.execute(
                self._sql("INSERT INTO agent_runs(agent_run_id,project_id,session_id,parent_run_id,role,profile_id,model,input_artifact_ids,output_artifact_ids,context_digest,status,usage_request_id,retry_of_run_id,idempotency_key,provider_request_id,provider_snapshot,error_json,prompt_artifact_id,prompt_id,prompt_version,input_contract_version,output_schema_version,input_context_digest,prompt_digest,output_digest,context_manifest_artifact_id,truncation_report_artifact_id,parent_output_artifact_ids,design_selection_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),
                (
                    row["agent_run_id"], project_id, row["session_id"], row["parent_run_id"], row["role"],
                    row["profile_id"], row["model"], json.dumps(row["input_artifact_ids"]), json.dumps(row["output_artifact_ids"]),
                    row["context_digest"], row["status"], row["usage_request_id"], row["retry_of_run_id"], row["idempotency_key"],
                    row["provider_request_id"], json.dumps(row["provider_snapshot"]), json.dumps(row["error"]),
                    row["prompt_artifact_id"], row["prompt_id"], row["prompt_version"], row["input_contract_version"],
                    row["output_schema_version"], row["input_context_digest"], row["prompt_digest"], row["output_digest"],
                    row["context_manifest_artifact_id"], row["truncation_report_artifact_id"], json.dumps(row["parent_output_artifact_ids"]),
                    row["design_selection_id"], now, now,
                ),
            )
        return row

    def _decode_agent_run(self, row: dict[str, Any]) -> dict[str, Any]:
        for key in ("input_artifact_ids", "output_artifact_ids", "parent_output_artifact_ids", "provider_snapshot", "error_json"):
            value = self._json_load(row.get(key), {} if key in {"provider_snapshot", "error_json"} else [])
            row["error" if key == "error_json" else key] = value
        row.pop("error_json", None)
        return row

    def get_agent_run(self, project_id: str, agent_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM agent_runs WHERE project_id=? AND agent_run_id=?"), (project_id, agent_run_id)).fetchone())
        return self._decode_agent_run(row) if row else None

    def get_agent_run_by_idempotency(self, project_id: str, idempotency_key: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(
                self._sql("SELECT * FROM agent_runs WHERE project_id=? AND idempotency_key=?"),
                (project_id, idempotency_key),
            ).fetchone())
        return self._decode_agent_run(row) if row else None

    def find_agent_run(self, agent_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM agent_runs WHERE agent_run_id=?"), (agent_run_id,)).fetchone())
        return self._decode_agent_run(row) if row else None

    def list_agent_runs(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM agent_runs WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]
        return [self._decode_agent_run(row) for row in rows]

    def update_agent_run(self, project_id: str, agent_run_id: str, *, status: str | None = None, output_artifact_ids: list[str] | None = None, provider_request_id: str | None = None, output_digest: str | None = None, error: dict[str, Any] | None = None) -> dict[str, Any] | None:
        fields: list[str] = []
        values: list[Any] = []
        if status is not None: fields.append("status=?"); values.append(status)
        if output_artifact_ids is not None: fields.append("output_artifact_ids=?"); values.append(json.dumps(output_artifact_ids))
        if provider_request_id is not None: fields.append("provider_request_id=?"); values.append(provider_request_id)
        if output_digest is not None: fields.append("output_digest=?"); values.append(output_digest)
        if error is not None: fields.append("error_json=?"); values.append(json.dumps(error))
        if not fields: return self.get_agent_run(project_id, agent_run_id)
        fields.append("updated_at=?"); values.extend([utc_now(), project_id, agent_run_id])
        with self.transaction() as connection:
            current = connection.execute(self._sql("SELECT status FROM agent_runs WHERE project_id=? AND agent_run_id=?"), (project_id, agent_run_id)).fetchone()
            if not current:
                return None
            if status is not None:
                validate_transition(str(current["status"]), status, AGENT_RUN_TRANSITIONS)
            connection.execute(self._sql(f"UPDATE agent_runs SET {','.join(fields)} WHERE project_id=? AND agent_run_id=?"), tuple(values))
        return self.get_agent_run(project_id, agent_run_id)

    def create_image_run(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        image_run_id, now = values.get("image_run_id") or new_id("image_run"), utc_now()
        row = {"image_run_id": image_run_id, "project_id": project_id, "page_id": values.get("page_id"), "purpose": values["purpose"], "prompt_artifact_id": values["prompt_artifact_id"], "input_artifact_ids": values.get("input_artifact_ids") or [], "input_hashes": values.get("input_hashes") or [], "status": values.get("status", "queued"), "selected_output_artifact_ids": values.get("selected_output_artifact_ids") or [], "decision": values.get("decision"), "created_at": now, "updated_at": now}
        if row["status"] not in IMAGE_RUN_TRANSITIONS:
            raise ValueError("Invalid ImageRun status")
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM image_runs WHERE image_run_id=? AND project_id=?"), (image_run_id, project_id)).fetchone()
            if existing:
                return self._decode_image_run(dict(existing))
            connection.execute(self._sql("INSERT INTO image_runs(image_run_id,project_id,page_id,purpose,prompt_artifact_id,input_artifact_ids,input_hashes,status,selected_output_artifact_ids,decision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"), (image_run_id, project_id, row["page_id"], row["purpose"], row["prompt_artifact_id"], json.dumps(row["input_artifact_ids"]), json.dumps(row["input_hashes"]), row["status"], json.dumps(row["selected_output_artifact_ids"]), row["decision"], now, now))
        return row

    @staticmethod
    def _decode_image_run(row: dict[str, Any]) -> dict[str, Any]:
        for key in ("input_artifact_ids", "input_hashes", "selected_output_artifact_ids"):
            row[key] = MetadataStore._json_load(row.get(key), [])
        return row

    def get_image_run(self, project_id: str, image_run_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM image_runs WHERE project_id=? AND image_run_id=?"), (project_id, image_run_id)).fetchone())
        return self._decode_image_run(row) if row else None

    def list_image_runs(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT * FROM image_runs WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]
        return [self._decode_image_run(row) for row in rows]

    def update_image_run(self, project_id: str, image_run_id: str, *, status: str | None = None, decision: str | None = None, selected_output_artifact_ids: list[str] | None = None) -> dict[str, Any] | None:
        fields, values = [], []
        if status is not None: fields.append("status=?"); values.append(status)
        if decision is not None: fields.append("decision=?"); values.append(decision)
        if selected_output_artifact_ids is not None: fields.append("selected_output_artifact_ids=?"); values.append(json.dumps(selected_output_artifact_ids))
        if not fields: return self.get_image_run(project_id, image_run_id)
        fields.append("updated_at=?"); values.extend([utc_now(), project_id, image_run_id])
        with self.transaction() as connection:
            current = connection.execute(self._sql("SELECT status FROM image_runs WHERE project_id=? AND image_run_id=?"), (project_id, image_run_id)).fetchone()
            if not current:
                return None
            if status is not None:
                validate_transition(str(current["status"]), status, IMAGE_RUN_TRANSITIONS)
            connection.execute(self._sql(f"UPDATE image_runs SET {','.join(fields)} WHERE project_id=? AND image_run_id=?"), tuple(values))
        return self.get_image_run(project_id, image_run_id)

    def create_image_attempt(self, image_run_id: str, values: dict[str, Any]) -> dict[str, Any]:
        attempt_id, now = values.get("image_attempt_id") or new_id("image_attempt"), utc_now()
        row = {"image_attempt_id": attempt_id, "image_run_id": image_run_id, "retry_of_attempt_id": values.get("retry_of_attempt_id"), "attempt_number": int(values.get("attempt_number", 1)), "profile_id": values.get("profile_id") or "profile_unconfigured", "provider_snapshot": values.get("provider_snapshot") or {}, "endpoint_mode": values.get("endpoint_mode", "official"), "model": values.get("model") or "gpt-image-2", "idempotency_key": values.get("idempotency_key") or f"image:{attempt_id}", "provider_request_id": values.get("provider_request_id"), "usage_request_id": values.get("usage_request_id") or new_id("request"), "status": values.get("status", "created"), "output_artifact_ids": values.get("output_artifact_ids") or [], "output_hashes": values.get("output_hashes") or [], "error": values.get("error") or {}, "prompt_artifact_id": values.get("prompt_artifact_id"), "input_summary": values.get("input_summary") or [], "output_digest": values.get("output_digest") or "", "created_at": now, "updated_at": now}
        if row["status"] not in IMAGE_ATTEMPT_TRANSITIONS:
            raise ValueError("Invalid ImageAttempt status")
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM image_attempts WHERE idempotency_key=?"), (row["idempotency_key"],)).fetchone()
            if existing:
                return self._decode_image_attempt(dict(existing))
            connection.execute(self._sql("INSERT INTO image_attempts(image_attempt_id,image_run_id,retry_of_attempt_id,attempt_number,profile_id,provider_snapshot,endpoint_mode,model,idempotency_key,provider_request_id,usage_request_id,status,output_artifact_ids,output_hashes,error_json,prompt_artifact_id,input_summary,output_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), (attempt_id, image_run_id, row["retry_of_attempt_id"], row["attempt_number"], row["profile_id"], json.dumps(row["provider_snapshot"]), row["endpoint_mode"], row["model"], row["idempotency_key"], row["provider_request_id"], row["usage_request_id"], row["status"], json.dumps(row["output_artifact_ids"]), json.dumps(row["output_hashes"]), json.dumps(row["error"]), row["prompt_artifact_id"], json.dumps(row["input_summary"]), row["output_digest"], now, now))
        return row

    @staticmethod
    def _decode_image_attempt(row: dict[str, Any]) -> dict[str, Any]:
        row["provider_snapshot"] = MetadataStore._json_load(row.get("provider_snapshot"), {})
        row["output_artifact_ids"] = MetadataStore._json_load(row.get("output_artifact_ids"), [])
        row["output_hashes"] = MetadataStore._json_load(row.get("output_hashes"), [])
        row["input_summary"] = MetadataStore._json_load(row.get("input_summary"), [])
        row["error"] = MetadataStore._json_load(row.pop("error_json", None), {})
        return row

    def get_image_attempt(self, project_id: str, image_attempt_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT a.* FROM image_attempts a JOIN image_runs r ON r.image_run_id=a.image_run_id WHERE r.project_id=? AND a.image_attempt_id=?"), (project_id, image_attempt_id)).fetchone())
        return self._decode_image_attempt(row) if row else None

    def list_image_attempts(self, project_id: str, image_run_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(self._sql("SELECT a.* FROM image_attempts a JOIN image_runs r ON r.image_run_id=a.image_run_id WHERE r.project_id=? AND a.image_run_id=? ORDER BY a.attempt_number"), (project_id, image_run_id)).fetchall()]
        return [self._decode_image_attempt(row) for row in rows]

    def update_image_attempt(self, image_attempt_id: str, *, status: str | None = None, provider_request_id: str | None = None, output_artifact_ids: list[str] | None = None, output_hashes: list[str] | None = None, output_digest: str | None = None, error: dict[str, Any] | None = None) -> dict[str, Any] | None:
        fields, values = [], []
        if status is not None: fields.append("status=?"); values.append(status)
        if provider_request_id is not None: fields.append("provider_request_id=?"); values.append(provider_request_id)
        if output_artifact_ids is not None: fields.append("output_artifact_ids=?"); values.append(json.dumps(output_artifact_ids))
        if output_hashes is not None: fields.append("output_hashes=?"); values.append(json.dumps(output_hashes))
        if output_digest is not None: fields.append("output_digest=?"); values.append(output_digest)
        if error is not None: fields.append("error_json=?"); values.append(json.dumps(error))
        if not fields: return None
        fields.append("updated_at=?"); values.extend([utc_now(), image_attempt_id])
        with self.transaction() as connection:
            current = connection.execute(self._sql("SELECT status FROM image_attempts WHERE image_attempt_id=?"), (image_attempt_id,)).fetchone()
            if not current:
                return None
            if status is not None:
                validate_transition(str(current["status"]), status, IMAGE_ATTEMPT_TRANSITIONS)
            connection.execute(self._sql(f"UPDATE image_attempts SET {','.join(fields)} WHERE image_attempt_id=?"), tuple(values))
            row = connection.execute(self._sql("SELECT * FROM image_attempts WHERE image_attempt_id=?"), (image_attempt_id,)).fetchone()
        return self._decode_image_attempt(dict(row)) if row else None

    def create_visual_approval(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        approval_id, now = values.get("visual_approval_id") or new_id("visual_approval"), utc_now()
        row = {"visual_approval_id": approval_id, "project_id": project_id, "page_id": values["page_id"], "contract_revision": int(values["contract_revision"]), "visual_artifact_id": values["visual_artifact_id"], "visual_sha256": values["visual_sha256"], "decision": values["decision"], "comment": values.get("comment", ""), "actor_id": values["actor_id"], "created_at": now}
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO visual_approvals(visual_approval_id,project_id,page_id,contract_revision,visual_artifact_id,visual_sha256,decision,comment,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"), tuple(row.values()))
        return row

    def list_visual_approvals(self, project_id: str, page_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM visual_approvals WHERE project_id=?" + (" AND page_id=?" if page_id else "") + " ORDER BY created_at"
        params = (project_id, page_id) if page_id else (project_id,)
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(self._sql(query), params).fetchall()]

    def create_reconstruction_manifest(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        manifest_id, now = values.get("reconstruction_manifest_id") or new_id("reconstruction"), utc_now()
        row = {"reconstruction_manifest_id": manifest_id, "project_id": project_id, "page_id": values["page_id"], "version_id": values["version_id"], "page_contract_artifact_id": values["page_contract_artifact_id"], "visual_approval_id": values["visual_approval_id"], "source_import_manifest_id": values.get("source_import_manifest_id"), "objects": values.get("objects") or [], "unresolved_items": values.get("unresolved_items") or [], "qa_report_id": values.get("qa_report_id") or "qa_pending", "aggregate_sha256": values["aggregate_sha256"], "schema_version": values.get("schema_version", SCHEMA_VERSION), "artifact_id": values.get("artifact_id"), "created_at": now}
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO reconstruction_manifests(reconstruction_manifest_id,project_id,page_id,version_id,page_contract_artifact_id,visual_approval_id,source_import_manifest_id,objects_json,unresolved_items,qa_report_id,aggregate_sha256,schema_version,artifact_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), (row["reconstruction_manifest_id"], project_id, row["page_id"], row["version_id"], row["page_contract_artifact_id"], row["visual_approval_id"], row["source_import_manifest_id"], json.dumps(row["objects"]), json.dumps(row["unresolved_items"]), row["qa_report_id"], row["aggregate_sha256"], row["schema_version"], row["artifact_id"], now))
        return row

    def get_reconstruction_manifest(self, project_id: str, manifest_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM reconstruction_manifests WHERE project_id=? AND reconstruction_manifest_id=?"), (project_id, manifest_id)).fetchone())
        if row:
            row["objects"] = self._json_load(row.pop("objects_json", None), [])
            row["unresolved_items"] = self._json_load(row.get("unresolved_items"), [])
        return row

    def upsert_page_production_state(self, project_id: str, page_id: str, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        current = self.get_page_production_state(project_id, page_id) or {}
        merged = {**current, **values}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT page_id FROM page_production_states WHERE page_id=?"), (page_id,)).fetchone()
            params = (page_id, project_id, int(merged.get("contract_revision", 1)), merged.get("current_image_run_id"), merged.get("selected_visual_artifact_id"), merged.get("visual_approval_id"), merged.get("reconstruction_manifest_id"), merged.get("reconstruction_status", "pending"), merged.get("render_authority_record_id"), now)
            if existing:
                connection.execute(self._sql("UPDATE page_production_states SET project_id=?,contract_revision=?,current_image_run_id=?,selected_visual_artifact_id=?,visual_approval_id=?,reconstruction_manifest_id=?,reconstruction_status=?,render_authority_record_id=?,updated_at=? WHERE page_id=?"), params[1:] + (page_id,))
            else:
                connection.execute(self._sql("INSERT INTO page_production_states(page_id,project_id,contract_revision,current_image_run_id,selected_visual_artifact_id,visual_approval_id,reconstruction_manifest_id,reconstruction_status,render_authority_record_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"), params)
        return self.get_page_production_state(project_id, page_id) or {}

    def get_page_production_state(self, project_id: str, page_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            return self._dict(connection.execute(self._sql("SELECT * FROM page_production_states WHERE project_id=? AND page_id=?"), (project_id, page_id)).fetchone())

    def create_render_authority_record(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        record_id, now = values.get("render_authority_record_id") or new_id("render_authority"), utc_now()
        status = str(values.get("status") or "failed")
        if status not in {"authoritative", "degraded", "failed"}:
            raise ValueError("Render authority status is invalid")
        row = {
            "render_authority_record_id": record_id,
            "project_id": project_id,
            "page_id": values["page_id"],
            "version_id": values["version_id"],
            "pptx_artifact_id": values["pptx_artifact_id"],
            "pptx_sha256": values["pptx_sha256"],
            "render_worker": values.get("render_worker") or "unavailable",
            "office_version": values.get("office_version"),
            "status": status,
            "output_png_artifact_id": values.get("output_png_artifact_id"),
            "output_png_sha256": values.get("output_png_sha256"),
            "qa_report_id": values.get("qa_report_id"),
            "reason": values.get("reason"),
            "created_at": now,
        }
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO render_authority_records(render_authority_record_id,project_id,page_id,version_id,pptx_artifact_id,pptx_sha256,render_worker,office_version,status,output_png_artifact_id,output_png_sha256,qa_report_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"), tuple(row.values()))
        return row

    def list_render_authority_records(self, project_id: str, page_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM render_authority_records WHERE project_id=?" + (" AND page_id=?" if page_id else "") + " ORDER BY created_at"
        params = (project_id, page_id) if page_id else (project_id,)
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(self._sql(query), params).fetchall()]

    def create_deck_revision(self, project_id: str, values: dict[str, Any]) -> dict[str, Any]:
        revision_id, now = values.get("deck_revision_id") or new_id("deck_revision"), utc_now()
        ordered = values.get("ordered_pages") or []
        aggregate = values.get("aggregate_sha256") or hashlib.sha256(json.dumps(ordered, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        row = {"deck_revision_id": revision_id, "project_id": project_id, "parent_revision_id": values.get("parent_revision_id"), "source_session_id": values.get("source_session_id") or "", "source_mode": values.get("source_mode") or "page_entry", "ordered_pages": ordered, "status": values.get("status", "building"), "aggregate_sha256": aggregate, "created_by": values["created_by"], "created_at": now}
        with self.transaction() as connection:
            connection.execute(self._sql("INSERT INTO deck_revisions(deck_revision_id,project_id,parent_revision_id,source_session_id,source_mode,ordered_pages,status,aggregate_sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"), (revision_id, project_id, row["parent_revision_id"], row["source_session_id"], row["source_mode"], json.dumps(ordered), row["status"], aggregate, row["created_by"], now))
            connection.execute(self._sql("UPDATE projects SET current_deck_revision_id=?,updated_at=? WHERE project_id=?"), (revision_id, now, project_id))
        return row

    def get_deck_revision(self, project_id: str, revision_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM deck_revisions WHERE project_id=? AND deck_revision_id=?"), (project_id, revision_id)).fetchone())
        if row:
            row["ordered_pages"] = self._json_load(row.pop("ordered_pages"), [])
        return row

    def list_deck_revisions(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            ids = [row["deck_revision_id"] for row in connection.execute(self._sql("SELECT deck_revision_id FROM deck_revisions WHERE project_id=? ORDER BY created_at DESC"), (project_id,)).fetchall()]
        return [item for item in (self.get_deck_revision(project_id, revision_id) for revision_id in ids) if item]

    def update_version_render(self, project_id: str, version_id: str, artifact_id: str, status: str, qa: dict[str, Any]) -> bool:
        with self.transaction() as connection:
            cursor = connection.execute(self._sql("UPDATE page_versions SET pptx_render_artifact_id=?,status=?,qa_json=? WHERE version_id=? AND page_id IN (SELECT page_id FROM pages WHERE project_id=?)"), (artifact_id, status, json.dumps(qa), version_id, project_id))
        return cursor.rowcount == 1

    # v2 immutable records.  These helpers intentionally append snapshots and
    # never update an existing content hash.  Idempotency is scoped to a
    # project and caller-provided stable key.
    def create_v2_design_snapshot(self, project_id: str, idempotency_key: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        snapshot_id = str(snapshot.get("snapshot_id") or new_id("design_snapshot"))
        now = utc_now()
        row = {"snapshot_id": snapshot_id, "project_id": project_id, "idempotency_key": idempotency_key, "mode": str(snapshot.get("mode") or "none_none"), "snapshot": snapshot, "content_hash": str(snapshot.get("content_hash") or ""), "created_at": now}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_design_snapshots WHERE project_id=? AND idempotency_key=?"), (project_id, idempotency_key)).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "design snapshot")
                return self._decode_v2_row(dict(existing), "snapshot_json", "snapshot")
            connection.execute(self._sql("INSERT INTO v2_design_snapshots(snapshot_id,project_id,idempotency_key,mode,snapshot_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?)"), (snapshot_id, project_id, idempotency_key, row["mode"], json.dumps(snapshot, ensure_ascii=False), row["content_hash"], now))
        return row

    @staticmethod
    def _decode_v2_row(row: dict[str, Any], raw_key: str, decoded_key: str) -> dict[str, Any]:
        row[decoded_key] = MetadataStore._json_load(row.pop(raw_key, None), {})
        return row

    @staticmethod
    def _check_v2_immutable(existing: dict[str, Any], incoming_hash: str, name: str) -> None:
        existing_hash = str(existing.get("content_hash") or "")
        if existing_hash and incoming_hash and existing_hash != incoming_hash:
            raise ValueError(f"immutable v2 {name} conflicts with existing content")

    def get_v2_design_snapshot(self, project_id: str, *, snapshot_id: str | None = None, idempotency_key: str | None = None) -> dict[str, Any] | None:
        if not snapshot_id and not idempotency_key:
            raise ValueError("snapshot_id or idempotency_key is required")
        clause, value = ("snapshot_id=?", snapshot_id) if snapshot_id else ("idempotency_key=?", idempotency_key)
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql(f"SELECT * FROM v2_design_snapshots WHERE project_id=? AND {clause}"), (project_id, value)).fetchone())
        return self._decode_v2_row(row, "snapshot_json", "snapshot") if row else None

    def create_v2_page_contract_snapshot(self, project_id: str, page_id: str, version_id: str, contract: dict[str, Any]) -> dict[str, Any]:
        row = {"snapshot_id": str(contract.get("snapshot_id") or new_id("page_contract_snapshot")), "project_id": project_id, "page_id": page_id, "version_id": version_id, "contract": contract, "content_hash": str(contract.get("content_hash") or ""), "created_at": utc_now()}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_page_contract_snapshots WHERE project_id=? AND page_id=? AND version_id=?"), (project_id, page_id, version_id)).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "page contract snapshot")
                return self._decode_v2_row(dict(existing), "contract_json", "contract")
            connection.execute(self._sql("INSERT INTO v2_page_contract_snapshots(snapshot_id,project_id,page_id,version_id,contract_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?)"), (row["snapshot_id"], project_id, page_id, version_id, json.dumps(contract, ensure_ascii=False), row["content_hash"], row["created_at"]))
        return row

    def list_v2_page_contract_snapshots(self, project_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = [dict(item) for item in connection.execute(self._sql("SELECT * FROM v2_page_contract_snapshots WHERE project_id=? ORDER BY created_at"), (project_id,)).fetchall()]
        return [self._decode_v2_row(item, "contract_json", "contract") for item in rows]

    def create_v2_checkpoint(self, project_id: str, idempotency_key: str, checkpoint: dict[str, Any]) -> dict[str, Any]:
        row = {"checkpoint_id": str(checkpoint.get("checkpoint_id") or new_id("checkpoint")), "project_id": project_id, "idempotency_key": idempotency_key, "stage": str(checkpoint.get("stage") or "staged"), "checkpoint": checkpoint, "content_hash": str(checkpoint.get("content_hash") or ""), "created_at": utc_now()}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_generation_checkpoints WHERE project_id=? AND idempotency_key=?"), (project_id, idempotency_key)).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "generation checkpoint")
                return self._decode_v2_row(dict(existing), "checkpoint_json", "checkpoint")
            connection.execute(self._sql("INSERT INTO v2_generation_checkpoints(checkpoint_id,project_id,idempotency_key,stage,checkpoint_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?)"), (row["checkpoint_id"], project_id, idempotency_key, row["stage"], json.dumps(checkpoint, ensure_ascii=False), row["content_hash"], row["created_at"]))
        return row

    def get_v2_checkpoint(self, project_id: str, idempotency_key: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = self._dict(connection.execute(self._sql("SELECT * FROM v2_generation_checkpoints WHERE project_id=? AND idempotency_key=?"), (project_id, idempotency_key)).fetchone())
        return self._decode_v2_row(row, "checkpoint_json", "checkpoint") if row else None

    def create_v2_artifact_commit(self, project_id: str, idempotency_key: str, artifact: dict[str, Any], *, status: str = "committed") -> dict[str, Any]:
        row = {"commit_id": str(artifact.get("commit_id") or new_id("artifact_commit")), "project_id": project_id, "idempotency_key": idempotency_key, "artifact": artifact, "content_hash": str(artifact.get("content_hash") or ""), "status": status, "created_at": utc_now()}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_artifact_commits WHERE project_id=? AND idempotency_key=?"), (project_id, idempotency_key)).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "artifact commit")
                return self._decode_v2_row(dict(existing), "artifact_json", "artifact")
            connection.execute(self._sql("INSERT INTO v2_artifact_commits(commit_id,project_id,idempotency_key,artifact_json,content_hash,status,created_at) VALUES(?,?,?,?,?,?,?)"), (row["commit_id"], project_id, idempotency_key, json.dumps(artifact, ensure_ascii=False), row["content_hash"], status, row["created_at"]))
        return row

    def create_v2_export_snapshot(self, project_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        row = {"export_snapshot_id": str(snapshot.get("export_snapshot_id") or new_id("export_snapshot")), "project_id": project_id, "snapshot": snapshot, "content_hash": str(snapshot.get("content_hash") or ""), "created_at": utc_now()}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_export_snapshots WHERE project_id=? AND export_snapshot_id=?"), (project_id, row["export_snapshot_id"])).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "export snapshot")
                return self._decode_v2_row(dict(existing), "snapshot_json", "snapshot")
            connection.execute(self._sql("INSERT INTO v2_export_snapshots(export_snapshot_id,project_id,snapshot_json,content_hash,created_at) VALUES(?,?,?,?,?)"), (row["export_snapshot_id"], project_id, json.dumps(snapshot, ensure_ascii=False), row["content_hash"], row["created_at"]))
        return row

    def create_v2_export_attempt(self, project_id: str, export_snapshot_id: str, attempt: dict[str, Any]) -> dict[str, Any]:
        row = {"export_attempt_id": str(attempt.get("export_attempt_id") or new_id("export_attempt")), "project_id": project_id, "export_snapshot_id": export_snapshot_id, "attempt_number": int(attempt.get("attempt_number") or 1), "status": str(attempt.get("status") or "queued"), "attempt": attempt, "content_hash": str(attempt.get("content_hash") or ""), "created_at": utc_now()}
        with self.transaction() as connection:
            existing = connection.execute(self._sql("SELECT * FROM v2_export_attempts WHERE project_id=? AND export_snapshot_id=? AND attempt_number=?"), (project_id, export_snapshot_id, row["attempt_number"])).fetchone()
            if existing:
                self._check_v2_immutable(dict(existing), row["content_hash"], "export attempt")
                return self._decode_v2_row(dict(existing), "attempt_json", "attempt")
            connection.execute(self._sql("INSERT INTO v2_export_attempts(export_attempt_id,project_id,export_snapshot_id,attempt_number,status,attempt_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)"), (row["export_attempt_id"], project_id, export_snapshot_id, row["attempt_number"], row["status"], json.dumps(attempt, ensure_ascii=False), row["content_hash"], row["created_at"]))
        return row


class SQLiteMetadataStore(MetadataStore):
    def __init__(self, path: Path) -> None:
        super().__init__()
        self.path = path.resolve()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _execute_sqlite_migration_statement(
        connection: sqlite3.Connection,
        statement: str,
        parameters: tuple[Any, ...] = (),
    ) -> sqlite3.Cursor:
        return connection.execute(statement, parameters)

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._write_lock, self.connection() as connection:
            migrations = {
                "users": {"role": "TEXT NOT NULL DEFAULT 'member'"},
                "projects": {"v2_default_selection_json": "TEXT NOT NULL DEFAULT '{}'"},
                "facts": {"conflict_key": "TEXT NOT NULL DEFAULT ''"},
                "project_assets": {"scope": "TEXT NOT NULL DEFAULT 'project'", "page_id": "TEXT"},
                "work_sessions": {"options_json": "TEXT NOT NULL DEFAULT '{}'"},
                "reconstruction_manifests": {"artifact_id": "TEXT"},
                "operations": {"error_json": "TEXT NOT NULL DEFAULT '{}'"},
                "agent_runs": {
                    "prompt_artifact_id": "TEXT",
                    "prompt_id": "TEXT NOT NULL DEFAULT ''",
                    "prompt_version": "TEXT NOT NULL DEFAULT 'legacy'",
                    "input_contract_version": "TEXT NOT NULL DEFAULT 'legacy'",
                    "output_schema_version": "TEXT NOT NULL DEFAULT 'legacy'",
                    "input_context_digest": "TEXT NOT NULL DEFAULT ''",
                    "prompt_digest": "TEXT NOT NULL DEFAULT ''",
                    "output_digest": "TEXT NOT NULL DEFAULT ''",
                    "context_manifest_artifact_id": "TEXT",
                    "truncation_report_artifact_id": "TEXT",
                    "parent_output_artifact_ids": "TEXT NOT NULL DEFAULT '[]'",
                    "design_selection_id": "TEXT",
                },
                "image_attempts": {
                    "prompt_artifact_id": "TEXT",
                    "input_summary": "TEXT NOT NULL DEFAULT '{}'",
                    "output_digest": "TEXT NOT NULL DEFAULT ''",
                },
                "usage_ledger": {
                    "request_id": "TEXT",
                    "last_error": "TEXT",
                },
            }
            try:
                connection.executescript("BEGIN IMMEDIATE;\n" + SQLITE_SCHEMA)
                for table, columns in migrations.items():
                    existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
                    for column, declaration in columns.items():
                        if column not in existing:
                            self._execute_sqlite_migration_statement(
                                connection, f"ALTER TABLE {table} ADD COLUMN {column} {declaration}"
                            )
                self._execute_sqlite_migration_statement(
                    connection,
                    "UPDATE usage_ledger SET request_id=ledger_id WHERE request_id IS NULL OR request_id='' ",
                )
                self._execute_sqlite_migration_statement(
                    connection,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_request ON usage_ledger(request_id)",
                )
                self._execute_sqlite_migration_statement(
                    connection,
                    "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)",
                    ("1.2.0", utc_now()),
                )
                self._execute_sqlite_migration_statement(
                    connection,
                    "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)",
                    ("2.0.0", utc_now()),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise


class PostgresMetadataStore(MetadataStore):
    placeholder = "%s"

    def __init__(self, database_url: str) -> None:
        super().__init__()
        self.database_url = database_url

    @contextmanager
    def connection(self) -> Iterator[Any]:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("Install the 'server' extra for PostgreSQL support") from exc
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def initialize(self) -> None:
        with self.connection() as connection:
            for statement in POSTGRES_SCHEMA.split(";"):
                if statement.strip():
                    connection.execute(statement)
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'")
            connection.execute("ALTER TABLE facts ADD COLUMN IF NOT EXISTS conflict_key TEXT NOT NULL DEFAULT ''")
            connection.execute("ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS options_json TEXT NOT NULL DEFAULT '{}'")
            connection.execute("ALTER TABLE reconstruction_manifests ADD COLUMN IF NOT EXISTS artifact_id TEXT")
            connection.execute("ALTER TABLE operations ADD COLUMN IF NOT EXISTS error_json TEXT NOT NULL DEFAULT '{}'")
            for column, declaration in {
                "prompt_artifact_id": "TEXT",
                "prompt_id": "TEXT NOT NULL DEFAULT ''",
                "prompt_version": "TEXT NOT NULL DEFAULT 'legacy'",
                "input_contract_version": "TEXT NOT NULL DEFAULT 'legacy'",
                "output_schema_version": "TEXT NOT NULL DEFAULT 'legacy'",
                "input_context_digest": "TEXT NOT NULL DEFAULT ''",
                "prompt_digest": "TEXT NOT NULL DEFAULT ''",
                "output_digest": "TEXT NOT NULL DEFAULT ''",
                "context_manifest_artifact_id": "TEXT",
                "truncation_report_artifact_id": "TEXT",
                "parent_output_artifact_ids": "TEXT NOT NULL DEFAULT '[]'",
                "design_selection_id": "TEXT",
            }.items():
                connection.execute(f"ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS {column} {declaration}")
            for column, declaration in {
                "prompt_artifact_id": "TEXT",
                "input_summary": "TEXT NOT NULL DEFAULT '{}'",
                "output_digest": "TEXT NOT NULL DEFAULT ''",
            }.items():
                connection.execute(f"ALTER TABLE image_attempts ADD COLUMN IF NOT EXISTS {column} {declaration}")
            connection.execute("ALTER TABLE usage_ledger ADD COLUMN IF NOT EXISTS request_id TEXT")
            connection.execute("ALTER TABLE usage_ledger ADD COLUMN IF NOT EXISTS last_error TEXT")
            connection.execute("UPDATE usage_ledger SET request_id=ledger_id WHERE request_id IS NULL OR request_id='' ")
            connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_request ON usage_ledger(request_id)")
            connection.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(%s,%s) ON CONFLICT(version) DO NOTHING", ("1.2.0", utc_now()))
            connection.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(%s,%s) ON CONFLICT(version) DO NOTHING", ("2.0.0", utc_now()))
            connection.commit()


def build_store(settings: Any) -> MetadataStore:
    if settings.metadata_store == "sqlite":
        store: MetadataStore = SQLiteMetadataStore(settings.data_dir / "fastppt.sqlite3")
    elif settings.metadata_store == "postgres" and settings.database_url:
        store = PostgresMetadataStore(settings.database_url)
    else:
        raise RuntimeError("Unsupported metadata store configuration")
    store.initialize()
    return store
