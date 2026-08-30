from copy import deepcopy
from unittest import TestCase

from fastppt_core.v2 import (
    DesignConfirmationRequired,
    ProtectedAssetConflict,
    TemplateCapacityExceeded,
    compile_page,
    compile_template_page,
    create_design_snapshot,
    resolve_design_attributes,
    V2ContractError,
)
from fastppt_ppt_master import PptMasterAdapter
from fastppt_runtime.task1 import load_task1_fixture


class V2DesignCompilerTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_task1_fixture()
        cls.style = cls.fixture["style"].to_dict()
        cls.template = cls.fixture["template"].to_dict()

    def test_precedence_preserves_page_contract_and_records_override_metadata(self) -> None:
        page = self.fixture["pages"][0].to_dict()
        template = deepcopy(self.template)
        template["attributes"] = {"background": "#EEEEEE", "font_family": "TemplateFont", "page_size": "16:9"}
        style = deepcopy(self.style)
        style["tokens"] = {**style["tokens"], "background": "#FFFFFF", "font_family": "StyleFont", "accent_color": "#23745B"}
        resolved = resolve_design_attributes(page, template, style)
        self.assertEqual(resolved["attributes"]["facts"], page["facts"])
        self.assertEqual(resolved["attributes"]["text"], page["text"])
        self.assertEqual(resolved["attributes"]["page_size"], "16:9")
        self.assertEqual(resolved["attributes"]["font_family"], "StyleFont")
        font_record = next(item for item in resolved["overrides"] if item["attribute_path"] == "font_family")
        self.assertEqual(font_record["before"], "TemplateFont")
        self.assertEqual(font_record["after"], "StyleFont")
        self.assertEqual(font_record["source_type"], "style")
        self.assertEqual(font_record["package_id"], self.style["style_id"])

    def test_compiler_emits_expected_layout_objects_and_editability(self) -> None:
        style_template = create_design_snapshot(
            self.style,
            self.template,
            preview_artifact_hash="sha256:" + "b" * 64,
        ).confirm("test-user", confirmed_at="2026-01-01T00:00:00+00:00")
        for page in self.fixture["pages"]:
            ir = compile_page(page, style=self.style, template=self.template, design_snapshot=style_template)
            self.assertEqual(ir.editability["page"], "structured_editable")
            self.assertEqual(ir.editability["artifact"], "structured_editable")
            self.assertEqual(ir.from_dict(ir.to_dict()).content_hash, ir.content_hash)
        cover_ir = compile_page(self.fixture["pages"][0], style=self.style, template=self.template, design_snapshot=style_template)
        self.assertEqual(cover_ir.editability["hero-grid"], "visual_only")
        process_ir = compile_page(self.fixture["pages"][2], style=self.style, template=self.template, design_snapshot=style_template)
        self.assertEqual(sum(item["kind"] == "connector" for item in process_ir.objects), 6)

    def test_unconfirmed_style_template_is_blocked(self) -> None:
        snapshot = create_design_snapshot(self.style, self.template, preview_artifact_hash="sha256:" + "c" * 64)
        with self.assertRaises(DesignConfirmationRequired):
            compile_page(self.fixture["pages"][0], style=self.style, template=self.template, design_snapshot=snapshot)

    def test_template_capacity_and_protected_assets_fail_without_mutating_contract(self) -> None:
        page = self.fixture["pages"][0].to_dict()
        original = deepcopy(page)
        template = deepcopy(self.template)
        template["capacity"] = {**template["capacity"], "cover": 1}
        with self.assertRaises(TemplateCapacityExceeded):
            compile_template_page(page, template)
        self.assertEqual(page, original)
        page["proposed_changes"] = ["page_number"]
        with self.assertRaises(ProtectedAssetConflict):
            compile_template_page(page, self.template)

    def test_style_capabilities_and_protected_assets_are_enforced(self) -> None:
        reserved_style = deepcopy(self.style)
        reserved_style["tokens"] = {**reserved_style["tokens"], "background": "#ABCDEF"}
        reserved_style["capability_matrix"] = {
            **reserved_style["capability_matrix"],
            "background": "reserved_not_applied",
        }
        resolved = resolve_design_attributes({}, self.template, reserved_style)
        self.assertEqual(resolved["attributes"]["background"], "#FFFFFF")
        self.assertNotEqual(
            next(item for item in resolved["overrides"] if item["attribute_path"] == "background")["source_type"],
            "style",
        )

        protected_style = deepcopy(self.style)
        protected_style["tokens"] = {
            **protected_style["tokens"],
            "footer_legal": "replaced",
            "master_background": "replaced",
        }
        with self.assertRaises(ProtectedAssetConflict):
            resolve_design_attributes({}, self.template, protected_style)

    def test_compile_page_rejects_forged_confirmed_snapshot_mapping(self) -> None:
        confirmed = create_design_snapshot(
            self.style,
            self.template,
            preview_artifact_hash="sha256:" + "d" * 64,
        ).confirm("test-user", confirmed_at="2026-01-01T00:00:00+00:00")
        forged = confirmed.to_dict()
        with self.assertRaises(DesignConfirmationRequired):
            compile_page(
                self.fixture["pages"][0],
                style=self.style,
                template=self.template,
                design_snapshot=forged,
            )
        forged["content_hash"] = "sha256:" + "0" * 64
        with self.assertRaises(V2ContractError):
            compile_page(self.fixture["pages"][0], style=self.style, template=self.template, design_snapshot=forged)

    def test_template_intake_extracts_skeleton_and_verifies_source_hash(self) -> None:
        skeleton = PptMasterAdapter.extract_template_skeleton(self.fixture["template_file"])
        self.assertEqual((skeleton.page_width_pt, skeleton.page_height_pt), (960.0, 540.0))
        self.assertTrue(skeleton.layouts)
        self.assertEqual({item["id"] for item in skeleton.protected_assets}, {"page_number", "footer_legal", "master_background"})
        with self.assertRaises(V2ContractError):
            PptMasterAdapter.extract_template_skeleton(
                self.fixture["template_file"],
                source_artifact_hash="sha256:" + "0" * 64,
            )
