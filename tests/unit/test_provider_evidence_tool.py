import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase, mock

from fastppt_agent_harness.image import ImageResult
from tools.check_release_gates import validate_evidence_record
from tools.collect_image_provider_evidence import _REFERENCE_PNG, _read_env_file, collect


async def _provider_fixture_generate(_adapter, settings, request):
    return ImageResult(
        images=(_REFERENCE_PNG,),
        provider="openai_images",
        model="gpt-image-2",
        provider_request_id="provider-evidence-fixture",
        usage={"images": 1},
        response_fingerprint="fixture-response",
    )


class ProviderEvidenceToolTests(IsolatedAsyncioTestCase):
    def test_explicit_env_file_reads_only_supported_values(self) -> None:
        with TemporaryDirectory() as temp_name:
            env_file = Path(temp_name) / ".env.local"
            env_file.write_text(
                "# temporary provider settings\n"
                "export FASTPPT_IMAGE_ENDPOINT_MODE=relay\n"
                "FASTPPT_IMAGE_BASE_URL=\"https://relay.example.com\"\n"
                "FASTPPT_IMAGE_API_KEY=temporary-key\n",
                encoding="utf-8",
            )
            self.assertEqual(
                _read_env_file(env_file),
                {
                    "FASTPPT_IMAGE_ENDPOINT_MODE": "relay",
                    "FASTPPT_IMAGE_BASE_URL": "https://relay.example.com",
                    "FASTPPT_IMAGE_API_KEY": "temporary-key",
                },
            )

            env_file.write_text("FASTPPT_MODEL_API_KEY=temporary\nFASTPPT_MODEL=unexpected\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, r"supported image-provider or release-proof keys"):
                _read_env_file(env_file)

    def test_collects_contract_valid_generation_and_edit_records_without_network(self) -> None:
        with TemporaryDirectory() as temp_name:
            output_dir = Path(temp_name) / "evidence"
            environment = {
                "FASTPPT_IMAGE_ENDPOINT_MODE": "relay",
                "FASTPPT_IMAGE_BASE_URL": "https://relay.example.com",
                "FASTPPT_IMAGE_API_KEY": "test-key",
                "FASTPPT_RELEASE_EVIDENCE_HMAC_KEY": "provider-evidence-test-key",
                "FASTPPT_IMAGE_PROTOCOL": "openai_images",
                "FASTPPT_AGENT_BACKEND": "unconfigured",
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch(
                "fastppt_runtime.service.OpenAIImageAdapter.generate", new=_provider_fixture_generate
            ):
                generation = collect("generation", output_dir)
                edit = collect("edit", output_dir)

            for path, expected_type in (
                (generation, "real_gpt_image2_generation"),
                (edit, "real_gpt_image2_edit"),
            ):
                record = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(record["evidence_type"], expected_type)
                self.assertEqual(validate_evidence_record(record, signing_key="provider-evidence-test-key"), [])
                self.assertEqual(record["redaction"]["full_prompt"], "omitted")
                self.assertEqual(record["redaction"]["raw_response"], "omitted")
                self.assertEqual(record["redaction"]["credentials"], "omitted")
