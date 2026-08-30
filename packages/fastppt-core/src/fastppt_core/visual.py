"""Raster visual-preview authoring kept separate from editable SVG output."""

from __future__ import annotations

import io
import os
import textwrap
from pathlib import Path


def _font(size: int):
    from PIL import ImageFont

    candidates = ["DejaVuSans.ttf", "Arial.ttf"]
    windows = os.environ.get("WINDIR")
    if windows:
        candidates[:0] = [str(Path(windows) / "Fonts" / "msyh.ttc"), str(Path(windows) / "Fonts" / "arial.ttf")]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_visual_preview(
    title: str,
    body: str,
    *,
    page_number: int,
    accent: str = "#D14D3F",
    background: str = "#F7F8FA",
    layout: str = "title_body",
    image_content: bytes | None = None,
) -> bytes:
    from PIL import Image, ImageDraw, ImageOps

    image = Image.new("RGB", (1280, 720), background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 18, 720), fill=accent)
    draw.text((84, 60), "FASTPPT VISUAL", fill="#626A73", font=_font(18))
    draw.text((84, 116), title[:80] or "Untitled", fill="#171A1D", font=_font(48))
    draw.rectangle((84, 205, 180, 211), fill=accent)
    lines: list[str] = []
    for raw in body.splitlines():
        lines.extend(textwrap.wrap(raw.strip(), width=42, break_long_words=False) or ([raw.strip()] if raw.strip() else []))
    lines = lines[:8]
    if image_content:
        try:
            source = Image.open(io.BytesIO(image_content)).convert("RGB")
            fitted = ImageOps.fit(source, (420, 300), method=Image.Resampling.LANCZOS)
            image.paste(fitted, (760, 245))
            lines = lines[:5]
        except Exception:
            image_content = None
    if layout in {"three_stage_flow", "timeline", "metric_grid"}:
        columns = 3 if layout != "metric_grid" else 2
        rows = 1 if columns == 3 else 2
        width = 320 if columns == 3 else 500
        for index in range(columns * rows):
            x = 84 + (index % columns) * (width + 50)
            y = 270 + (index // columns) * 160
            draw.rounded_rectangle((x, y, x + width, y + 120), radius=8, fill="#FFFFFF", outline="#D8DCE1", width=2)
            label = lines[index] if index < len(lines) else "Content"
            draw.text((x + 20, y + 42), label[:32], fill="#25292D", font=_font(22))
    else:
        for index, line in enumerate(lines):
            y = 255 + index * 44
            draw.ellipse((84, y + 6, 94, y + 16), fill=accent)
            draw.text((112, y), line, fill="#25292D", font=_font(25))
    draw.line((84, 662, 1196, 662), fill="#D8DCE1", width=2)
    draw.text((1148, 674), f"{page_number:02d}", fill="#626A73", font=_font(18))
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()
