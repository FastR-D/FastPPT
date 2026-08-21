from pathlib import Path
from unittest import TestCase

import yaml


ROOT = Path(__file__).resolve().parents[2]


class DeploymentContractTests(TestCase):
    def test_compose_uses_shared_production_contract_without_test_fallbacks(self) -> None:
        compose = yaml.safe_load((ROOT / "deploy" / "server" / "compose.yml").read_text(encoding="utf-8"))
        services = compose["services"]
        self.assertTrue({"postgres", "minio", "minio-init", "api", "worker", "caddy"}.issubset(services))
        self.assertEqual(services["api"]["image"], "fastppt:1.0.0")
        self.assertEqual(services["worker"]["image"], services["api"]["image"])
        self.assertEqual(services["api"]["environment"]["FASTPPT_DEPLOYMENT_MODE"], "server")
        self.assertEqual(services["worker"]["environment"], services["api"]["environment"])
        self.assertNotIn("deterministic_test", (ROOT / "deploy" / "server" / "compose.yml").read_text(encoding="utf-8"))

    def test_container_runs_unprivileged_with_server_extras_and_healthcheck(self) -> None:
        dockerfile = (ROOT / "deploy" / "server" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn('".[server,kernel,agents]"', dockerfile)
        self.assertIn("USER fastppt", dockerfile)
        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn('CMD ["fastppt-api"]', dockerfile)

    def test_ci_runs_real_postgres_s3_multi_instance_integration(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn('pip install -e ".[kernel,agents]"', workflow)
        self.assertIn("server-integration:", workflow)
        self.assertIn("postgres:17-alpine", workflow)
        self.assertIn("minio/minio:", workflow)
        self.assertIn("tests.integration.test_server_backends", workflow)
