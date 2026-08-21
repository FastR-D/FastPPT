"""Lease-based authoritative render job execution."""

from __future__ import annotations

import hashlib
import socket
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastppt_runtime.bootstrap import Runtime, build_runtime

from .powerpoint import PowerPointRenderer


@dataclass(slots=True)
class RenderWorker:
    runtime: Runtime
    renderer: PowerPointRenderer
    worker_id: str

    @classmethod
    def create(cls, runtime: Runtime | None = None) -> "RenderWorker":
        return cls(runtime or build_runtime(), PowerPointRenderer(), f"render-{socket.gethostname()}-{uuid.uuid4().hex[:8]}")

    def heartbeat(self) -> dict[str, str]:
        probe = self.renderer.probe()
        self.runtime.store.heartbeat_worker(self.worker_id, "render", probe["status"], probe)
        return probe

    def run_once(self) -> bool:
        probe = self.heartbeat()
        if probe["status"] != "ready":
            return False
        job = self.runtime.store.claim_job(self.worker_id, lease_seconds=300, kinds=("render_export",))
        if not job:
            return False
        try:
            payload = job["payload"]
            export = self.runtime.store.get_export(job["project_id"], payload["export_id"])
            if not export or not export.get("artifact_id"):
                raise RuntimeError("Export artifact is unavailable")
            if export["status"] == "ready" and export["qa"].get("render_status") == "passed":
                self.runtime.store.complete_job(job["job_id"], self.worker_id)
                return True
            content, _ = self.runtime.service.artifact_download(payload["owner_id"], job["project_id"], export["artifact_id"])
            pptx_hash = hashlib.sha256(content).hexdigest()
            with tempfile.TemporaryDirectory(prefix="fastppt-powerpoint-") as temp_name:
                pptx_path = Path(temp_name) / "input.pptx"
                render_dir = Path(temp_name) / "pages"
                pptx_path.write_bytes(content)
                result = self.renderer.render(pptx_path, render_dir)
                render_artifacts = []
                version_lock = export["version_lock"]
                if len(result.pages) != len(version_lock):
                    raise RuntimeError("Rendered page count does not match the export lock")
                for locked, rendered in zip(version_lock, result.pages, strict=True):
                    version = self.runtime.store.get_version(job["project_id"], locked["version_id"])
                    if not version or version["page_id"] != locked["page_id"]:
                        raise RuntimeError("Export lock references a missing page version")
                    artifact = self.runtime.service._record_artifact(job["project_id"], "render", rendered.path.read_bytes(), "image/png")
                    page_qa = version["qa"] | {"render_status": "passed", "powerpoint_version": result.powerpoint_version, "pptx_sha256": pptx_hash, "png_sha256": rendered.sha256}
                    self.runtime.store.update_version_render(job["project_id"], version["version_id"], artifact["artifact_id"], "ready", page_qa)
                    self.runtime.store.emit_event("preview.pptx.ready", project_id=job["project_id"], page_id=version["page_id"], version_id=version["version_id"], export_id=export["export_id"], payload={"artifact_id": artifact["artifact_id"]})
                    render_artifacts.append({"page_id": version["page_id"], "version_id": version["version_id"], "artifact_id": artifact["artifact_id"], "sha256": rendered.sha256})
            qa = export["qa"] | {"render_status": "passed", "powerpoint_version": result.powerpoint_version, "pptx_sha256": pptx_hash, "pages": render_artifacts}
            self.runtime.store.complete_export(job["project_id"], export["export_id"], export["artifact_id"], "ready", qa)
            self.runtime.store.complete_job(job["job_id"], self.worker_id)
        except Exception as exc:
            self.runtime.store.complete_job(job["job_id"], self.worker_id, error=exc.__class__.__name__)
            failed_job = self.runtime.store.get_job(job["job_id"])
            if failed_job and failed_job["status"] == "failed":
                export = self.runtime.store.get_export(job["project_id"], job["payload"]["export_id"])
                if export:
                    qa = export["qa"] | {"render_status": "failed", "render_error": exc.__class__.__name__}
                    self.runtime.store.complete_export(job["project_id"], export["export_id"], export.get("artifact_id"), "failed", qa)
                    self.runtime.store.emit_event("export.failed", project_id=job["project_id"], export_id=export["export_id"], payload={"reason": exc.__class__.__name__})
        return True

    def run_forever(self, poll_seconds: float = 2.0) -> None:
        while True:
            if not self.run_once():
                time.sleep(poll_seconds)
