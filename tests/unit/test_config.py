from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_runtime.config import ConfigurationError, RuntimeSettings


class RuntimeConfigTests(TestCase):
    def test_local_mode_is_explicit_and_loopback_by_default(self) -> None:
        with TemporaryDirectory() as temp_name:
            settings = RuntimeSettings.load({}, root=Path(temp_name))
        self.assertEqual(settings.deployment_mode.value, "local")
        self.assertEqual(settings.metadata_store, "sqlite")
        self.assertEqual(settings.host, "127.0.0.1")

    def test_local_non_loopback_requires_authentication(self) -> None:
        with TemporaryDirectory() as temp_name, self.assertRaises(ConfigurationError):
            RuntimeSettings.load({"FASTPPT_HOST": "0.0.0.0"}, root=Path(temp_name))

    def test_server_mode_fails_when_production_dependencies_are_missing(self) -> None:
        with TemporaryDirectory() as temp_name, self.assertRaises(ConfigurationError):
            RuntimeSettings.load({"FASTPPT_DEPLOYMENT_MODE": "server"}, root=Path(temp_name))

    def test_server_mode_accepts_complete_fail_closed_configuration(self) -> None:
        with TemporaryDirectory() as temp_name:
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_DEPLOYMENT_MODE": "server",
                    "FASTPPT_DATABASE_URL": "postgresql://fastppt:password@postgres/fastppt",
                    "FASTPPT_SESSION_SECRET": "s" * 32,
                    "FASTPPT_ADMIN_EMAIL": "admin@example.com",
                    "FASTPPT_ADMIN_PASSWORD": "correct-horse-battery-staple",
                    "FASTPPT_S3_ENDPOINT": "https://objects.example.com",
                    "FASTPPT_S3_BUCKET": "fastppt",
                    "FASTPPT_S3_ACCESS_KEY": "access-key",
                    "FASTPPT_S3_SECRET_KEY": "secret-key",
                    "FASTPPT_CORS_ORIGINS": "https://fastppt.example.com",
                    "FASTPPT_AGENT_BACKEND": "codex",
                    "FASTPPT_MODEL": "gpt-5.2-codex",
                    "FASTPPT_MODEL_API_KEY": "test-only-value",
                },
                root=Path(temp_name),
            )
        self.assertTrue(settings.production)
        self.assertEqual(settings.metadata_store, "postgres")
        self.assertEqual(settings.artifact_store, "s3")
        self.assertEqual(settings.auth_mode, "session")
        self.assertEqual(settings.cors_origins, ("https://fastppt.example.com",))

    def test_server_mode_rejects_unscoped_deterministic_agent(self) -> None:
        with TemporaryDirectory() as temp_name, self.assertRaises(ConfigurationError):
            RuntimeSettings.load(
                {
                    "FASTPPT_DEPLOYMENT_MODE": "server",
                    "FASTPPT_DATABASE_URL": "postgresql://fastppt:password@postgres/fastppt",
                    "FASTPPT_SESSION_SECRET": "s" * 32,
                    "FASTPPT_S3_ENDPOINT": "https://objects.example.com",
                    "FASTPPT_S3_BUCKET": "fastppt",
                    "FASTPPT_S3_ACCESS_KEY": "access-key",
                    "FASTPPT_S3_SECRET_KEY": "secret-key",
                    "FASTPPT_ADMIN_EMAIL": "admin@example.com",
                    "FASTPPT_ADMIN_PASSWORD": "correct-horse-battery-staple",
                    "FASTPPT_CORS_ORIGINS": "https://fastppt.example.com",
                    "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                    "FASTPPT_AGENT_BACKEND": "deterministic_test",
                },
                root=Path(temp_name),
            )

    def test_server_mode_allows_scoped_deterministic_fixture(self) -> None:
        with TemporaryDirectory() as temp_name:
            settings = RuntimeSettings.load(
                {
                    "FASTPPT_DEPLOYMENT_MODE": "server",
                    "FASTPPT_SERVER_INTEGRATION": "1",
                    "FASTPPT_ENABLE_TEST_FIXTURES": "1",
                    "FASTPPT_AGENT_BACKEND": "deterministic_test",
                    "FASTPPT_DATABASE_URL": "postgresql://fastppt:password@postgres/fastppt",
                    "FASTPPT_SESSION_SECRET": "s" * 32,
                    "FASTPPT_S3_ENDPOINT": "http://127.0.0.1:9000",
                    "FASTPPT_ALLOW_INSECURE_S3": "1",
                    "FASTPPT_S3_BUCKET": "fastppt",
                    "FASTPPT_S3_ACCESS_KEY": "access-key",
                    "FASTPPT_S3_SECRET_KEY": "secret-key",
                    "FASTPPT_ADMIN_EMAIL": "admin@example.com",
                    "FASTPPT_ADMIN_PASSWORD": "correct-horse-battery-staple",
                    "FASTPPT_CORS_ORIGINS": "https://fastppt.example.com",
                },
                root=Path(temp_name),
            )
        self.assertTrue(settings.production)
        self.assertFalse(settings.agent_production)
        self.assertEqual(settings.agent.backend.value, "deterministic_test")

    def test_relay_requires_https_base_url(self) -> None:
        with TemporaryDirectory() as temp_name, self.assertRaises(ConfigurationError):
            RuntimeSettings.load(
                {
                    "FASTPPT_AGENT_BACKEND": "codex",
                    "FASTPPT_MODEL": "example-model",
                    "FASTPPT_MODEL_ENDPOINT_MODE": "relay",
                    "FASTPPT_MODEL_BASE_URL": "http://relay.invalid",
                },
                root=Path(temp_name),
            )

    def test_invalid_agent_timeout_is_a_configuration_error(self) -> None:
        with TemporaryDirectory() as temp_name, self.assertRaises(ConfigurationError):
            RuntimeSettings.load({"FASTPPT_MODEL_TIMEOUT_SECONDS": "not-a-number"}, root=Path(temp_name))
