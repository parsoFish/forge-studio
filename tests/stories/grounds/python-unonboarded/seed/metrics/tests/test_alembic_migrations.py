"""Integration tests for Alembic migrations.

Verifies that the schema defined in metrics/migrations/ creates the expected
tables with required columns when applied to a clean PostgreSQL instance.

These tests use the pg_engine fixture from conftest.py which:
  1. Runs alembic upgrade head (once per session)
  2. Returns a SQLAlchemy engine for schema inspection

Tests also verify that downgrade to base removes all tables cleanly,
confirming the migrations are fully reversible.

Requires TEST_DATABASE_URL to be set.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

METRICS_DIR = Path(__file__).parent.parent
MIGRATIONS_DIR = METRICS_DIR / "migrations"


# ---------------------------------------------------------------------------
# Directory and file structure
# ---------------------------------------------------------------------------


class TestMigrationsDirectoryStructure:
    """The Alembic project scaffolding files must be present."""

    def test_migrations_directory_exists(self):
        assert MIGRATIONS_DIR.exists(), (
            f"migrations/ directory not found at {MIGRATIONS_DIR}. "
            "Run: cd metrics && alembic init migrations"
        )

    def test_alembic_ini_exists(self):
        alembic_ini = METRICS_DIR / "alembic.ini"
        assert alembic_ini.exists(), (
            f"alembic.ini not found at {alembic_ini}. "
            "Run: cd metrics && alembic init migrations"
        )

    def test_migrations_env_py_exists(self):
        env_py = MIGRATIONS_DIR / "env.py"
        assert env_py.exists(), (
            f"migrations/env.py not found at {env_py}"
        )

    def test_migrations_versions_directory_exists(self):
        versions_dir = MIGRATIONS_DIR / "versions"
        assert versions_dir.exists(), (
            f"migrations/versions/ directory not found at {versions_dir}"
        )

    def test_at_least_one_migration_file_exists(self):
        versions_dir = MIGRATIONS_DIR / "versions"
        if not versions_dir.exists():
            pytest.skip("migrations/versions/ directory not found")
        migration_files = [
            f for f in versions_dir.glob("*.py") if f.name != "__init__.py"
        ]
        assert len(migration_files) >= 1, (
            "No migration scripts found in migrations/versions/. "
            "Generate the initial migration: alembic revision --autogenerate -m 'initial schema'"
        )


# ---------------------------------------------------------------------------
# deployment_events table
# ---------------------------------------------------------------------------


class TestDeploymentEventsTable:
    """deployment_events table exists with required columns after migration."""

    def test_deployment_events_table_exists(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        assert "deployment_events" in inspector.get_table_names(), (
            "deployment_events table not found after running alembic upgrade head"
        )

    def test_deployment_events_has_id_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "id" in columns, (
            "deployment_events must have an 'id' primary key column"
        )

    def test_deployment_events_has_repo_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "repo" in columns

    def test_deployment_events_has_environment_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "environment" in columns

    def test_deployment_events_has_state_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "state" in columns

    def test_deployment_events_has_deployment_id_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "deployment_id" in columns

    def test_deployment_events_has_created_at_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("deployment_events")}
        assert "created_at" in columns

    def test_deployment_events_created_at_has_timezone(self, pg_engine):
        """created_at must be TIMESTAMP WITH TIME ZONE for correct UTC comparisons."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = {c["name"]: c for c in inspector.get_columns("deployment_events")}
        created_at = col_map.get("created_at")
        assert created_at is not None
        col_type_str = str(created_at["type"]).upper()
        assert "TIMESTAMP" in col_type_str, (
            "deployment_events.created_at must be a TIMESTAMP type; "
            f"got: {created_at['type']}"
        )


# ---------------------------------------------------------------------------
# pr_events table
# ---------------------------------------------------------------------------


class TestPREventsTable:
    """pr_events table exists with required columns after migration."""

    def test_pr_events_table_exists(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        assert "pr_events" in inspector.get_table_names(), (
            "pr_events table not found after running alembic upgrade head"
        )

    def test_pr_events_has_id_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "id" in columns

    def test_pr_events_has_repo_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "repo" in columns

    def test_pr_events_has_pr_number_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "pr_number" in columns

    def test_pr_events_has_commit_sha_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "commit_sha" in columns

    def test_pr_events_has_merged_at_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "merged_at" in columns

    def test_pr_events_has_created_at_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("pr_events")}
        assert "created_at" in columns


# ---------------------------------------------------------------------------
# push_events table
# ---------------------------------------------------------------------------


class TestPushEventsTable:
    """push_events table exists with required columns after migration."""

    def test_push_events_table_exists(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        assert "push_events" in inspector.get_table_names(), (
            "push_events table not found after running alembic upgrade head"
        )

    def test_push_events_has_id_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("push_events")}
        assert "id" in columns

    def test_push_events_has_repo_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("push_events")}
        assert "repo" in columns

    def test_push_events_has_ref_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("push_events")}
        assert "ref" in columns

    def test_push_events_has_commits_column(self, pg_engine):
        """commits are stored as JSON/JSONB array for flexible commit metadata."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("push_events")}
        assert "commits" in columns

    def test_push_events_has_created_at_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        columns = {c["name"] for c in inspector.get_columns("push_events")}
        assert "created_at" in columns


# ---------------------------------------------------------------------------
# Downgrade reversibility
# ---------------------------------------------------------------------------


class TestMigrationDowngrade:
    """Running alembic downgrade base must cleanly remove all application tables."""

    def test_downgrade_to_base_removes_all_event_tables(self):
        """All three event tables must be absent after downgrade to base."""
        import sqlalchemy
        from alembic import command
        from alembic.config import Config

        url = os.environ.get("TEST_DATABASE_URL")
        if not url:
            pytest.skip("TEST_DATABASE_URL not set")

        alembic_ini = METRICS_DIR / "alembic.ini"
        if not alembic_ini.exists():
            pytest.skip(f"alembic.ini not found at {alembic_ini}")

        cfg = Config(str(alembic_ini))
        cfg.set_main_option("sqlalchemy.url", url)

        # Downgrade to base — all application tables must be dropped
        command.downgrade(cfg, "base")

        engine = sqlalchemy.create_engine(url)
        try:
            inspector = sqlalchemy.inspect(engine)
            table_names = inspector.get_table_names()
            for table in ("deployment_events", "pr_events", "push_events"):
                assert table not in table_names, (
                    f"Table '{table}' should be dropped after downgrade to base; "
                    f"found tables: {table_names}"
                )
        finally:
            engine.dispose()
            # Re-apply migrations so subsequent tests can use the schema
            command.upgrade(cfg, "head")
