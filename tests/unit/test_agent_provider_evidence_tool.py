import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock

from fastppt_agent_harness.harness import AgentResult
from tools.check_release_gates import validate_evidence_record
from tools.collect_agent_provider_evidence import _read_env_file, collect


async def _provider_fixture_run(_adapter, settings, request):
    assert settings.backend.value == "codex"
    assert settings.endpoint_mode.value == "relay"
    assert request.metadata["role"] == "source_analyst"
    return AgentResult(
        output={
            "summary": "Synthetic source analyzed.",
            "structure": ["verification"],
            "factCandidates": [],
            "verbatimText": [],
            "untrustedSourceInstructions": [],
            "coverageHashes": [],
            "uncertainties": [],
        },
        backend="codex",
        model=settings.model,
        thread_id="codex-relay-provider-request",
        usage={"input_tokens": 1, "output_tokens": 1},
    )


class AgentProviderEvidenceToolTests(TestCase):
    def test_explicit_env_file_reads_only_supported_values(self) -> None:
        with TemporaryDirectory() as temp_name:
            env_file = Path(temp_name) / "agent-evidence.env"
            env_file.write_text(
                "FASTPPT_MODEL=codex-test\n"
                "FASTPPT_MODEL_BASE_URL=https://relay.example.com/v1\n"
                "FASTPPT_MODEL_API_KEY=temporary-key\n"
                "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY=temporary-proof-key\n",
                encoding="utf-8",
            )
            self.assertEqual(
                _read_env_file(env_file),
                {
                    "FASTPPT_MODEL": "codex-test",
                    "FASTPPT_MODEL_BASE_URL": "https://relay.example.com/v1",
                    "FASTPPT_MODEL_API_KEY": "temporary-key",
                    "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY": "temporary-proof-key",
                },
            )
            env_file.write_text("FASTPPT_UNSUPPORTED_FIELD=unexpected\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, r"supported Agent relay or release-proof keys"):
                _read_env_file(env_file)

    def test_collects_signed_codex_relay_evidence_without_network(self) -> None:
        with TemporaryDirectory() as temp_name:
            output_dir = Path(temp_name) / "evidence"
            environment = {
                "FASTPPT_MODEL": "codex-test",
                "FASTPPT_MODEL_BASE_URL": "https://relay.example.com/v1",
                "FASTPPT_MODEL_API_KEY": "test-key",
                "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY": "agent-provider-evidence-test-key",
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch(
                "fastppt_agent_harness.harness.CodexSdkAdapter.run", new=_provider_fixture_run
            ):
                path = collect(output_dir)

            record = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(record["evidence_type"], "real_codex_relay_structured_agent_call")
            self.assertEqual(record["role"], "source_analyst")
            self.assertEqual(record["provider_snapshot"]["backend"], "codex")
            self.assertEqual(record["provider_snapshot"]["endpoint_mode"], "relay")
            self.assertEqual(record["input_artifact_ids"], record["binding"]["run"]["input_artifact_ids"])
            self.assertEqual(
                validate_evidence_record(record, signing_key="agent-provider-evidence-test-key"),
                [],
            )
