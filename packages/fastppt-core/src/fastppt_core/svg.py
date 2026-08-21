"""Deterministic editable SVG preview authoring from a page contract."""

from __future__ import annotations

import html
import re
from textwrap import wrap


def _lines(text: str, width: int, limit: int) -> list[str]:
    result: list[str] = []
    for raw in text.splitlines():
        clean = re.sub(r"^[\s*-]+", "", raw).strip()
        if not clean:
            continue
        result.extend(wrap(clean, width=width, break_long_words=False, break_on_hyphens=False) or [clean])
        if len(result) >= limit:
            break
    return result[:limit]


def render_page_svg(
    title: str,
    body: str,
    *,
    page_number: int,
    page_role: str = "content",
    accent: str = "#D14D3F",
    background: str = "#F7F8FA",
    layout: str = "title_body",
    hierarchy: str = "standard",
    image_data_uri: str | None = None,
) -> str:
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", accent) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", background):
        raise ValueError("SVG colors must use six-digit hexadecimal values")
    safe_title = html.escape(title.strip() or "Untitled")
    line_width = 29 if layout == "two_column" else 50
    body_lines = _lines(body, line_width, 9)
    title_size = 42 if hierarchy == "compact" else (54 if hierarchy == "emphasis" else (48 if len(title) <= 22 else 38))
    body_nodes = []
    if layout == "two_column":
        split = (len(body_lines) + 1) // 2
        for index, line in enumerate(body_lines):
            column = 0 if index < split else 1
            row = index if column == 0 else index - split
            x = 84 + column * 555
            y = 260 + row * 48
            body_nodes.append(
                f'<circle cx="{x + 8}" cy="{y - 9}" r="5" fill="{accent}"/><text x="{x + 28}" y="{y}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="24" fill="#25292D">{html.escape(line)}</text>'
            )
    elif layout == "three_stage_flow":
        stages = (body_lines + ["Next stage"] * 3)[:3]
        for index, line in enumerate(stages):
            x = 84 + index * 370
            body_nodes.append(f'<rect x="{x}" y="270" width="320" height="170" rx="8" fill="#FFFFFF" stroke="#D8DCE1" stroke-width="2"/><text x="{x + 24}" y="330" font-family="Microsoft YaHei, Arial, sans-serif" font-size="24" fill="#25292D">{html.escape(line)}</text>')
            if index < 2:
                body_nodes.append(f'<line x1="{x + 325}" y1="355" x2="{x + 360}" y2="355" stroke="{accent}" stroke-width="5"/>')
    elif layout == "timeline":
        body_nodes.append(f'<line x1="120" y1="355" x2="1160" y2="355" stroke="{accent}" stroke-width="5"/>')
        for index, line in enumerate((body_lines + ["Milestone"] * 4)[:4]):
            x = 140 + index * 320
            body_nodes.append(f'<circle cx="{x}" cy="355" r="14" fill="{accent}"/><text x="{x - 50}" y="410" font-family="Microsoft YaHei, Arial, sans-serif" font-size="21" fill="#25292D">{html.escape(line)}</text>')
    elif layout == "metric_grid":
        for index, line in enumerate((body_lines + ["Metric"] * 4)[:4]):
            x, y = 84 + (index % 2) * 555, 245 + (index // 2) * 165
            body_nodes.append(f'<rect x="{x}" y="{y}" width="510" height="130" rx="8" fill="#FFFFFF" stroke="#D8DCE1" stroke-width="2"/><text x="{x + 24}" y="{y + 72}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="28" font-weight="700" fill="{accent}">{html.escape(line)}</text>')
    else:
        for index, line in enumerate(body_lines):
            y = 260 + index * 42
            body_nodes.append(
                f'<circle cx="92" cy="{y - 9}" r="5" fill="{accent}"/><text x="112" y="{y}" font-family="Microsoft YaHei, Arial, sans-serif" font-size="25" fill="#25292D">{html.escape(line)}</text>'
            )
    if image_data_uri:
        body_nodes.append(f'<image x="760" y="245" width="420" height="300" preserveAspectRatio="xMidYMid slice" href="{html.escape(image_data_uri, quote=True)}"/>')
    if not body_nodes:
        body_nodes.append('<text x="84" y="290" font-family="Microsoft YaHei, Arial, sans-serif" font-size="25" fill="#626A73">Content pending</text>')
    return "\n".join(
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" data-pptx-page-role="{html.escape(page_role)}" data-fastppt-layout="{html.escape(layout)}" data-fastppt-hierarchy="{html.escape(hierarchy)}">',
            f'<rect id="page-background" data-pptx-role="background" width="1280" height="720" fill="{background}"/>',
            f'<rect id="accent-rail" data-pptx-role="decoration" x="0" y="0" width="18" height="720" fill="{accent}"/>',
            '<g id="header" data-pptx-bounds="84 60 200 40"><text x="84" y="88" font-family="Arial, sans-serif" font-size="16" fill="#626A73">FASTPPT</text></g>',
            '<g id="page-content" data-pptx-bounds="84 120 1112 500">',
            f'<text x="84" y="178" font-family="Microsoft YaHei, Arial, sans-serif" font-size="{title_size}" font-weight="700" fill="#171A1D">{safe_title}</text>',
            f'<rect x="84" y="210" width="96" height="6" fill="{accent}"/>',
            *body_nodes,
            '</g>',
            '<g id="page-footer" data-pptx-role="footer" data-pptx-bounds="84 650 1112 55"><line x1="84" y1="662" x2="1196" y2="662" stroke="#D8DCE1" stroke-width="2"/>',
            f'<text id="page-number-text" data-pptx-role="page-number" x="1156" y="692" font-family="Arial, sans-serif" font-size="17" fill="#626A73">{page_number:02d}</text></g>',
            '</svg>',
        )
    )
