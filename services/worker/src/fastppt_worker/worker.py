"""Lease-based execution for document, operation, and export jobs."""

from __future__ import annotations

import logging
import socket
import time
import uuid
from dataclasses import dataclass

from fastppt_runtime.bootstrap import Runtime, build_runtime


LOGGER = logging.getLogger("fastppt.worker")
JOB_KINDS = ("parse_document", "execute_operation", "export_project")


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
