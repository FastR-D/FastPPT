"""Provider-neutral GPT-image compatible adapter.

The adapter deliberately exposes a small domain contract.  It never accepts
filesystem paths and returns bytes plus provider metadata so the runtime can
register immutable Artifacts and Usage Ledger entries.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ImageEndpointMode(StrEnum):
    OFFICIAL = "official"
    RELAY = "relay"


class ImageProtocol(StrEnum):
    OPENAI_IMAGES = "openai_images"
    RELAY_COMPATIBLE = "relay_compatible"


class ImageAdapterError(RuntimeError):
    def __init__(self, message: str, *, code: str = "provider_protocol_error", retryable: bool = False, submission_unknown: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.submission_unknown = submission_unknown


@dataclass(frozen=True, slots=True)
class ImageSettings:
    model: str = "gpt-image-2"
    endpoint_mode: ImageEndpointMode = ImageEndpointMode.OFFICIAL
    protocol: ImageProtocol = ImageProtocol.OPENAI_IMAGES
    base_url: str | None = None
    api_key: str | None = field(default=None, repr=False)
    timeout_seconds: int = 180

    def validate(self, *, production: bool = False) -> None:
        if not self.model.strip():
            raise ImageAdapterError("Image model is required", code="validation_failed")
        if self.endpoint_mode == ImageEndpointMode.RELAY and not self.base_url:
            raise ImageAdapterError("Relay image endpoint requires a base URL", code="validation_failed")
        if self.endpoint_mode == ImageEndpointMode.OFFICIAL and self.base_url:
            raise ImageAdapterError("Official image endpoint cannot use a custom base URL", code="validation_failed")
        if self.base_url:
            parsed = urlparse(self.base_url)
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                raise ImageAdapterError("Image base URL must be an HTTPS origin without credentials", code="validation_failed")
            host = parsed.hostname or ""
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                address = None
            if host.lower() in {"localhost", "ip6-localhost"} or address and (address.is_private or address.is_loopback or address.is_link_local):
                raise ImageAdapterError("Image base URL cannot target a private or loopback address", code="validation_failed")
        if production and not self.api_key:
            raise ImageAdapterError("Production image configuration requires an API key", code="provider_auth_failed")
        if not 1 <= self.timeout_seconds <= 3600:
            raise ImageAdapterError("Image timeout must be between 1 and 3600 seconds", code="validation_failed")


@dataclass(frozen=True, slots=True)
class ImageRequest:
    prompt: str
    input_images: tuple[bytes, ...] = ()
    size: str = "1536x864"
    quality: str = "auto"
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ImageResult:
    images: tuple[bytes, ...]
    provider: str
    model: str
    provider_request_id: str | None = None
    usage: dict[str, object] = field(default_factory=dict)
    response_fingerprint: str | None = None


class OpenAIImageAdapter:
    """OpenAI Images API and HTTPS relay-compatible implementation."""

    def _endpoint(self, settings: ImageSettings, *, editing: bool = False) -> str:
        if settings.endpoint_mode == ImageEndpointMode.OFFICIAL:
            action = "edits" if editing else "generations"
            return f"https://api.openai.com/v1/images/{action}"
        base = (settings.base_url or "").rstrip("/")
        if base.endswith(("/images/generations", "/images/edits")):
            root = base.rsplit("/", 1)[0]
            return f"{root}/{'edits' if editing else 'generations'}"
        return f"{base}/v1/images/{'edits' if editing else 'generations'}"

    @staticmethod
    def _payload(settings: ImageSettings, request: ImageRequest) -> dict[str, object]:
        payload: dict[str, object] = {
            "model": settings.model,
            "prompt": request.prompt,
            "size": request.size,
            "quality": request.quality,
            "n": 1,
            "response_format": "b64_json",
        }
        if request.input_images:
            payload["images"] = [
                "data:image/png;base64," + base64.b64encode(item).decode("ascii")
                for item in request.input_images
            ]
        return payload

    @staticmethod
    def _image_media_type(content: bytes) -> str:
        if content.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if content.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
            return "image/webp"
        raise ImageAdapterError("Image edit input is not PNG, JPEG, or WebP", code="validation_failed")

    @classmethod
    def _multipart_body(cls, settings: ImageSettings, request: ImageRequest) -> tuple[bytes, str]:
        boundary = f"fastppt-{uuid.uuid4().hex}"
        chunks: list[bytes] = []

        def field(name: str, value: str) -> None:
            chunks.extend([
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("ascii"),
                value.encode("utf-8"),
                b"\r\n",
            ])

        for name, value in (
            ("model", settings.model),
            ("prompt", request.prompt),
            ("size", request.size),
            ("quality", request.quality),
            ("n", "1"),
            ("response_format", "b64_json"),
        ):
            field(name, value)
        for index, content in enumerate(request.input_images):
            media_type = cls._image_media_type(content)
            extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[media_type]
            chunks.extend([
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="image[]"; filename="input-{index + 1}.{extension}"\r\n'.encode("ascii"),
                f"Content-Type: {media_type}\r\n\r\n".encode("ascii"),
                content,
                b"\r\n",
            ])
        chunks.append(f"--{boundary}--\r\n".encode("ascii"))
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    def build_http_request(self, settings: ImageSettings, request: ImageRequest) -> Request:
        settings.validate()
        editing = bool(request.input_images)
        if editing and settings.protocol == ImageProtocol.OPENAI_IMAGES:
            body, content_type = self._multipart_body(settings, request)
        else:
            body = json.dumps(self._payload(settings, request), ensure_ascii=False).encode("utf-8")
            content_type = "application/json"
        headers = {"Content-Type": content_type, "Accept": "application/json"}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        return Request(self._endpoint(settings, editing=editing and settings.protocol == ImageProtocol.OPENAI_IMAGES), data=body, headers=headers, method="POST")

    async def generate(self, settings: ImageSettings, request: ImageRequest) -> ImageResult:
        http_request = self.build_http_request(settings, request)

        def send() -> tuple[int, bytes, dict[str, str]]:
            try:
                with urlopen(http_request, timeout=settings.timeout_seconds) as response:
                    return response.status, response.read(), dict(response.headers.items())
            except HTTPError as exc:
                return exc.code, exc.read(), dict(exc.headers.items())
            except TimeoutError as exc:
                raise ImageAdapterError("Image provider timed out", code="provider_timeout", retryable=True, submission_unknown=True) from exc
            except (URLError, OSError) as exc:
                raise ImageAdapterError("Image provider request failed", code="provider_timeout", retryable=True, submission_unknown=True) from exc

        status, raw, response_headers = await asyncio.to_thread(send)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ImageAdapterError("Image provider returned invalid JSON", code="provider_protocol_error", retryable=True) from exc
        if status >= 400:
            error = payload.get("error") if isinstance(payload, dict) else None
            message = error.get("message") if isinstance(error, dict) else None
            code = "provider_auth_failed" if status in {401, 403} else ("provider_timeout" if status in {408, 429, 500, 502, 503, 504} else "provider_protocol_error")
            raise ImageAdapterError(str(message or f"Image provider returned HTTP {status}"), code=code, retryable=status >= 500 or status == 429)
        entries = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(entries, list) or not entries:
            raise ImageAdapterError("Image provider response contained no images", code="provider_protocol_error", retryable=True)
        images: list[bytes] = []
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("b64_json"), str):
                raise ImageAdapterError("Image provider response did not contain b64_json", code="provider_protocol_error", retryable=True)
            try:
                images.append(base64.b64decode(entry["b64_json"], validate=True))
            except (ValueError, TypeError) as exc:
                raise ImageAdapterError("Image provider returned invalid image bytes", code="provider_protocol_error", retryable=True) from exc
        request_id = response_headers.get("x-request-id") or response_headers.get("X-Request-Id") or payload.get("id")
        return ImageResult(tuple(images), "openai_images", settings.model, request_id, payload.get("usage") or {}, payload.get("id"))


class DeterministicImageAdapter:
    """Development/test fixture; never used as a production fallback."""

    _PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")

    async def generate(self, settings: ImageSettings, request: ImageRequest) -> ImageResult:
        settings.validate()
        return ImageResult((self._PNG,), "deterministic_test", settings.model, "deterministic-image", {"images": 1}, "deterministic")
