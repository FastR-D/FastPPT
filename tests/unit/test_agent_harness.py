from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
import base64
import json

from claude_agent_sdk import ResultMessage

from fastppt_agent_harness.harness import (
    AgentBackend,
    AgentError,
    AgentRequest,
    AgentSettings,
    ClaudeCodeSdkAdapter,
    EndpointMode,
)
from fastppt_agent_harness.image import ImageRequest, ImageSettings, OpenAIImageAdapter


class ClaudeCodeAdapterTests(IsolatedAsyncioTestCase):
    async def test_uses_sdk_structured_output_with_tools_disabled(self) -> None:
        captured = {}

        async def fake_query(*, prompt, options):
            captured["prompt"] = prompt
            captured["options"] = options
            yield ResultMessage(
                subtype="success",
                duration_ms=1,
                duration_api_ms=1,
                is_error=False,
                num_turns=1,
                session_id="session-test",
                usage={"input_tokens": 1},
                structured_output={"workflowMode": "page_entry"},
            )

        settings = AgentSettings(AgentBackend.CLAUDE_CODE, "claude-test", reasoning_effort="high")
        request = AgentRequest("plan only", {"type": "object"})
        with patch("claude_agent_sdk.query", fake_query):
            result = await ClaudeCodeSdkAdapter().run(settings, request)

        self.assertEqual(result.output, {"workflowMode": "page_entry"})
        self.assertEqual(result.thread_id, "session-test")
        self.assertEqual(captured["options"].tools, [])
        self.assertEqual(captured["options"].allowed_tools, [])
        self.assertEqual(captured["options"].setting_sources, [])
        self.assertEqual(captured["options"].skills, [])
        self.assertEqual(captured["options"].max_turns, 1)

    def test_official_mode_rejects_custom_endpoint(self) -> None:
        with self.assertRaisesRegex(AgentError, "Official endpoint"):
            AgentSettings(
                AgentBackend.CLAUDE_CODE,
                "claude-test",
                endpoint_mode=EndpointMode.OFFICIAL,
                base_url="https://relay.example.com",
            ).validate(production=False)

    def test_relay_mode_requires_safe_endpoint_and_production_key(self) -> None:
        with self.assertRaisesRegex(AgentError, "Relay mode requires"):
            AgentSettings(
                AgentBackend.CLAUDE_CODE,
                "claude-test",
                endpoint_mode=EndpointMode.RELAY,
            ).validate(production=False)
        with self.assertRaisesRegex(AgentError, "HTTPS origin"):
            AgentSettings(
                AgentBackend.CLAUDE_CODE,
                "claude-test",
                endpoint_mode=EndpointMode.RELAY,
                base_url="http://relay.example.com",
            ).validate(production=False)
        with self.assertRaisesRegex(AgentError, "requires an API key"):
            AgentSettings(
                AgentBackend.CLAUDE_CODE,
                "claude-test",
                endpoint_mode=EndpointMode.RELAY,
                base_url="https://relay.example.com",
            ).validate(production=True)

    def test_relay_json_edit_preserves_authorized_input_media_type(self) -> None:
        settings = ImageSettings(model="gpt-image-2")
        request = ImageRequest(
            "edit this",
            (b"jpeg-bytes",),
            ("image/jpeg",),
        )
        payload = OpenAIImageAdapter._payload(settings, request)
        self.assertTrue(payload["images"][0].startswith("data:image/jpeg;base64,"))
        self.assertEqual(base64.b64decode(payload["images"][0].split(",", 1)[1]), b"jpeg-bytes")

    def test_official_edit_multipart_preserves_input_media_types_and_bytes(self) -> None:
        settings = ImageSettings(model="gpt-image-2", api_key="test-key")
        png = b"\x89PNG\r\n\x1a\n" + b"png-payload"
        jpeg = b"\xff\xd8\xff" + b"jpeg-payload"
        request = ImageRequest("edit this", (png, jpeg))

        http_request = OpenAIImageAdapter().build_http_request(settings, request)
        body = http_request.data or b""
        content_type = http_request.headers["Content-type"]
        self.assertEqual(http_request.get_header("User-agent"), "FastPPT/1.2.0")
        self.assertTrue(http_request.full_url.endswith("/v1/images/edits"))
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))
        self.assertIn(b'filename="input-1.png"', body)
        self.assertIn(b"Content-Type: image/png", body)
        self.assertIn(png, body)
        self.assertIn(b'filename="input-2.jpg"', body)
        self.assertIn(b"Content-Type: image/jpeg", body)
        self.assertIn(jpeg, body)
        self.assertIn(b'Content-Disposition: form-data; name="response_format"', body)

    def test_provider_output_media_type_is_detected_from_bytes(self) -> None:
        self.assertEqual(OpenAIImageAdapter._image_media_type(b"\x89PNG\r\n\x1a\noutput"), "image/png")
        self.assertEqual(OpenAIImageAdapter._image_media_type(b"\xff\xd8\xffoutput"), "image/jpeg")
        self.assertEqual(OpenAIImageAdapter._image_media_type(b"RIFFxxxxWEBPoutput"), "image/webp")
