"""Render PPTX pages through installed Microsoft PowerPoint."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path


class PowerPointUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RenderedPage:
    index: int
    path: Path
    sha256: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class RenderResult:
    powerpoint_version: str
    pages: tuple[RenderedPage, ...]


class PowerPointRenderer:
    def probe(self) -> dict[str, str]:
        initialized = False
        app = None
        try:
            import pythoncom
            import win32com.client

            pythoncom.CoInitialize()
            initialized = True
            app = win32com.client.DispatchEx("PowerPoint.Application")
            version = str(app.Version)
            return {"status": "ready", "version": version}
        except Exception as exc:
            return {"status": "unavailable", "detail": exc.__class__.__name__}
        finally:
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
            if initialized:
                pythoncom.CoUninitialize()

    def render(self, pptx_path: Path, output_dir: Path, *, width: int = 1600, height: int = 900) -> RenderResult:
        try:
            import pythoncom
            import win32com.client
        except ImportError as exc:
            raise PowerPointUnavailable("pywin32 is required for authoritative rendering") from exc
        output_dir.mkdir(parents=True, exist_ok=True)
        pythoncom.CoInitialize()
        app = None
        presentation = None
        version = "unknown"
        slide_count = 0
        try:
            app = win32com.client.DispatchEx("PowerPoint.Application")
            version = str(app.Version)
            presentation = app.Presentations.Open(str(pptx_path.resolve()), ReadOnly=True, Untitled=False, WithWindow=False)
            slide_count = int(presentation.Slides.Count)
            presentation.Export(str(output_dir.resolve()), "PNG", width, height)
        except Exception as exc:
            raise PowerPointUnavailable(f"PowerPoint render failed: {exc.__class__.__name__}") from exc
        finally:
            if presentation is not None:
                try:
                    presentation.Close()
                except Exception:
                    pass
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
            pythoncom.CoUninitialize()
        images = sorted(
            (path for path in output_dir.iterdir() if path.suffix.casefold() == ".png"),
            key=lambda item: int("".join(filter(str.isdigit, item.stem)) or "0"),
        )
        pages = tuple(RenderedPage(index, path, hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size) for index, path in enumerate(images, 1))
        if len(pages) != slide_count:
            raise PowerPointUnavailable("PowerPoint did not render every slide")
        return RenderResult(version, pages)
