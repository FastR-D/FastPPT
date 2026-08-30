#!/usr/bin/env python3
"""Render and verify the task-one deck with Microsoft PowerPoint."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "ppt-master-adapter" / "src"))

from fastppt_ppt_master import PptMasterAdapter  # noqa: E402


def canonical_hash(value: dict) -> str:
    payload = {**value, "content_hash": ""}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def file_hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def compare_images(golden_path: Path, actual_path: Path, rgb_threshold: int) -> tuple[float, float]:
    with Image.open(golden_path) as golden_source, Image.open(actual_path) as actual_source:
        golden = golden_source.convert("RGB")
        actual = actual_source.convert("RGB")
        if golden.size != actual.size:
            raise ValueError(f"render dimensions changed: expected {golden.size}, received {actual.size}")
        count = golden.width * golden.height
        sum_left = sum_right = sum_left_sq = sum_right_sq = sum_product = 0.0
        changed = 0
        for left, right in zip(golden.get_flattened_data(), actual.get_flattened_data(), strict=True):
            left_luma = 0.299 * left[0] + 0.587 * left[1] + 0.114 * left[2]
            right_luma = 0.299 * right[0] + 0.587 * right[1] + 0.114 * right[2]
            sum_left += left_luma
            sum_right += right_luma
            sum_left_sq += left_luma * left_luma
            sum_right_sq += right_luma * right_luma
            sum_product += left_luma * right_luma
            if max(abs(left[channel] - right[channel]) for channel in range(3)) > rgb_threshold:
                changed += 1
        mean_left = sum_left / count
        mean_right = sum_right / count
        variance_left = max(0.0, sum_left_sq / count - mean_left * mean_left)
        variance_right = max(0.0, sum_right_sq / count - mean_right * mean_right)
        covariance = sum_product / count - mean_left * mean_right
        c1 = (0.01 * 255) ** 2
        c2 = (0.03 * 255) ** 2
        ssim = (
            (2 * mean_left * mean_right + c1)
            * (2 * covariance + c2)
            / ((mean_left * mean_left + mean_right * mean_right + c1) * (variance_left + variance_right + c2))
        )
        return ssim, changed / count


def render_powerpoint(pptx_path: Path, output_dir: Path, width: int, height: int) -> str:
    try:
        import win32com.client
    except ImportError as exc:
        raise RuntimeError("pywin32 is required for authoritative PowerPoint rendering") from exc
    output_dir.mkdir(parents=True, exist_ok=True)
    for existing in output_dir.glob("slide-*.png"):
        existing.unlink()
    application = None
    presentation = None
    try:
        application = win32com.client.DispatchEx("PowerPoint.Application")
        application.Visible = 1
        presentation = application.Presentations.Open(str(pptx_path), True, False, False)
        for index, slide in enumerate(presentation.Slides, 1):
            slide.Export(str(output_dir / f"slide-{index}.png"), "PNG", width, height)
        return str(application.Version)
    finally:
        if presentation is not None:
            presentation.Close()
        if application is not None:
            application.Quit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    readiness = manifest.get("powerpoint_readiness") or {}
    if readiness.get("status") == "skipped":
        print(json.dumps({"status": "skipped", "reason": readiness.get("reason")}, ensure_ascii=False))
        return 0
    if readiness.get("status") != "ready":
        raise SystemExit("PowerPoint readiness must be ready or skipped")

    pptx = manifest.get("pptx_artifact")
    if not isinstance(pptx, dict):
        raise SystemExit("PowerPoint readiness is ready but no PPTX artifact exists")
    pptx_path = (manifest_path.parent / str(pptx.get("path") or "")).resolve()
    if not pptx_path.is_file() or file_hash(pptx_path) != pptx.get("sha256"):
        raise SystemExit("PPTX artifact bytes do not match the manifest")
    with zipfile.ZipFile(pptx_path) as archive:
        slides = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
    if len(slides) != 3:
        raise SystemExit("task-one PPTX must contain exactly three slides")
    offenders = PptMasterAdapter._full_slide_rasters(pptx_path)
    if offenders:
        raise SystemExit(f"full-slide raster is forbidden: {offenders}")

    metadata_path = ROOT / "tests" / "fixtures" / "v2" / "task1" / "powerpoint-golden.json"
    if not metadata_path.is_file():
        print(json.dumps({"status": "unverified", "reason": "PNG Golden metadata is missing"}, ensure_ascii=False))
        return 0
    golden = json.loads(metadata_path.read_text(encoding="utf-8"))
    if golden.get("content_hash") != canonical_hash(golden):
        raise SystemExit("PowerPoint Golden metadata content hash is invalid")
    detected_major = str(readiness.get("version") or "")
    if golden.get("powerpoint_major_version") != detected_major:
        print(
            json.dumps(
                {
                    "status": "unverified",
                    "reason": f"No PNG Golden for PowerPoint {detected_major}",
                    "available_version": golden.get("powerpoint_major_version"),
                },
                ensure_ascii=False,
            )
        )
        return 0
    if golden.get("input_pptx_sha256") != file_hash(pptx_path):
        raise SystemExit("PowerPoint Golden is not bound to the generated PPTX hash")

    render = golden.get("render") or {}
    thresholds = golden.get("thresholds") or {}
    width, height = int(render.get("width") or 0), int(render.get("height") or 0)
    ssim_min = float(thresholds.get("ssim_min") or 0)
    rgb_threshold = int(thresholds.get("rgb_delta_threshold") or -1)
    max_changed_ratio = float(thresholds.get("max_changed_pixel_ratio") or -1)
    if width <= 0 or height <= 0 or not 0 < ssim_min <= 1 or rgb_threshold < 0 or not 0 <= max_changed_ratio <= 1:
        raise SystemExit("PowerPoint Golden thresholds or render dimensions are invalid")

    output_dir = manifest_path.parent / "powerpoint-authoritative"
    office_version = render_powerpoint(pptx_path, output_dir, width, height)
    if not office_version.startswith(detected_major + ".") and office_version != detected_major:
        raise SystemExit("PowerPoint COM version does not match readiness evidence")
    results = []
    failed = False
    fixture_root = metadata_path.parent
    for index, descriptor in enumerate(golden.get("slides") or [], 1):
        baseline = (fixture_root / str(descriptor.get("path") or "")).resolve()
        actual = output_dir / f"slide-{index}.png"
        try:
            baseline.relative_to(fixture_root.resolve())
        except ValueError as exc:
            raise SystemExit("PowerPoint Golden path escapes the fixture") from exc
        if not baseline.is_file() or file_hash(baseline) != descriptor.get("sha256"):
            raise SystemExit(f"PowerPoint Golden slide {index} hash is invalid")
        if not actual.is_file():
            raise SystemExit(f"PowerPoint did not render slide {index}")
        ssim, changed_ratio = compare_images(baseline, actual, rgb_threshold)
        passed = ssim >= ssim_min and changed_ratio <= max_changed_ratio
        failed = failed or not passed
        results.append(
            {
                "page_id": descriptor.get("page_id"),
                "png_path": str(actual.relative_to(manifest_path.parent)).replace("\\", "/"),
                "png_sha256": file_hash(actual),
                "ssim": round(ssim, 8),
                "changed_pixel_ratio": round(changed_ratio, 8),
                "status": "verified" if passed else "failed",
            }
        )
    if len(results) != 3:
        raise SystemExit("PowerPoint Golden metadata must contain exactly three slides")

    report = {
        "schema_version": "2.0.0",
        "required_capabilities": ["authoritative_render"],
        "status": "failed" if failed else "verified",
        "input_pptx_sha256": file_hash(pptx_path),
        "powerpoint_probe": {
            "status": "ready",
            "version": office_version,
            "detected_version": readiness.get("detected_version"),
        },
        "golden_metadata_sha256": file_hash(metadata_path),
        "thresholds": thresholds,
        "slides": results,
        "content_hash": "",
    }
    report["content_hash"] = canonical_hash(report)
    report_path = manifest_path.parent / "powerpoint-qa.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
