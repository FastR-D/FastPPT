import hashlib
import io
import json
import stat
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock
from zipfile import ZipFile, ZipInfo

from fastppt_core.design import PACK_FIELDS, bundle_content_hash, pack_content_hash
from fastppt_runtime.artifacts import FilesystemArtifactStore
from fastppt_runtime.config import RuntimeSettings
from fastppt_runtime.design_packs import install_bundle, validate_bundle
from fastppt_runtime.service import ApplicationService, ConflictError, NotFoundError
from fastppt_runtime.store import SQLiteMetadataStore


def make_bundle(*, pack_id: str = "pack_style_test", nested: bool = True, resource: bytes = b"", preview: bool = False) -> bytes:
    resource_name = "preview.png"
    resource = resource or b"\x89PNG\r\n\x1a\nfixture"
    matrix = {field: "reserved_not_applied" for field in PACK_FIELDS}
    matrix["color_palette"] = "applied"
    manifest = {
        "schema_version": "1.0",
        "pack_id": pack_id,
        "pack_kind": "style",
        "display_name": "Private style",
        "description": "Test pack",
        "version": "1.0.0",
        "status": "active",
        "scope": "private",
        "owner_id": "",
        "license": "private",
        "manifest_artifact_id": "",
        "content_hash": "",
        "preview_artifact_ids": [resource_name] if preview else [],
        "color_palette": {"accent": "#126B52", "background": "#FFFFFF"},
        "typography": {},
        "density": {},
        "visual_language": {},
        "layout_blueprints": [],
        "image_treatment": {},
        "rendering_constraints": [],
        "prompt_fragments": ["reference-only phrase"],
        "supported_page_types": [],
        "asset_ids": [],
        "capability_matrix": matrix,
    }
    manifest["content_hash"] = pack_content_hash(manifest, {resource_name: hashlib.sha256(resource).hexdigest()})
    prefix = "packs/style/" if nested else ""
    manifest_path = prefix + "pack_manifest.json"
    root = {
        "bundle_id": "bundle_test",
        "schema_version": "1.0",
        "display_name": "Bundle",
        "version": "1.0.0",
        "content_hash": "",
        "members": [{
            "pack_id": pack_id,
            "pack_kind": "style",
            "version": "1.0.0",
            "content_hash": manifest["content_hash"],
            "manifest_path": manifest_path,
            "dependencies": [],
        }],
    }
    root["content_hash"] = bundle_content_hash(root)
    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("bundle_manifest.json", json.dumps(root))
        archive.writestr(manifest_path, json.dumps(manifest))
        archive.writestr(prefix + resource_name, resource)
    return output.getvalue()


class DesignPackSecurityTests(TestCase):
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
        return service, store

    def test_valid_nested_and_root_bundles_have_consistent_hashes(self) -> None:
        for nested in (True, False):
            validated = validate_bundle(make_bundle(nested=nested), "user_test")
            self.assertEqual(validated["members"][0]["manifest"]["owner_id"], "user_test")
            self.assertIn("preview.png", validated["members"][0]["resource_hashes"])

    def test_directory_and_http_file_mapping_import_use_the_same_validator(self) -> None:
        payload = make_bundle(nested=True)
        with TemporaryDirectory() as temp_name:
            directory = Path(temp_name) / "bundle"
            directory.mkdir()
            with ZipFile(io.BytesIO(payload)) as archive:
                archive.extractall(directory)
            from_directory = validate_bundle(directory, "user_test")
            mapping = {path.relative_to(directory).as_posix(): path.read_bytes() for path in directory.rglob("*") if path.is_file()}
            from_mapping = validate_bundle(mapping, "user_test")
            self.assertEqual(from_directory["bundle"]["content_hash"], from_mapping["bundle"]["content_hash"])

    def test_bundle_rejects_traversal_symlink_script_mime_and_oversize(self) -> None:
        valid = make_bundle()
        with ZipFile(io.BytesIO(valid)) as source:
            entries = {item.filename: source.read(item) for item in source.infolist()}

        def rebuild(extra_name: str, extra_content: bytes, *, symlink: bool = False) -> bytes:
            output = io.BytesIO()
            with ZipFile(output, "w") as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
                info = ZipInfo(extra_name)
                if symlink:
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, extra_content)
            return output.getvalue()

        cases = [
            rebuild("../escape.txt", b"x"),
            rebuild("packs/style/link", b"target", symlink=True),
            rebuild("packs/style/run.ps1", b"Write-Host unsafe"),
            rebuild("packs/style/bad.png", b"not-png"),
        ]
        for payload in cases:
            with self.assertRaises(ValueError):
                validate_bundle(payload, "user_test")
        with mock.patch("fastppt_runtime.design_packs.MAX_FILE_BYTES", 4):
            with self.assertRaisesRegex(ValueError, "25 MB"):
                validate_bundle(valid, "user_test")

    def test_hash_mismatch_and_atomic_install_failure_leave_no_partial_pack(self) -> None:
        output = io.BytesIO()
        with ZipFile(io.BytesIO(make_bundle())) as source, ZipFile(output, "w") as changed:
            for item in source.infolist():
                value = source.read(item)
                if item.filename.endswith("pack_manifest.json"):
                    payload = json.loads(value)
                    payload["display_name"] = "Changed without rehashing"
                    value = json.dumps(payload).encode()
                changed.writestr(item.filename, value)
        with self.assertRaises(ValueError):
            validate_bundle(output.getvalue(), "user_test")

        with TemporaryDirectory() as temp_name:
            private_root = Path(temp_name) / "private-packs"
            existing = private_root / "user_test" / "pack_style_test" / "1.0.0"
            existing.mkdir(parents=True)
            with self.assertRaises(ValueError):
                install_bundle(make_bundle(), "user_test", private_root)
            self.assertEqual(list((private_root / "user_test").glob("pack_*/*")), [existing])

    def test_private_visibility_admin_audit_detail_and_explicit_use(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store = self._service(Path(temp_name))
            admin = store.ensure_local_user()
            owner = store.create_user("owner@example.invalid", "Owner", "hash")
            other = store.create_user("other@example.invalid", "Other", "hash")
            owner_project = service.create_project(owner["user_id"], "Owner project")
            other_project = service.create_project(other["user_id"], "Other project")
            admin_project = service.create_project(admin["user_id"], "Admin project")
            imported = service.import_design_bundle(owner["user_id"], owner_project["project_id"], make_bundle())
            pack_id = imported["packs"][0]["pack_id"]

            self.assertEqual(service.list_design_packs(other["user_id"], other_project["project_id"]), [])
            with self.assertRaises(NotFoundError):
                service.get_design_pack(other["user_id"], other_project["project_id"], pack_id)
            with self.assertRaises(ConflictError):
                service.list_design_packs(other["user_id"], other_project["project_id"], include_all_private=True)
            self.assertEqual(len(service.list_design_packs(admin["user_id"], admin_project["project_id"], include_all_private=True)), 1)

            session = service.create_session(owner["user_id"], owner_project["project_id"], "page_entry", [])
            before = service.get_session_design_selection(owner["user_id"], owner_project["project_id"], session["session_id"])
            service.get_design_pack(owner["user_id"], owner_project["project_id"], pack_id)
            after_detail = service.get_session_design_selection(owner["user_id"], owner_project["project_id"], session["session_id"])
            self.assertIsNone(before["design_selection_id"])
            self.assertIsNone(after_detail["design_selection_id"])
            selected = service.select_design_pack(owner["user_id"], owner_project["project_id"], session["session_id"], pack_id, "style")
            self.assertEqual(selected["style_pack_id"], pack_id)
            self.assertEqual(selected["snapshot"]["applied_constraints"]["style:color_palette"]["accent"], "#126B52")
            self.assertNotIn("style:prompt_fragments", selected["snapshot"]["applied_constraints"])

            with store.connection() as connection:
                audited = connection.execute("SELECT COUNT(*) FROM audit_log WHERE actor_id=? AND action='design_pack.admin_list'", (admin["user_id"],)).fetchone()[0]
            self.assertEqual(audited, 1)

    def test_identical_import_retry_and_preview_are_owner_scoped(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store = self._service(Path(temp_name))
            owner = store.create_user("preview-owner@example.invalid", "Preview owner", "hash")
            other = store.create_user("preview-other@example.invalid", "Preview other", "hash")
            owner_project = service.create_project(owner["user_id"], "Preview owner project")
            other_project = service.create_project(other["user_id"], "Preview other project")
            payload = make_bundle(preview=True)

            imported = service.import_design_bundle(owner["user_id"], owner_project["project_id"], payload)
            retried = service.import_design_bundle(owner["user_id"], owner_project["project_id"], payload)
            pack_id = imported["packs"][0]["pack_id"]
            self.assertTrue(retried["deduplicated"])
            self.assertEqual(retried["packs"][0]["content_hash"], imported["packs"][0]["content_hash"])
            preview, media_type = service.design_pack_preview(owner["user_id"], owner_project["project_id"], pack_id, 0)
            self.assertEqual((preview, media_type), (b"\x89PNG\r\n\x1a\nfixture", "image/png"))
            with self.assertRaises(NotFoundError):
                service.design_pack_preview(other["user_id"], other_project["project_id"], pack_id, 0)

    def test_use_time_validation_rejects_dependency_and_resource_tampering(self) -> None:
        with TemporaryDirectory() as temp_name:
            service, store = self._service(Path(temp_name))
            owner = store.create_user("tamper-owner@example.invalid", "Tamper owner", "hash")
            project = service.create_project(owner["user_id"], "Tamper project")
            imported = service.import_design_bundle(owner["user_id"], project["project_id"], make_bundle())
            pack_id = imported["packs"][0]["pack_id"]
            session = service.create_session(owner["user_id"], project["project_id"], "page_entry", [])

            with store.transaction() as connection:
                connection.execute(
                    "UPDATE design_pack_membership SET dependency_ids=? WHERE pack_id=? AND version=?",
                    (json.dumps(["pack_missing_dependency"]), pack_id, "1.0.0"),
                )
            with self.assertRaisesRegex(ConflictError, "dependency"):
                service.select_design_pack(owner["user_id"], project["project_id"], session["session_id"], pack_id, "style")

            with store.transaction() as connection:
                connection.execute(
                    "UPDATE design_pack_membership SET dependency_ids=? WHERE pack_id=? AND version=?",
                    ("[]", pack_id, "1.0.0"),
                )
            registered = store.get_design_pack(owner["user_id"], pack_id)
            resource = service.settings.data_dir / registered["storage_path"] / "preview.png"
            resource.write_bytes(b"changed after validation")
            with self.assertRaisesRegex(ConflictError, "missing or has changed"):
                service.select_design_pack(owner["user_id"], project["project_id"], session["session_id"], pack_id, "style")
