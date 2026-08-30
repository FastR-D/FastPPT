#!/usr/bin/env python3
"""Run the offline v2 task-one fixture and publish verification artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "runtime" / "src"))

from fastppt_runtime.task1 import TASK1_PAGE_IDS, Task1Runner, load_task1_fixture  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("none-none", "style-only", "template-only", "style-template"), default="style-template")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "task1-verification")
    parser.add_argument("--idempotency-key", default="task1-fixture")
    args = parser.parse_args()
    fixture = load_task1_fixture()
    style = fixture["style"].to_dict()
    template = fixture["template"].to_dict()
    mode = args.mode.replace("-", "_")
    request = {
        "schema_version": "2.0.0",
        "project_id": "task1-fixture-project",
        "page_contract_ids": list(TASK1_PAGE_IDS),
        "selection": {
            "style_version_ref": {"id": style["style_id"], "version": style["version"], "content_hash": style["content_hash"], "capability_matrix": style["capability_matrix"]} if mode in {"style_only", "style_template"} else None,
            "template_version_ref": {"id": template["template_id"], "version": template["version"], "content_hash": template["content_hash"], "capability_matrix": {}} if mode in {"template_only", "style_template"} else None,
        },
        "expected_mode": mode,
        "idempotency_key": args.idempotency_key,
        "confirmed": False,
    }
    runner = Task1Runner(fixture_dir=fixture["root"])
    if mode == "style_template":
        preview = runner.preview(request, output_dir=args.output / "preview")
        request.update(
            {
                "confirmed": True,
                "preview_artifact_hash": preview.manifest["design_snapshot"]["preview_artifact_hash"],
                "confirmed_by": "task1-user",
                "confirmed_at": "2026-01-01T00:00:00+00:00",
            }
        )
    result = runner.run(request, output_dir=args.output)
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
