"""Lease-based execution for document, operation, and export jobs."""

from __future__ import annotations

import logging
import socket
import time
import uuid
from dataclasses import dataclass

from fastppt_runtime.bootstrap import Runtime, build_runtime


LOGGER = logging.getLogger("fastppt.worker")
JOB_KINDS = ("parse_document", "analyze_source", "agent_run", "image_run", "reconstruct_page", "execute_operation", "export_project")


@dataclass(slots=True)
class Worker:
    runtime: Runtime
    worker_id: str

    @classmethod
    def create(cls, runtime: Runtime | None = None) -> "Worker":
        active = runtime or build_runtime()
        worker_id = f"worker-{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        return cls(active, worker_id)

    def heartbeat(self, status: str = "ready") -> None:
        self.runtime.store.heartbeat_worker(self.worker_id, "worker", status, {"job_kinds": JOB_KINDS})

    def run_once(self) -> bool:
        self.heartbeat()
        job = self.runtime.store.claim_job(self.worker_id, lease_seconds=120, kinds=JOB_KINDS)
        if not job:
            return False
        try:
            payload = job["payload"]
            if job["kind"] == "parse_document":
                self.runtime.service.parse_document_record(payload["owner_id"], job["project_id"], payload["document_id"])
            elif job["kind"] == "analyze_source":
                source = self.runtime.store.get_source_text(job["project_id"], payload["source_text_id"])
                if not source:
                    raise RuntimeError("SourceText not found")
                run = self.runtime.service.create_agent_run_record(
                    payload["owner_id"],
                    job["project_id"],
                    {
                        "role": "source_analyst",
                        "profile_id": payload.get("profile_id"),
                        "model": payload.get("model"),
                        "input_artifact_ids": [source["artifact_id"]],
                        "prompt": "Analyze the source text and return bounded facts and a concise summary.",
                        "metadata": {"source_text_id": source["source_text_id"], "source_sha256": source["sha256"]},
                        "idempotency_key": f"source-analysis:{source['source_text_id']}",
                    },
                )
                self.runtime.store.emit_event("source.analyzing", project_id=job["project_id"], payload={"source_text_id": source["source_text_id"], "agent_run_id": run["agent_run_id"]})
            elif job["kind"] == "agent_run":
                self.runtime.service.execute_agent_run_record(payload["owner_id"], job["project_id"], payload["agent_run_id"], payload)
            elif job["kind"] == "image_run":
                self.runtime.service.execute_image_run(payload["owner_id"], job["project_id"], payload["image_run_id"], payload)
            elif job["kind"] == "reconstruct_page":
                self.runtime.service.execute_reconstruction(
                    payload["owner_id"],
                    job["project_id"],
                    payload["page_id"],
                    payload["disclosure_sha256"],
                )
            elif job["kind"] == "execute_operation":
                self.runtime.service.execute_operation(payload["owner_id"], job["project_id"], payload["operation_id"])
            elif job["kind"] == "export_project":
                self.runtime.service.execute_export(payload["owner_id"], job["project_id"], payload["export_id"])
            else:
                raise RuntimeError("Unsupported job kind")
        except Exception as exc:
            LOGGER.exception("job failed", extra={"job_id": job["job_id"], "project_id": job["project_id"], "kind": job["kind"]})
            self.runtime.store.complete_job(job["job_id"], self.worker_id, error=exc.__class__.__name__)
            return True
        self.runtime.store.complete_job(job["job_id"], self.worker_id)
        return True

    def run_forever(self, poll_seconds: float = 1.0) -> None:
        while True:
            if not self.run_once():
                time.sleep(poll_seconds)
