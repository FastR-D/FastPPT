"""One fail-closed interface over supported agent SDKs."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import ipaddress
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse


class AgentBackend(StrEnum):
    UNCONFIGURED = "unconfigured"
    CODEX = "codex"
    CLAUDE_CODE = "claude_code"
    DETERMINISTIC_TEST = "deterministic_test"


class EndpointMode(StrEnum):
    OFFICIAL = "official"
    RELAY = "relay"


class AgentError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "provider_protocol_error",
        retryable: bool = False,
        submission_unknown: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.submission_unknown = submission_unknown


@dataclass(frozen=True, slots=True)
class AgentSettings:
    backend: AgentBackend
    model: str
    endpoint_mode: EndpointMode = EndpointMode.OFFICIAL
    base_url: str | None = None
    api_key: str | None = field(default=None, repr=False)
    reasoning_effort: str = "medium"
    timeout_seconds: int = 180

    def validate(self, *, production: bool) -> None:
        if self.backend == AgentBackend.UNCONFIGURED:
            raise AgentError("No Agent provider is configured", code="profile_unavailable")
        if not self.model.strip():
            raise AgentError("A model name is required")
        if self.endpoint_mode == EndpointMode.RELAY and not self.base_url:
            raise AgentError("Relay mode requires a base URL")
        if self.endpoint_mode == EndpointMode.OFFICIAL and self.base_url:
            raise AgentError("Official endpoint mode cannot use a custom base URL")
        if self.base_url:
            parsed = urlparse(self.base_url)
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                raise AgentError("Model base URL must be an HTTPS origin without credentials")
            host = parsed.hostname or ""
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                address = None
            if host.lower() in {"localhost", "ip6-localhost"} or address and (address.is_private or address.is_loopback or address.is_link_local):
                raise AgentError("Model base URL cannot target a private or loopback address")
        if production and self.backend == AgentBackend.DETERMINISTIC_TEST:
            raise AgentError("The deterministic test agent is disabled in production")
        if production and not self.api_key:
            raise AgentError("Production agent configuration requires an API key")
        if not 1 <= self.timeout_seconds <= 3600:
            raise AgentError("Agent timeout must be between 1 and 3600 seconds")
        efforts = {
            AgentBackend.UNCONFIGURED: set(),
            AgentBackend.CODEX: {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"},
            AgentBackend.CLAUDE_CODE: {"low", "medium", "high", "xhigh", "max"},
            AgentBackend.DETERMINISTIC_TEST: {"low", "medium", "high"},
        }
        if self.reasoning_effort not in efforts[self.backend]:
            raise AgentError(f"Reasoning effort is invalid for {self.backend.value}")


@dataclass(frozen=True, slots=True)
class AgentRequest:
    prompt: str
    output_schema: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentResult:
    output: dict[str, Any]
    backend: str
    model: str
    thread_id: str | None = None
    usage: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class AgentContext:
    """Minimal context envelope passed to one logical role invocation."""

    role: str
    task_id: str
    artifact_ids: tuple[str, ...] = ()
    facts: tuple[dict[str, Any], ...] = ()
    page_contracts: tuple[dict[str, Any], ...] = ()
    summary: str = ""

    def digest(self) -> str:
        payload = json.dumps({
            "role": self.role,
            "task_id": self.task_id,
            "artifact_ids": self.artifact_ids,
            "facts": self.facts,
            "page_contracts": self.page_contracts,
            "summary": self.summary,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def to_metadata(self) -> dict[str, Any]:
        # A child receives only its role-scoped fields.  In particular, no
        # conversation history or binary image bytes are copied into prompts.
        return {
            "role": self.role,
            "task_id": self.task_id,
            "artifact_ids": list(self.artifact_ids),
            "facts": [dict(item) for item in self.facts],
            "page_contracts": [dict(item) for item in self.page_contracts],
            "summary": self.summary[:4000],
            "context_digest": self.digest(),
        }


class Adapter(Protocol):
    async def run(self, settings: AgentSettings, request: AgentRequest) -> AgentResult: ...


class DeterministicAdapter:
    async def run(self, settings: AgentSettings, request: AgentRequest) -> AgentResult:
        page_ids = list(request.metadata.get("page_ids") or ["page_test"])
        scope = request.metadata.get("target_scope", "single")
        affected = page_ids[:1] if scope == "single" else page_ids
        confirmation = scope != "single"
        return AgentResult(
            output={
                "workflowMode": request.metadata.get("workflow_mode", "page_entry"),
                "targetScope": scope,
                "affectedPageIds": affected,
                "changes": [{"kind": "rewrite_text", "target": "title", "constraint": "one_line"}],
                "pageDelta": {"add": [], "remove": [], "split": [], "merge": []},
                "factImpact": {"added": [], "removed": [], "changed": []},
                "unsupported": [],
                "requiresConfirmation": confirmation,
                "confirmationReasons": ["multi_page_scope"] if confirmation else [],
                "estimatedUsage": {"imageUnits": 0, "amount": 0, "currency": "CNY"},
            },
            backend=settings.backend.value,
            model=settings.model,
        )


class CodexSdkAdapter:
    def __init__(self) -> None:
        self._bridge = Path(__file__).resolve().parents[2] / "bridges" / "codex.mjs"

    async def run(self, settings: AgentSettings, request: AgentRequest) -> AgentResult:
        node = shutil.which("node")
        if not node:
            raise AgentError("Node.js is required by the Codex SDK adapter")
        if not self._bridge.is_file():
            raise AgentError("Codex SDK bridge is missing")
        with tempfile.TemporaryDirectory(prefix="fastppt-codex-") as workdir:
            payload = {
                "prompt": request.prompt,
                "outputSchema": request.output_schema,
                "model": settings.model,
                "baseUrl": settings.base_url,
                "apiKey": settings.api_key,
                "reasoningEffort": settings.reasoning_effort,
                "workingDirectory": workdir,
                "env": {"PATH": os.environ.get("PATH", "")},
            }
            process = await asyncio.create_subprocess_exec(
                node,
                str(self._bridge),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(json.dumps(payload).encode("utf-8")),
                    timeout=settings.timeout_seconds,
                )
            except TimeoutError as exc:
                process.kill()
                await process.wait()
                raise AgentError(
                    "Codex SDK request timed out",
                    code="provider_timeout",
                    retryable=True,
                    submission_unknown=True,
                ) from exc
        try:
            envelope = json.loads(stdout.decode("utf-8"))
        except json.JSONDecodeError as exc:
            message = stderr.decode("utf-8", errors="replace").strip()
            raise AgentError(message or "Codex SDK returned invalid JSON", code="provider_protocol_error") from exc
        if process.returncode or not envelope.get("ok"):
            message = str(envelope.get("error") or "Codex SDK request failed")
            lowered = message.casefold()
            code = "provider_auth_failed" if any(token in lowered for token in ("401", "403", "unauthorized", "api key", "authentication")) else "provider_protocol_error"
            raise AgentError(message, code=code, retryable=code != "provider_auth_failed")
        try:
            output = json.loads(envelope["output"])
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise AgentError("Codex SDK response did not contain a structured JSON plan") from exc
        return AgentResult(
            output=output,
            backend=settings.backend.value,
            model=settings.model,
            thread_id=envelope.get("threadId"),
            usage=envelope.get("usage"),
        )


class ClaudeCodeSdkAdapter:
    async def run(self, settings: AgentSettings, request: AgentRequest) -> AgentResult:
        try:
            from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
        except ImportError as exc:
            raise AgentError("Install the 'agents' extra to use Claude Code SDK") from exc

        environment = dict(os.environ)
        if settings.api_key:
            environment["ANTHROPIC_API_KEY"] = settings.api_key
        if settings.base_url:
            environment["ANTHROPIC_BASE_URL"] = settings.base_url
        response = ""
        structured_output: Any = None
        usage: dict[str, Any] | None = None
        session_id: str | None = None
        with tempfile.TemporaryDirectory(prefix="fastppt-claude-") as workdir:
            options = ClaudeAgentOptions(
                cwd=workdir,
                model=settings.model,
                tools=[],
                allowed_tools=[],
                permission_mode="dontAsk",
                max_turns=1,
                setting_sources=[],
                skills=[],
                env=environment,
                effort=settings.reasoning_effort,
                output_format={"type": "json_schema", "schema": request.output_schema},
            )
            try:
                async with asyncio.timeout(settings.timeout_seconds):
                    async for message in query(prompt=request.prompt, options=options):
                        if isinstance(message, ResultMessage):
                            if message.is_error:
                                raise AgentError("Claude Code SDK request failed")
                            response = message.result or ""
                            structured_output = message.structured_output
                            usage = message.usage
                            session_id = message.session_id
            except TimeoutError as exc:
                raise AgentError(
                    "Claude Code SDK request timed out",
                    code="provider_timeout",
                    retryable=True,
                    submission_unknown=True,
                ) from exc
        if isinstance(structured_output, dict):
            output = structured_output
        else:
            try:
                output = json.loads(response)
            except json.JSONDecodeError as exc:
                raise AgentError("Claude Code SDK response did not contain a structured JSON plan") from exc
        if not isinstance(output, dict):
            raise AgentError("Claude Code SDK structured output must be a JSON object")
        return AgentResult(
            output=output,
            backend=settings.backend.value,
            model=settings.model,
            thread_id=session_id,
            usage=usage,
        )


class AgentHarness:
    def __init__(self) -> None:
        self._adapters: dict[AgentBackend, Adapter] = {
            AgentBackend.CODEX: CodexSdkAdapter(),
            AgentBackend.CLAUDE_CODE: ClaudeCodeSdkAdapter(),
            AgentBackend.DETERMINISTIC_TEST: DeterministicAdapter(),
        }

    async def run(self, settings: AgentSettings, request: AgentRequest, *, production: bool) -> AgentResult:
        settings.validate(production=production)
        adapter = self._adapters.get(settings.backend)
        if not adapter:
            raise AgentError(f"Unsupported agent backend: {settings.backend}")
        return await adapter.run(settings, request)

    @staticmethod
    def isolate_context(context: dict[str, Any], *, role: str, task_id: str, allowed_keys: set[str] | None = None) -> AgentContext:
        """Create a bounded role context from a coordinator context.

        This is intentionally deterministic and testable without a provider.
        Callers must explicitly opt into keys; unknown data is discarded.
        """
        allowed = allowed_keys or {"artifact_ids", "facts", "page_contracts", "summary"}
        values = {key: context.get(key) for key in allowed}
        return AgentContext(
            role=role,
            task_id=task_id,
            artifact_ids=tuple(str(item) for item in (values.get("artifact_ids") or []) if isinstance(item, str)),
            facts=tuple(dict(item) for item in (values.get("facts") or []) if isinstance(item, dict)),
            page_contracts=tuple(dict(item) for item in (values.get("page_contracts") or []) if isinstance(item, dict)),
            summary=str(values.get("summary") or "")[:4000],
        )

    async def run_isolated(self, settings: AgentSettings, *, role: str, task_id: str, prompt: str, output_schema: dict[str, Any], context: dict[str, Any], production: bool, allowed_keys: set[str] | None = None) -> tuple[AgentResult, AgentContext]:
        scoped = self.isolate_context(context, role=role, task_id=task_id, allowed_keys=allowed_keys)
        request = AgentRequest(prompt, output_schema, scoped.to_metadata())
        return await self.run(settings, request, production=production), scoped

    def probe(self, settings: AgentSettings, *, production: bool) -> dict[str, Any]:
        try:
            settings.validate(production=production)
            available = True
            detail = "configured"
            if settings.backend == AgentBackend.CODEX:
                bridge = Path(__file__).resolve().parents[2] / "bridges" / "codex.mjs"
                sdk = Path(__file__).resolve().parents[2] / "node_modules" / "@openai" / "codex-sdk"
                available = bool(shutil.which("node")) and bridge.is_file() and sdk.is_dir()
                detail = "ready" if available else "Node.js, Codex SDK, or the bridge is missing"
            elif settings.backend == AgentBackend.CLAUDE_CODE:
                try:
                    __import__("claude_agent_sdk")
                except ImportError:
                    available = False
                    detail = "claude-agent-sdk is not installed"
            return {
                "status": "ready" if available else "unavailable",
                "backend": settings.backend.value,
                "model": settings.model,
                "endpoint_mode": settings.endpoint_mode.value,
                "detail": detail,
            }
        except AgentError as exc:
            return {"status": "misconfigured", "backend": settings.backend.value, "detail": str(exc)}
