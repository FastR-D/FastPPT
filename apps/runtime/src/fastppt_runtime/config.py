"""Strict environment-to-runtime configuration assembly."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Mapping

from fastppt_agent_harness.harness import AgentBackend, AgentSettings, EndpointMode
from fastppt_agent_harness.image import ImageEndpointMode, ImageProtocol, ImageSettings
from fastppt_core.paths import repository_root


class ConfigurationError(ValueError):
    pass


class DeploymentMode(StrEnum):
    LOCAL = "local"
    SERVER = "server"


def _required(environment: Mapping[str, str], key: str) -> str:
    value = environment.get(key, "").strip()
    if not value:
        raise ConfigurationError(f"{key} is required")
    return value


def _directory(value: str, root: Path) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else root / path).resolve()


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class RuntimeSettings:
    deployment_mode: DeploymentMode
    host: str
    port: int
    repository_root: Path
    data_dir: Path
    temp_dir: Path
    export_dir: Path
    metadata_store: str
    database_url: str | None
    artifact_store: str
    queue_backend: str
    auth_mode: str
    session_secret: str | None = field(default=None, repr=False)
    admin_email: str | None = None
    admin_password: str | None = field(default=None, repr=False)
    admin_bootstrap_token: str | None = field(default=None, repr=False)
    cors_origins: tuple[str, ...] = ()
    s3_endpoint: str | None = None
    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_access_key: str | None = field(default=None, repr=False)
    s3_secret_key: str | None = field(default=None, repr=False)
    render_backend: str = "unavailable"
    billing_mode: str = "disabled"
    test_fixtures_enabled: bool = False
    agent: AgentSettings = field(
        default_factory=lambda: AgentSettings(
            backend=AgentBackend.UNCONFIGURED,
            model="unconfigured",
        )
    )
    image: ImageSettings = field(default_factory=ImageSettings)

    @property
    def production(self) -> bool:
        return self.deployment_mode == DeploymentMode.SERVER

    @property
    def agent_production(self) -> bool:
        """Whether Agent calls must satisfy production-provider requirements."""
        return self.production and not (
            self.test_fixtures_enabled and self.agent.backend == AgentBackend.DETERMINISTIC_TEST
        )

    @classmethod
    def load(
        cls,
        environment: Mapping[str, str] | None = None,
        *,
        root: Path | None = None,
    ) -> "RuntimeSettings":
        env = dict(os.environ if environment is None else environment)
        repo = (root or repository_root()).resolve()
        try:
            mode = DeploymentMode(env.get("FASTPPT_DEPLOYMENT_MODE", "local").strip().lower())
        except ValueError as exc:
            raise ConfigurationError("FASTPPT_DEPLOYMENT_MODE must be local or server") from exc
        host = env.get("FASTPPT_HOST", "127.0.0.1" if mode == DeploymentMode.LOCAL else "0.0.0.0").strip()
        try:
            port = int(env.get("FASTPPT_PORT", "43110"))
        except ValueError as exc:
            raise ConfigurationError("FASTPPT_PORT must be an integer") from exc
        if not 1 <= port <= 65535:
            raise ConfigurationError("FASTPPT_PORT is outside the valid range")

        data_dir = _directory(env.get("FASTPPT_DATA_DIR", "./var/data"), repo)
        temp_dir = _directory(env.get("FASTPPT_TEMP_DIR", "./var/tmp"), repo)
        export_dir = _directory(env.get("FASTPPT_EXPORT_DIR", "./var/exports"), repo)
        render_backend = env.get("FASTPPT_RENDER_BACKEND", "unavailable").strip().lower()
        if render_backend not in {"powerpoint", "unavailable"}:
            raise ConfigurationError("FASTPPT_RENDER_BACKEND must be powerpoint or unavailable")

        if mode == DeploymentMode.LOCAL:
            metadata_store = "sqlite"
            database_url = None
            artifact_store = "filesystem"
            queue_backend = "local"
            auth_mode = env.get("FASTPPT_AUTH_MODE", "local_trusted").strip().lower()
            if not _is_loopback(host) and auth_mode == "local_trusted":
                raise ConfigurationError("Non-loopback local binding requires session authentication")
            session_secret = env.get("FASTPPT_SESSION_SECRET")
            admin_email = None
            admin_password = None
            admin_bootstrap_token = None
            s3_values = (None,) * 5
        else:
            metadata_store = "postgres"
            database_url = _required(env, "FASTPPT_DATABASE_URL")
            if not database_url.startswith(("postgresql://", "postgres://")):
                raise ConfigurationError("FASTPPT_DATABASE_URL must be a PostgreSQL URL")
            artifact_store = "s3"
            queue_backend = "postgres"
            auth_mode = "session"
            session_secret = _required(env, "FASTPPT_SESSION_SECRET")
            if len(session_secret) < 32:
                raise ConfigurationError("FASTPPT_SESSION_SECRET must contain at least 32 characters")
            admin_email = env.get("FASTPPT_ADMIN_EMAIL") or None
            admin_password = env.get("FASTPPT_ADMIN_PASSWORD") or None
            admin_bootstrap_token = env.get("FASTPPT_ADMIN_BOOTSTRAP_TOKEN") or None
            if admin_password and (not admin_email or len(admin_password) < 12):
                raise ConfigurationError("FASTPPT_ADMIN_EMAIL and an administrator password of at least 12 characters must be provided together")
            if not admin_password and (not admin_bootstrap_token or len(admin_bootstrap_token) < 24):
                raise ConfigurationError("Server mode requires FASTPPT_ADMIN_BOOTSTRAP_TOKEN when no initial administrator password is configured")
            s3_values = (
                _required(env, "FASTPPT_S3_ENDPOINT"),
                _required(env, "FASTPPT_S3_BUCKET"),
                env.get("FASTPPT_S3_REGION", "us-east-1").strip(),
                _required(env, "FASTPPT_S3_ACCESS_KEY"),
                _required(env, "FASTPPT_S3_SECRET_KEY"),
            )
            if not s3_values[0].startswith("https://") and env.get("FASTPPT_ALLOW_INSECURE_S3") != "1":
                raise ConfigurationError("Server S3 endpoint must use HTTPS")

        try:
            backend = AgentBackend(env.get("FASTPPT_AGENT_BACKEND", "unconfigured").strip().lower())
            endpoint_mode = EndpointMode(env.get("FASTPPT_MODEL_ENDPOINT_MODE", "official").strip().lower())
        except ValueError as exc:
            raise ConfigurationError("Agent backend or endpoint mode is invalid") from exc
        try:
            timeout_seconds = int(env.get("FASTPPT_MODEL_TIMEOUT_SECONDS", "180"))
            default_model = "unconfigured" if backend == AgentBackend.UNCONFIGURED else ("fastppt-deterministic" if backend == AgentBackend.DETERMINISTIC_TEST else "")
            agent = AgentSettings(
                backend=backend,
                model=env.get("FASTPPT_MODEL", default_model).strip(),
                endpoint_mode=endpoint_mode,
                base_url=env.get("FASTPPT_MODEL_BASE_URL") or None,
                api_key=env.get("FASTPPT_MODEL_API_KEY") or None,
                reasoning_effort=env.get("FASTPPT_MODEL_REASONING_EFFORT", "medium").strip(),
                timeout_seconds=timeout_seconds,
            )
            test_fixtures_enabled = env.get("FASTPPT_ENABLE_TEST_FIXTURES") == "1"
            server_integration_fixtures = (
                mode == DeploymentMode.SERVER
                and test_fixtures_enabled
                and env.get("FASTPPT_SERVER_INTEGRATION") == "1"
            )
            deterministic_test_agent = backend == AgentBackend.DETERMINISTIC_TEST and test_fixtures_enabled
            if mode == DeploymentMode.SERVER and deterministic_test_agent and env.get("FASTPPT_SERVER_INTEGRATION") != "1":
                raise ConfigurationError(
                    "The deterministic Agent is only allowed for explicit server integration runs"
                )
            if backend == AgentBackend.DETERMINISTIC_TEST and not test_fixtures_enabled:
                raise ConfigurationError("The deterministic Agent requires FASTPPT_ENABLE_TEST_FIXTURES=1")
            if backend != AgentBackend.UNCONFIGURED:
                agent.validate(production=mode == DeploymentMode.SERVER and not deterministic_test_agent)
        except Exception as exc:
            raise ConfigurationError(str(exc)) from exc

        cors = tuple(
            item.strip()
            for item in env.get("FASTPPT_CORS_ORIGINS", "").split(",")
            if item.strip()
        )
        if mode == DeploymentMode.SERVER and not cors:
            raise ConfigurationError("FASTPPT_CORS_ORIGINS is required in server mode")
        try:
            image_endpoint_mode = ImageEndpointMode(env.get("FASTPPT_IMAGE_ENDPOINT_MODE", "official").strip().lower())
            image_protocol = ImageProtocol(env.get("FASTPPT_IMAGE_PROTOCOL", "openai_images").strip().lower())
            image = ImageSettings(
                model=env.get("FASTPPT_IMAGE_MODEL", "gpt-image-2").strip(),
                endpoint_mode=image_endpoint_mode,
                protocol=image_protocol,
                base_url=env.get("FASTPPT_IMAGE_BASE_URL") or None,
                api_key=env.get("FASTPPT_IMAGE_API_KEY") or env.get("FASTPPT_MODEL_API_KEY") or None,
                timeout_seconds=int(env.get("FASTPPT_IMAGE_TIMEOUT_SECONDS", "180")),
            )
            image.validate(production=mode == DeploymentMode.SERVER and not server_integration_fixtures)
        except Exception as exc:
            raise ConfigurationError(str(exc)) from exc
        return cls(
            deployment_mode=mode,
            host=host,
            port=port,
            repository_root=repo,
            data_dir=data_dir,
            temp_dir=temp_dir,
            export_dir=export_dir,
            metadata_store=metadata_store,
            database_url=database_url,
            artifact_store=artifact_store,
            queue_backend=queue_backend,
            auth_mode=auth_mode,
            session_secret=session_secret,
            admin_email=admin_email,
            admin_password=admin_password,
            admin_bootstrap_token=admin_bootstrap_token,
            cors_origins=cors,
            s3_endpoint=s3_values[0],
            s3_bucket=s3_values[1],
            s3_region=s3_values[2],
            s3_access_key=s3_values[3],
            s3_secret_key=s3_values[4],
            render_backend=render_backend,
            billing_mode="disabled",
            test_fixtures_enabled=test_fixtures_enabled,
            agent=agent,
            image=image,
        )

    def prepare_directories(self) -> None:
        for directory in (self.data_dir, self.temp_dir, self.export_dir):
            directory.mkdir(parents=True, exist_ok=True)
            if not directory.is_dir():
                raise ConfigurationError("A configured runtime directory is unavailable")

    def public_summary(self) -> dict[str, object]:
        return {
            "deployment_mode": self.deployment_mode.value,
            "metadata_store": self.metadata_store,
            "artifact_store": self.artifact_store,
            "queue_backend": self.queue_backend,
            "auth_mode": self.auth_mode,
            "render_backend": self.render_backend,
            "agent_backend": self.agent.backend.value,
            "agent_configured": self.agent.backend != AgentBackend.UNCONFIGURED,
            "model": self.agent.model,
            "model_endpoint_mode": self.agent.endpoint_mode.value,
            "image_model": self.image.model,
            "image_endpoint_mode": self.image.endpoint_mode.value,
            "image_configured": bool(self.image.api_key),
            "billing_mode": self.billing_mode,
        }
