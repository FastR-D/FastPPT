"""Build the deployment-specific runtime without changing domain behavior."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from .artifacts import ArtifactStore, build_artifact_store
from .config import RuntimeSettings
from .service import ApplicationService
from .store import MetadataStore, build_store


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return "pbkdf2_sha256$310000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iterations, salt_value, digest_value = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_value)
        expected = base64.b64decode(digest_value)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


@dataclass(slots=True)
class Runtime:
    settings: RuntimeSettings
    store: MetadataStore
    artifacts: ArtifactStore
    service: ApplicationService
    local_user: dict[str, object] | None


def build_runtime(settings: RuntimeSettings | None = None) -> Runtime:
    configured = settings or RuntimeSettings.load()
    configured.prepare_directories()
    store = build_store(configured)
    artifacts = build_artifact_store(configured)
    local_user = None
    if configured.auth_mode == "local_trusted":
        local_user = store.ensure_local_user()
    elif configured.admin_email and configured.admin_password:
        existing = store.user_by_email(configured.admin_email)
        if not existing:
            store.create_user(configured.admin_email, "FastPPT Administrator", hash_password(configured.admin_password), role="admin")
    if configured.admin_bootstrap_token:
        store.ensure_admin_bootstrap_token(configured.admin_bootstrap_token)
    return Runtime(configured, store, artifacts, ApplicationService(configured, store, artifacts), local_user)
