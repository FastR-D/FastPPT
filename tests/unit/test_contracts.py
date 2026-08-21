from unittest import TestCase

from fastppt_core.contracts import PlanValidationError, validate_plan


def payload(scope: str = "single", confirmation: bool = False) -> dict:
    return {
        "workflowMode": "pptx_improve",
        "targetScope": scope,
        "affectedPageIds": ["page_a"],
        "changes": [{"kind": "rewrite_text", "target": "title", "constraint": "one_line"}],
        "pageDelta": {"add": [], "remove": [], "split": [], "merge": []},
        "factImpact": {"added": [], "removed": [], "changed": []},
        "unsupported": [],
        "requiresConfirmation": confirmation,
        "confirmationReasons": ["multi_page_scope"] if confirmation else [],
        "estimatedUsage": {"amount": "unknown"},
    }


class PlanContractTests(TestCase):
    def test_single_low_risk_plan_can_execute_without_confirmation(self) -> None:
        plan = validate_plan(payload(), {"page_a"})
        self.assertFalse(plan.requires_confirmation)

    def test_server_rule_prevents_model_from_bypassing_confirmation(self) -> None:
        value = payload("multi", False)
        with self.assertRaises(PlanValidationError):
            validate_plan(value, {"page_a"})

    def test_unknown_page_and_tool_kind_are_rejected(self) -> None:
        value = payload()
        value["affectedPageIds"] = ["page_missing"]
        value["changes"] = [{"kind": "shell", "value": "ignored"}]
        with self.assertRaises(PlanValidationError):
            validate_plan(value, {"page_a"})

    def test_unexecutable_structural_and_text_changes_are_rejected(self) -> None:
        structural = payload()
        structural["pageDelta"]["remove"] = ["page_a"]
        with self.assertRaises(PlanValidationError):
            validate_plan(structural, {"page_a"})

        empty_rewrite = payload()
        empty_rewrite["changes"] = [{"kind": "rewrite_text", "target": "body"}]
        with self.assertRaises(PlanValidationError):
            validate_plan(empty_rewrite, {"page_a"})

        unknown_layout = payload(confirmation=True)
        unknown_layout["changes"] = [{"kind": "layout_change", "target": "layout", "value": "freeform"}]
        unknown_layout["confirmationReasons"] = ["visual_change"]
        with self.assertRaises(PlanValidationError):
            validate_plan(unknown_layout, {"page_a"})
