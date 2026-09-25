"""Extended structural tests for docker-compose.yml new requirements.

Tests the features that MUST be present in the final implementation but are
currently ABSENT from the skeleton docker-compose.yml, so all tests in this
file are expected to FAIL until the implementation is complete:

  1. PostgreSQL 15 image  (currently postgres:16-alpine)
  2. Top-level named volumes  (currently absent)
  3. postgres service mounts the named volume  (currently no volumes:)
  4. alembic migrate init container  (currently absent)
  5. migrate runs ``alembic upgrade head``  (currently absent)
  6. migrate depends_on postgres with condition: service_healthy  (currently absent)
  7. metrics depends_on migrate with condition: service_completed_successfully
     (currently depends_on postgres directly — wrong ordering)
  8. WEBHOOK_SECRET env var wired on the metrics service  (currently absent)

Fast, filesystem-only tests — no Docker daemon required.
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
    yaml = pytest.importorskip("yaml", reason="PyYAML not installed — install pyyaml to run")
    if not DOCKER_COMPOSE_PATH.exists():
        pytest.skip(f"docker-compose.yml not found at {DOCKER_COMPOSE_PATH}")
    with open(DOCKER_COMPOSE_PATH) as f:
        return yaml.safe_load(f)


def _get_service(name_fragment: str) -> dict:
    """Return the first service whose name contains ``name_fragment``."""
    compose = _load_compose()
    services = compose.get("services", {})
    svc = next(
        (svc for svc_name, svc in services.items() if name_fragment in svc_name.lower()),
        None,
    )
    if svc is None:
        pytest.skip(f"No service containing '{name_fragment}' found in docker-compose.yml")
    return svc


def _get_service_name(name_fragment: str) -> str:
    """Return the first service name that contains ``name_fragment``."""
    compose = _load_compose()
    services = compose.get("services", {})
    svc_name = next(
        (name for name in services if name_fragment in name.lower()),
        None,
    )
    if svc_name is None:
        pytest.skip(f"No service name containing '{name_fragment}' found in docker-compose.yml")
    return svc_name


# ---------------------------------------------------------------------------
# PostgreSQL 15
# ---------------------------------------------------------------------------


class TestPostgres15Image:
    """postgres service must use the postgres:15 image family, not 16 or later."""

    def test_postgres_image_is_version_15(self):
        """The postgres image tag must specify major version 15.

        GitWeave targets PostgreSQL 15 for compatibility with managed cloud
        offerings (RDS, Cloud SQL) which commonly support 15 but not 16 yet.
        Using 16 in local dev diverges from production and risks hidden
        incompatibilities.
        """
        postgres_svc = _get_service("postgres")
        image: str = postgres_svc.get("image", "")
        assert image.startswith("postgres:15"), (
            f"postgres service must use postgres:15.x image; "
            f"got: {image!r}. "
            "Update the image tag to 'postgres:15' or 'postgres:15-alpine'."
        )


# ---------------------------------------------------------------------------
# Named volumes
# ---------------------------------------------------------------------------


class TestNamedVolumes:
    """docker-compose.yml must declare a top-level volumes section with named volumes.

    Named volumes survive ``docker compose down`` (without -v) so that the
    database state is preserved across restarts during development.
    """

    def test_top_level_volumes_key_exists(self):
        """docker-compose.yml must have a top-level 'volumes:' key."""
        compose = _load_compose()
        assert "volumes" in compose, (
            "docker-compose.yml must have a top-level 'volumes:' key. "
            "Add a named volume (e.g. 'postgres_data:') to persist the database "
            "across container restarts."
        )

    def test_at_least_one_named_volume_defined(self):
        """At least one named volume must be declared under the top-level volumes key."""
        compose = _load_compose()
        volumes = compose.get("volumes", {})
        assert len(volumes) >= 1, (
            "At least one named volume must be declared in the top-level 'volumes:' section. "
            f"Found: {volumes!r}"
        )

    def test_postgres_service_mounts_named_volume(self):
        """postgres service must mount the named volume at /var/lib/postgresql/data.

        Without a volume mount the postgres container stores data in a writable
        layer that is discarded when the container is removed, losing all
        development data between restarts.
        """
        postgres_svc = _get_service("postgres")
        service_volumes = postgres_svc.get("volumes", [])
        assert len(service_volumes) >= 1, (
            "postgres service must declare a 'volumes:' mount. "
            "Mount the named volume at /var/lib/postgresql/data to persist data."
        )
        # At least one mount must target the postgres data directory
        mount_strings = [str(v) for v in service_volumes]
        has_data_dir = any(
            "/var/lib/postgresql/data" in v or "pgdata" in v.lower()
            for v in mount_strings
        )
        assert has_data_dir, (
            f"postgres service must mount a volume at /var/lib/postgresql/data; "
            f"found mounts: {service_volumes!r}"
        )


# ---------------------------------------------------------------------------
# Alembic migrate init container
# ---------------------------------------------------------------------------


class TestAlembicMigrateInitContainer:
    """A migrate init container must run ``alembic upgrade head`` before the metrics service.

    Running migrations in a dedicated init container (rather than in the
    application startup code) ensures:
    - Migrations run exactly once per deployment cycle, not once per replica.
    - A failed migration stops the deploy early, before any traffic reaches the app.
    - The metrics service code stays free of migration orchestration concerns.
    """

    def _get_migrate_service(self) -> dict:
        """Return the migrate/init container service, failing with a clear message if absent."""
        compose = _load_compose()
        services = compose.get("services", {})
        # Accept names like: migrate, db-migrate, alembic, init, alembic-migrate
        migrate_svc = next(
            (
                svc
                for name, svc in services.items()
                if any(kw in name.lower() for kw in ("migrate", "alembic", "init"))
            ),
            None,
        )
        if migrate_svc is None:
            pytest.fail(
                "No migrate/alembic init container service found in docker-compose.yml. "
                "Add a service (e.g. 'migrate:') that runs 'alembic upgrade head' before "
                "the metrics service starts. "
                f"Defined services: {list(services.keys())}"
            )
        return migrate_svc

    def _get_migrate_service_name(self) -> str:
        """Return the name of the migrate/init container service."""
        compose = _load_compose()
        services = compose.get("services", {})
        name = next(
            (
                name
                for name in services
                if any(kw in name.lower() for kw in ("migrate", "alembic", "init"))
            ),
            None,
        )
        if name is None:
            pytest.fail(
                "No migrate/alembic init container service found in docker-compose.yml. "
                f"Defined services: {list(services.keys())}"
            )
        return name

    def test_migrate_service_is_defined(self):
        """A service named 'migrate' (or similar) must be defined in docker-compose.yml."""
        # _get_migrate_service already calls pytest.fail if absent
        svc = self._get_migrate_service()
        assert svc is not None

    def test_migrate_command_contains_alembic_upgrade_head(self):
        """The migrate service command must include ``alembic upgrade head``.

        This is the standard Alembic command to apply all pending migrations.
        Running just ``alembic upgrade`` without ``head`` leaves the revision
        unspecified, which is a misconfiguration.
        """
        migrate_svc = self._get_migrate_service()
        command = migrate_svc.get("command", "")
        command_str = str(command) if not isinstance(command, str) else command

        # Handle list-form command: ["alembic", "upgrade", "head"]
        if isinstance(command, list):
            command_str = " ".join(command)

        assert "alembic" in command_str and "upgrade" in command_str and "head" in command_str, (
            f"migrate service command must contain 'alembic upgrade head'; "
            f"got: {command!r}. "
            "Set 'command: alembic upgrade head' on the migrate service."
        )

    def test_migrate_depends_on_postgres_healthy(self):
        """migrate service must wait for postgres to be healthy before running.

        Without this, the migration can fail with a connection-refused error
        because postgres hasn't finished initialising when the migrate command runs.
        The 'service_healthy' condition requires a healthcheck on the postgres service.
        """
        migrate_svc = self._get_migrate_service()
        depends_on = migrate_svc.get("depends_on", {})

        # depends_on can be a list or a dict with conditions
        depends_str = str(depends_on).lower()
        assert "postgres" in depends_str, (
            f"migrate service must declare depends_on: postgres; "
            f"got: {depends_on!r}"
        )

        # If depends_on is a dict, verify the condition is service_healthy
        if isinstance(depends_on, dict):
            for dep_name, dep_config in depends_on.items():
                if "postgres" in dep_name.lower():
                    condition = dep_config.get("condition", "")
                    assert condition == "service_healthy", (
                        f"migrate must wait for postgres with condition: service_healthy; "
                        f"got condition: {condition!r}. "
                        "This prevents migration from running before postgres is ready."
                    )

    def test_migrate_sets_database_url_env_var(self):
        """migrate service must have DATABASE_URL set so alembic can connect."""
        migrate_svc = self._get_migrate_service()
        env = migrate_svc.get("environment", {})
        env_str = str(env)
        assert "DATABASE_URL" in env_str, (
            "migrate service must set DATABASE_URL environment variable "
            "so alembic upgrade head can connect to PostgreSQL. "
            f"Found environment: {env!r}"
        )


# ---------------------------------------------------------------------------
# Health-check ordering: postgres → migrate → metrics
# ---------------------------------------------------------------------------


class TestHealthCheckOrdering:
    """metrics service must depend on migrate completing, not on postgres directly.

    The correct chain is:
      postgres (healthy) → migrate (completed_successfully) → metrics (starts)

    If metrics depends directly on postgres, it may start before alembic has
    applied migrations, causing startup errors when trying to read/write tables.
    """

    def test_metrics_depends_on_migrate_service_completed_successfully(self):
        """metrics service must have depends_on the migrate service with
        condition: service_completed_successfully.

        This ensures migrations are fully applied before the application starts
        accepting traffic. Using service_started instead of
        service_completed_successfully would allow a partially-migrated or
        failed migration to go undetected.
        """
        metrics_svc = _get_service("metrics")
        migrate_svc_name = None

        # Find the migrate service name
        compose = _load_compose()
        services = compose.get("services", {})
        migrate_svc_name = next(
            (
                name
                for name in services
                if any(kw in name.lower() for kw in ("migrate", "alembic", "init"))
            ),
            None,
        )

        if migrate_svc_name is None:
            pytest.fail(
                "Cannot check metrics depends_on: no migrate service found. "
                "Add a migrate service first."
            )

        depends_on = metrics_svc.get("depends_on", {})
        depends_str = str(depends_on).lower()

        assert migrate_svc_name.lower() in depends_str, (
            f"metrics service must declare depends_on: {migrate_svc_name}; "
            f"got: {depends_on!r}. "
            "metrics must wait for migrations to complete before starting."
        )

        # Verify the condition is service_completed_successfully
        if isinstance(depends_on, dict):
            for dep_name, dep_config in depends_on.items():
                if migrate_svc_name.lower() in dep_name.lower():
                    condition = dep_config.get("condition", "")
                    assert condition == "service_completed_successfully", (
                        f"metrics must wait for migrate with "
                        f"condition: service_completed_successfully; "
                        f"got condition: {condition!r}. "
                        "service_started would not guarantee migrations finished."
                    )


# ---------------------------------------------------------------------------
# WEBHOOK_SECRET environment variable wiring
# ---------------------------------------------------------------------------


class TestWebhookSecretWiring:
    """metrics service must expose WEBHOOK_SECRET as an environment variable.

    The WEBHOOK_SECRET is used to verify HMAC-SHA256 signatures on incoming
    GitHub webhook requests.  Without it, the service either rejects all
    webhooks (if secret validation is strict) or accepts unsigned requests
    (a security regression).

    The value is injected from the host environment via ${WEBHOOK_SECRET:-}
    so operators can supply it via CI/CD secrets without baking it into the file.
    """

    def test_metrics_service_has_webhook_secret_env_var(self):
        """WEBHOOK_SECRET must be declared in the metrics service environment block."""
        metrics_svc = _get_service("metrics")
        env = metrics_svc.get("environment", {})
        env_str = str(env)
        assert "WEBHOOK_SECRET" in env_str, (
            "metrics service must declare WEBHOOK_SECRET in its environment block. "
            "Use ${WEBHOOK_SECRET:-} so the value can be injected at runtime "
            "without hardcoding secrets in the compose file. "
            f"Found environment: {env!r}"
        )
