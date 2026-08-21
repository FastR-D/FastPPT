"""One fail-closed interface over supported agent SDKs."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse


class AgentBackend(StrEnum):
    CODEX = "codex"
    CLAUDE_CODE = "claude_code"
    DETERMINISTIC_TEST = "deterministic_test"


class EndpointMode(StrEnum):
    OFFICIAL = "official"
    RELAY = "relay"


class AgentError(RuntimeError):
    pass


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
        if production and self.backend == AgentBackend.DETERMINISTIC_TEST:
            raise AgentError("The deterministic test agent is disabled in production")
        if production and not self.api_key:
            raise AgentError("Production agent configuration requires an API key")
        if not 1 <= self.timeout_seconds <= 3600:
            raise AgentError("Agent timeout must be between 1 and 3600 seconds")
        efforts = {
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
                raise AgentError("Codex SDK request timed out") from exc
        try:
            envelope = json.loads(stdout.decode("utf-8"))
        except json.JSONDecodeError as exc:
            message = stderr.decode("utf-8", errors="replace").strip()
            raise AgentError(message or "Codex SDK returned invalid JSON") from exc
        if process.returncode or not envelope.get("ok"):
            raise AgentError(str(envelope.get("error") or "Codex SDK request failed"))
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
                raise AgentError("Claude Code SDK request timed out") from exc
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
