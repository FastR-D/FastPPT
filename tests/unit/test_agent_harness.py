from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from claude_agent_sdk import ResultMessage

from fastppt_agent_harness.harness import (
    AgentBackend,
    AgentError,
    AgentRequest,
    AgentSettings,
    ClaudeCodeSdkAdapter,
    EndpointMode,
)


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
