import copy
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_core.v2 import (
    DesignConfirmationRequired,
    DesignSelectionStateMachine,
    DesignSnapshot,
    PackageHashMismatch,
    PageContractV2,
    V2ContractError,
    V2_MODES,
    create_design_snapshot,
    sha256_json,
)
from fastppt_core.contracts import (
    validate_style_package_manifest_v2,
    validate_template_package_manifest_v2,
)
from fastppt_runtime.task1 import load_task1_fixture
from fastppt_runtime.v2_artifacts import ArtifactMissingError


class V2DesignContractTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_task1_fixture()

    def test_locked_fixture_contracts_round_trip_and_preserve_extensions(self) -> None:
        for page in self.fixture["pages"]:
            payload = page.to_dict()
            payload["future_extension"] = {"retained": True}
            payload["content_hash"] = sha256_json({**payload, "content_hash": ""})
            decoded = PageContractV2.from_dict(payload)
            self.assertEqual(decoded.to_dict()["future_extension"], {"retained": True})
            self.assertEqual(decoded.content_hash, payload["content_hash"])
        style = self.fixture["style"].to_dict()
        template = self.fixture["template"].to_dict()
        self.assertEqual(style["content_hash"], self.fixture["style"].content_hash)
        self.assertEqual(template["content_hash"], self.fixture["template"].content_hash)

    def test_unknown_required_capability_fails_closed(self) -> None:
        payload = self.fixture["pages"][0].to_dict()
        payload["required_capabilities"] = ["page_contract", "future_required_capability"]
        payload["content_hash"] = sha256_json({**payload, "content_hash": ""})
        with self.assertRaises(V2ContractError):
            PageContractV2.from_dict(payload)

    def test_content_hash_mismatch_is_rejected(self) -> None:
        payload = self.fixture["pages"][0].to_dict()
        payload["text"] = [*payload["text"], "changed"]
        with self.assertRaises(PackageHashMismatch):
            PageContractV2.from_dict(payload)

    def test_style_and_template_manifest_helpers_verify_hash_by_default(self) -> None:
        style = self.fixture["style"].to_dict()
        style["tokens"] = {**style["tokens"], "background": "#ABCDEF"}
        with self.assertRaises(PackageHashMismatch):
            validate_style_package_manifest_v2(style)

        template = self.fixture["template"].to_dict()
        template["capacity"] = {**template["capacity"], "cover": 999}
        with self.assertRaises(PackageHashMismatch):
            validate_template_package_manifest_v2(template)

    def test_fixture_missing_and_changed_bytes_have_distinct_failures(self) -> None:
        with TemporaryDirectory() as temp_name:
            fixture_dir = Path(temp_name) / "task1"
            shutil.copytree(self.fixture["root"], fixture_dir)
            (fixture_dir / "hero-grid.png").unlink()
            with self.assertRaises(ArtifactMissingError):
                load_task1_fixture(fixture_dir)

        with TemporaryDirectory() as temp_name:
            fixture_dir = Path(temp_name) / "task1"
            shutil.copytree(self.fixture["root"], fixture_dir)
            with (fixture_dir / "template.potx").open("ab") as stream:
                stream.write(b"changed")
            with self.assertRaises(PackageHashMismatch):
                load_task1_fixture(fixture_dir)

    def test_design_snapshot_requires_complete_package_references(self) -> None:
        style = self.fixture["style"].to_dict()
        with self.assertRaises(V2ContractError):
            create_design_snapshot({"style_id": style["style_id"], "version": style["version"]})

    def test_style_template_snapshot_requires_preview_for_confirmation(self) -> None:
        style = self.fixture["style"].to_dict()
        template = self.fixture["template"].to_dict()
        draft = create_design_snapshot(style, template)
        self.assertEqual(draft.mode, "style_template")
        self.assertIsNone(draft.confirmed_by)
        with self.assertRaises(DesignConfirmationRequired):
            draft.confirm("user")
        confirmed = create_design_snapshot(
            style,
            template,
            preview_artifact_hash="sha256:" + "a" * 64,
            confirmed_by="user",
            confirmed_at="2026-01-01T00:00:00+00:00",
        )
        self.assertEqual(DesignSnapshot.from_dict(confirmed.to_dict()).content_hash, confirmed.content_hash)

    def test_all_modes_have_expected_state_machine_gate(self) -> None:
        for mode in V2_MODES:
            machine = DesignSelectionStateMachine(mode)
            self.assertEqual(machine.validate(), "preview_required" if mode == "style_template" else "ready")
            if mode == "style_template":
                self.assertEqual(machine.confirm(), "active")
            else:
                self.assertEqual(machine.transition("active"), "active")
        machine = DesignSelectionStateMachine("style_template")
        machine.validate()
        with self.assertRaises(DesignConfirmationRequired):
            machine.transition("ready")
