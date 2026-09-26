"""Structural tests for the Docker Compose configuration.

Validates that metrics/docker-compose.yml:
  1. Exists
  2. Defines a postgres service with port 5432 exposed
  3. Defines a metrics service that depends on postgres
  4. Sets the required PostgreSQL environment variables

These are fast, filesystem-only tests — no Docker daemon is required.
They fail until metrics/docker-compose.yml is created as part of implementation.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

METRICS_DIR = Path(__file__).parent.parent
DOCKER_COMPOSE_PATH = METRICS_DIR / "docker-compose.yml"


def _load_compose() -> dict:
    """Load and parse docker-compose.yml, skipping if PyYAML is unavailable."""
    yaml = pytest.importorskip("yaml", reason="PyYAML not installed — install pyyaml to run docker-compose tests")
    if not DOCKER_COMPOSE_PATH.exists():
        pytest.skip(f"docker-compose.yml not found at {DOCKER_COMPOSE_PATH}")
    with open(DOCKER_COMPOSE_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# File existence
# ---------------------------------------------------------------------------


class TestDockerComposeFileExists:
    """docker-compose.yml must exist in the metrics/ directory."""

    def test_docker_compose_yml_exists(self):
        assert DOCKER_COMPOSE_PATH.exists(), (
            f"docker-compose.yml not found at {DOCKER_COMPOSE_PATH}. "
            "Create metrics/docker-compose.yml with postgres + metrics services."
        )

    def test_docker_compose_yml_is_not_empty(self):
        if not DOCKER_COMPOSE_PATH.exists():
            pytest.skip("docker-compose.yml not found")
        content = DOCKER_COMPOSE_PATH.read_text().strip()
        assert content, "docker-compose.yml must not be empty"

    def test_docker_compose_yml_is_valid_yaml(self):
        """The file must parse as valid YAML without errors."""
        yaml = pytest.importorskip("yaml")
        if not DOCKER_COMPOSE_PATH.exists():
            pytest.skip("docker-compose.yml not found")
        with open(DOCKER_COMPOSE_PATH) as f:
            result = yaml.safe_load(f)
        assert result is not None, "docker-compose.yml must contain valid YAML content"


# ---------------------------------------------------------------------------
# Service definitions
# ---------------------------------------------------------------------------


class TestDockerComposeServices:
    """docker-compose.yml defines the required postgres and metrics services."""

    def test_services_key_exists(self):
        compose = _load_compose()
        assert "services" in compose, (
            "docker-compose.yml must have a 'services' key at the top level"
        )

    def test_postgres_service_is_defined(self):
        compose = _load_compose()
        services = compose.get("services", {})
        postgres_names = [name for name in services if "postgres" in name.lower()]
        assert len(postgres_names) >= 1, (
            f"No postgres service found in docker-compose.yml. "
            f"Defined services: {list(services.keys())}"
        )

    def test_metrics_service_is_defined(self):
        compose = _load_compose()
        services = compose.get("services", {})
        metrics_names = [name for name in services if "metrics" in name.lower()]
        assert len(metrics_names) >= 1, (
            f"No metrics service found in docker-compose.yml. "
            f"Defined services: {list(services.keys())}"
        )


# ---------------------------------------------------------------------------
# Postgres service configuration
# ---------------------------------------------------------------------------


class TestDockerComposePostgresService:
    """postgres service must be correctly configured for local development."""

    def _get_postgres_service(self) -> dict:
        compose = _load_compose()
        services = compose.get("services", {})
        postgres_svc = next(
            (svc for name, svc in services.items() if "postgres" in name.lower()),
            None,
        )
        if postgres_svc is None:
            pytest.skip("postgres service not found in docker-compose.yml")
        return postgres_svc

    def test_postgres_service_exposes_port_5432(self):
        postgres_svc = self._get_postgres_service()
        ports = postgres_svc.get("ports", [])
        port_strings = [str(p) for p in ports]
        assert any("5432" in p for p in port_strings), (
            f"postgres service must expose port 5432; found ports: {port_strings}"
        )

    def test_postgres_service_sets_postgres_password_env_var(self):
        """POSTGRES_PASSWORD is required for postgres image to initialise."""
        postgres_svc = self._get_postgres_service()
        env = postgres_svc.get("environment", {})
        env_str = str(env)
        assert "POSTGRES_PASSWORD" in env_str, (
            "postgres service must set POSTGRES_PASSWORD environment variable"
        )

    def test_postgres_service_uses_postgres_image(self):
        """Service must use the official postgres Docker image."""
        postgres_svc = self._get_postgres_service()
        image = postgres_svc.get("image", "")
        assert "postgres" in image.lower(), (
            f"postgres service must use a postgres image; got: {image!r}"
        )


# ---------------------------------------------------------------------------
# Metrics service configuration
# ---------------------------------------------------------------------------


class TestDockerComposeMetricsService:
    """metrics service must be correctly configured and depend on postgres."""

    def _get_metrics_service(self) -> dict:
        compose = _load_compose()
        services = compose.get("services", {})
        metrics_svc = next(
            (svc for name, svc in services.items() if "metrics" in name.lower()),
            None,
        )
        if metrics_svc is None:
            pytest.skip("metrics service not found in docker-compose.yml")
        return metrics_svc

    def test_metrics_service_depends_on_postgres(self):
        """metrics must declare depends_on postgres to ensure startup ordering."""
        metrics_svc = self._get_metrics_service()
        depends_on = metrics_svc.get("depends_on", [])
        depends_str = str(depends_on).lower()
        assert "postgres" in depends_str, (
            "metrics service must declare depends_on: postgres (or equivalent) "
            "to ensure postgres is ready before the metrics service starts"
        )

    def test_metrics_service_exposes_port(self):
        """metrics service must expose at least one port for health checks and Prometheus."""
        metrics_svc = self._get_metrics_service()
        ports = metrics_svc.get("ports", [])
        assert len(ports) >= 1, (
            "metrics service must expose at least one port (typically 8000)"
        )

    def test_metrics_service_sets_database_url_env_var(self):
        """DATABASE_URL must be set on the metrics service so it uses PostgreSQLEventStore."""
        metrics_svc = self._get_metrics_service()
        env = metrics_svc.get("environment", {})
        env_str = str(env)
        assert "DATABASE_URL" in env_str, (
            "metrics service must set DATABASE_URL environment variable "
            "so it uses PostgreSQLEventStore instead of InMemoryEventStore"
        )
