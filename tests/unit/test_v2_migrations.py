import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_runtime.store import SQLiteMetadataStore


class V2MigrationTests(TestCase):
    def test_initialize_is_forward_only_and_preserves_v1_sentinel(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "legacy sentinel")
            with store.connection() as connection:
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
                    ("1.0.0", "2026-01-01T00:00:00+00:00"),
                )
                connection.commit()
            store.initialize()
            self.assertEqual(store.get_project(user["user_id"], project["project_id"])["name"], "legacy sentinel")
            with store.connection() as connection:
                versions = {row["version"] for row in connection.execute("SELECT version FROM schema_migrations")}
                tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("1.0.0", versions)
            self.assertIn("2.0.0", versions)
            self.assertIn("v2_design_snapshots", tables)
            self.assertIn("v2_export_attempts", tables)

    def test_v2_immutable_crud_is_idempotent_and_rejects_changed_hash(self) -> None:
        with TemporaryDirectory() as temp_name:
            store = SQLiteMetadataStore(Path(temp_name) / "metadata.sqlite3")
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "v2 store")
            snapshot = {"schema_version": "2.0.0", "required_capabilities": [], "mode": "none_none", "content_hash": "sha256:" + "1" * 64}
            first = store.create_v2_design_snapshot(project["project_id"], "same-key", snapshot)
            second = store.create_v2_design_snapshot(project["project_id"], "same-key", dict(snapshot))
            self.assertEqual(first["snapshot_id"], second["snapshot_id"])
            self.assertEqual(store.get_v2_design_snapshot(project["project_id"], idempotency_key="same-key")["mode"], "none_none")
            changed = {**snapshot, "mode": "style_only", "content_hash": "sha256:" + "2" * 64}
            with self.assertRaises(ValueError):
                store.create_v2_design_snapshot(project["project_id"], "same-key", changed)
            export_snapshot = {"schema_version": "2.0.0", "required_capabilities": ["export"], "export_snapshot_id": "export_snapshot_test", "content_hash": "sha256:" + "3" * 64}
            store.create_v2_export_snapshot(project["project_id"], export_snapshot)
            attempt = {"schema_version": "2.0.0", "required_capabilities": ["export"], "export_attempt_id": "export_attempt_test", "attempt_number": 1, "content_hash": "sha256:" + "4" * 64}
            one = store.create_v2_export_attempt(project["project_id"], "export_snapshot_test", attempt)
            two = store.create_v2_export_attempt(project["project_id"], "export_snapshot_test", dict(attempt))
            self.assertEqual(one["export_attempt_id"], two["export_attempt_id"])

    def test_sqlite_migration_failure_rolls_back_all_schema_changes(self) -> None:
        class FailingMigrationStore(SQLiteMetadataStore):
            failed = False

            def _execute_sqlite_migration_statement(self, connection, statement, parameters=()):
                result = super()._execute_sqlite_migration_statement(connection, statement, parameters)
                if statement.startswith("ALTER TABLE") and not self.failed:
                    self.failed = True
                    raise RuntimeError("injected migration interruption")
                return result

        with TemporaryDirectory() as temp_name:
            path = Path(temp_name) / "metadata.sqlite3"
            store = SQLiteMetadataStore(path)
            store.initialize()
            user = store.ensure_local_user()
            project = store.create_project(user["user_id"], "migration rollback sentinel")
            with store.connection() as connection:
                connection.execute("ALTER TABLE projects DROP COLUMN v2_default_selection_json")
                connection.execute("DROP TABLE v2_export_attempts")
                connection.commit()

            with self.assertRaisesRegex(RuntimeError, "injected migration interruption"):
                FailingMigrationStore(path).initialize()

            with store.connection() as connection:
                project_columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(projects)").fetchall()
                }
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                }
                sentinel = connection.execute(
                    "SELECT name FROM projects WHERE project_id=?", (project["project_id"],)
                ).fetchone()[0]
            self.assertNotIn("v2_default_selection_json", project_columns)
            self.assertNotIn("v2_export_attempts", tables)
            self.assertEqual(sentinel, "migration rollback sentinel")
