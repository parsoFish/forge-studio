"""Integration tests for the events table Alembic migration.

Verifies that the migration creating the unified ``events`` table (repo,
event_type, payload JSONB, received_at) applies and rolls back correctly.

These tests define the schema contract that ``PostgresEventStore`` depends on.

Run conditions:
  - Structural tests (directory/file presence) run always — no DB required.
  - Schema + downgrade tests require TEST_DATABASE_URL to be set, e.g.:
      TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gitweave_test pytest

The tests are intentionally written BEFORE the migration exists so they fail
(red) until the implementation is added.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

METRICS_DIR = Path(__file__).parent.parent
MIGRATIONS_DIR = METRICS_DIR / "migrations"
VERSIONS_DIR = MIGRATIONS_DIR / "versions"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_column_map(inspector, table_name: str) -> dict:
    """Return {column_name: column_info} for the given table."""
    return {c["name"]: c for c in inspector.get_columns(table_name)}


# ---------------------------------------------------------------------------
# 1. Migration file structure
# ---------------------------------------------------------------------------


class TestEventsTableMigrationFileExists:
    """A migration script that creates the events table must exist."""

    def test_versions_directory_exists(self):
        assert VERSIONS_DIR.exists(), (
            f"migrations/versions/ not found at {VERSIONS_DIR}. "
            "Run: cd metrics && alembic init migrations"
        )

    def test_at_least_two_migration_files_exist(self):
        """The events table migration must be a separate revision from revision 001."""
        if not VERSIONS_DIR.exists():
            pytest.skip("migrations/versions/ not found")
        migrations = [f for f in VERSIONS_DIR.glob("*.py") if f.name != "__init__.py"]
        assert len(migrations) >= 2, (
            f"Expected at least 2 migration files (001_initial_schema + events table), "
            f"found {len(migrations)}: {[f.name for f in migrations]}"
        )

    def test_events_migration_file_exists(self):
        """A migration file whose name references 'events' must be present."""
        if not VERSIONS_DIR.exists():
            pytest.skip("migrations/versions/ not found")
        events_migrations = [
            f for f in VERSIONS_DIR.glob("*.py")
            if "event" in f.stem.lower() and f.name != "__init__.py"
            and f.stem != "001_initial_schema"
        ]
        assert len(events_migrations) >= 1, (
            "No migration file referencing 'events' found in migrations/versions/. "
            "Expected a file like '002_events_table.py' or similar. "
            "Create it with: alembic revision -m 'events table'"
        )


# ---------------------------------------------------------------------------
# 2. events table schema after upgrade head
# ---------------------------------------------------------------------------


class TestEventsTableExists:
    """The events table must be present after alembic upgrade head."""

    def test_events_table_exists(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        table_names = inspector.get_table_names()
        assert "events" in table_names, (
            f"'events' table not found after running alembic upgrade head. "
            f"Found tables: {table_names}. "
            "Implement the migration: op.create_table('events', ...)"
        )


class TestEventsTableHasRequiredColumns:
    """Every column required by the schema contract must be present."""

    def test_events_table_has_id_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        assert "id" in col_map, (
            "events table is missing the 'id' primary key column"
        )

    def test_events_table_has_repo_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        assert "repo" in col_map, (
            "events table is missing the 'repo' column — "
            "required by PostgresEventStore for per-repository filtering"
        )

    def test_events_table_has_event_type_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        assert "event_type" in col_map, (
            "events table is missing the 'event_type' column — "
            "required to distinguish push / pull_request / deployment_status events"
        )

    def test_events_table_has_payload_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        assert "payload" in col_map, (
            "events table is missing the 'payload' column — "
            "required to store arbitrary event JSON"
        )

    def test_events_table_has_received_at_column(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        assert "received_at" in col_map, (
            "events table is missing the 'received_at' column — "
            "required for DORA lead-time and frequency calculations"
        )


class TestEventsTableColumnTypes:
    """Column types must match the schema contract exactly."""

    def test_repo_column_is_string_type(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        repo_col = col_map.get("repo")
        assert repo_col is not None
        type_str = str(repo_col["type"]).upper()
        assert any(t in type_str for t in ("VARCHAR", "TEXT", "CHARACTER")), (
            f"events.repo must be a string/text type; got: {repo_col['type']}"
        )

    def test_event_type_column_is_string_type(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        et_col = col_map.get("event_type")
        assert et_col is not None
        type_str = str(et_col["type"]).upper()
        assert any(t in type_str for t in ("VARCHAR", "TEXT", "CHARACTER")), (
            f"events.event_type must be a string/text type; got: {et_col['type']}"
        )

    def test_payload_column_is_jsonb_type(self, pg_engine):
        """payload must be JSONB (not TEXT or plain JSON) for efficient querying."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        payload_col = col_map.get("payload")
        assert payload_col is not None
        type_str = str(payload_col["type"]).upper()
        assert "JSONB" in type_str, (
            f"events.payload must be JSONB for efficient JSON querying; "
            f"got: {payload_col['type']}. "
            "Use sa.dialects.postgresql.JSONB() in the migration."
        )

    def test_received_at_column_is_timestamp_with_timezone(self, pg_engine):
        """received_at must be TIMESTAMP WITH TIME ZONE for correct UTC comparisons."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        received_at_col = col_map.get("received_at")
        assert received_at_col is not None
        type_str = str(received_at_col["type"]).upper()
        assert "TIMESTAMP" in type_str, (
            f"events.received_at must be a TIMESTAMP type; got: {received_at_col['type']}"
        )
        # PostgreSQL reflects timezone-aware timestamps as "TIMESTAMP WITH TIME ZONE"
        # SQLAlchemy may report this as "TIMESTAMP WITH TIME ZONE" or "TIMESTAMPTZ"
        assert received_at_col["type"].timezone is True, (
            "events.received_at must be timezone-aware (TIMESTAMP WITH TIME ZONE). "
            "Use sa.DateTime(timezone=True) or sa.TIMESTAMP(timezone=True) in the migration."
        )


class TestEventsTableConstraints:
    """Schema constraints must enforce data integrity."""

    def test_repo_column_is_not_nullable(self, pg_engine):
        """repo must be NOT NULL — every event must be attributed to a repository."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        repo_col = col_map.get("repo")
        assert repo_col is not None
        assert repo_col["nullable"] is False, (
            "events.repo must be NOT NULL — a repository-less event has no meaning"
        )

    def test_event_type_column_is_not_nullable(self, pg_engine):
        """event_type must be NOT NULL — every event must have a known type."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        et_col = col_map.get("event_type")
        assert et_col is not None
        assert et_col["nullable"] is False, (
            "events.event_type must be NOT NULL — a typeless event cannot be routed"
        )

    def test_received_at_column_is_not_nullable(self, pg_engine):
        """received_at must be NOT NULL — required for time-series DORA calculations."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        col_map = _get_column_map(inspector, "events")
        received_at_col = col_map.get("received_at")
        assert received_at_col is not None
        assert received_at_col["nullable"] is False, (
            "events.received_at must be NOT NULL — timestamps are essential for DORA metrics"
        )

    def test_id_is_primary_key(self, pg_engine):
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        pk = inspector.get_pk_constraint("events")
        pk_columns = pk.get("constrained_columns", [])
        assert "id" in pk_columns, (
            f"events.id must be the primary key; found pk columns: {pk_columns}"
        )


class TestEventsTableIndexes:
    """Performance indexes must be present for common query patterns."""

    def test_events_table_has_repo_received_at_index(self, pg_engine):
        """A composite index on (repo, received_at) is required for DORA time-window queries."""
        import sqlalchemy

        inspector = sqlalchemy.inspect(pg_engine)
        indexes = inspector.get_indexes("events")
        index_column_sets = [
            frozenset(idx["column_names"]) for idx in indexes
        ]
        expected = frozenset({"repo", "received_at"})
        assert expected in index_column_sets, (
            f"events table is missing a composite index on (repo, received_at). "
            f"Found indexes: {[idx['column_names'] for idx in indexes]}. "
            "Add: op.create_index('ix_events_repo_received_at', 'events', ['repo', 'received_at'])"
        )


# ---------------------------------------------------------------------------
# 3. Data round-trip: store and retrieve via the events table
# ---------------------------------------------------------------------------


class TestEventsTableDataRoundTrip:
    """Rows can be inserted into and read from the events table."""

    def test_insert_and_select_event_row(self, pg_engine):
        """A row with JSONB payload round-trips correctly through the events table."""
        import json
        import sqlalchemy

        sample_payload = {"action": "completed", "sha": "abc123", "ref": "refs/heads/main"}
        sample_received_at = "2026-01-15T12:00:00+00:00"

        with pg_engine.connect() as conn:
            conn.execute(
                sqlalchemy.text(
                    "INSERT INTO events (repo, event_type, payload, received_at) "
                    "VALUES (:repo, :event_type, :payload::jsonb, :received_at::timestamptz)"
                ),
                {
                    "repo": "org/repo-round-trip-test",
                    "event_type": "push",
                    "payload": json.dumps(sample_payload),
                    "received_at": sample_received_at,
                },
            )
            conn.commit()

            result = conn.execute(
                sqlalchemy.text(
                    "SELECT repo, event_type, payload, received_at "
                    "FROM events WHERE repo = :repo"
                ),
                {"repo": "org/repo-round-trip-test"},
            )
            row = result.fetchone()

            # Cleanup
            conn.execute(
                sqlalchemy.text("DELETE FROM events WHERE repo = :repo"),
                {"repo": "org/repo-round-trip-test"},
            )
            conn.commit()

        assert row is not None, "Inserted row was not found on SELECT"
        assert row[0] == "org/repo-round-trip-test"
        assert row[1] == "push"
        # payload should be returned as a dict (JSONB) or JSON string
        payload_value = row[2]
        if isinstance(payload_value, str):
            payload_value = json.loads(payload_value)
        assert payload_value.get("sha") == "abc123", (
            f"JSONB payload not round-tripped correctly; got: {payload_value}"
        )

    def test_repo_not_null_constraint_is_enforced(self, pg_engine):
        """Inserting a row with NULL repo must raise an IntegrityError."""
        import json
        import sqlalchemy

        with pytest.raises(Exception, match=r"(?i)(null|not.null|violat)"):
            with pg_engine.connect() as conn:
                conn.execute(
                    sqlalchemy.text(
                        "INSERT INTO events (repo, event_type, payload, received_at) "
                        "VALUES (NULL, 'push', '{}'::jsonb, now())"
                    )
                )
                conn.commit()

    def test_event_type_not_null_constraint_is_enforced(self, pg_engine):
        """Inserting a row with NULL event_type must raise an IntegrityError."""
        import sqlalchemy

        with pytest.raises(Exception, match=r"(?i)(null|not.null|violat)"):
            with pg_engine.connect() as conn:
                conn.execute(
                    sqlalchemy.text(
                        "INSERT INTO events (repo, event_type, payload, received_at) "
                        "VALUES ('org/repo', NULL, '{}'::jsonb, now())"
                    )
                )
                conn.commit()


# ---------------------------------------------------------------------------
# 4. Downgrade rollback safety
# ---------------------------------------------------------------------------


class TestEventsTableMigrationDowngrade:
    """Running alembic downgrade -1 must remove the events table cleanly."""

    def test_downgrade_one_step_removes_events_table(self):
        """alembic downgrade -1 drops events; alembic upgrade head restores it."""
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

        # Downgrade one step — the events table migration should be reverted
        command.downgrade(cfg, "-1")

        engine = sqlalchemy.create_engine(url)
        try:
            inspector = sqlalchemy.inspect(engine)
            table_names = inspector.get_table_names()
            assert "events" not in table_names, (
                f"'events' table should be absent after downgrade -1; "
                f"still present. Tables found: {table_names}"
            )
        finally:
            engine.dispose()
            # Re-apply the migration so the DB is clean for subsequent tests
            command.upgrade(cfg, "head")

    def test_downgrade_does_not_remove_earlier_dora_tables(self):
        """Downgrading the events migration must leave earlier DORA tables intact."""
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

        command.downgrade(cfg, "-1")

        engine = sqlalchemy.create_engine(url)
        try:
            inspector = sqlalchemy.inspect(engine)
            table_names = inspector.get_table_names()
            # The original DORA tables from migration 001 must still be present
            for table in ("deployment_events", "pr_events", "push_events"):
                assert table in table_names, (
                    f"Table '{table}' was unexpectedly removed during downgrade -1. "
                    "The events table migration must only drop the events table."
                )
        finally:
            engine.dispose()
            command.upgrade(cfg, "head")
