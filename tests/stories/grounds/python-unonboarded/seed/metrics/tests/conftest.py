"""Shared pytest fixtures for GitWeave metrics tests.

Provides fixtures for PostgreSQL integration tests that require a live
Postgres instance.  Set TEST_DATABASE_URL to enable them, e.g.:

    TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gitweave_test pytest

Tests that depend on these fixtures are automatically skipped when
TEST_DATABASE_URL is absent so the suite remains runnable without Docker.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

METRICS_DIR = Path(__file__).parent.parent
MIGRATIONS_DIR = METRICS_DIR / "migrations"


def _require_test_db_url() -> str:
    """Return TEST_DATABASE_URL or skip the test if unset."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip(
            "TEST_DATABASE_URL not set — skipping PostgreSQL integration tests. "
            "Set TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gitweave_test to run."
        )
    return url


@pytest.fixture(scope="session")
def _pg_migrations():
    """Run alembic upgrade head once per test session.

    Idempotent: running against an already-migrated DB is safe.
    Skips the entire session if TEST_DATABASE_URL is not set.
    """
    url = _require_test_db_url()

    alembic_ini = METRICS_DIR / "alembic.ini"
    if not alembic_ini.exists():
        pytest.skip(f"alembic.ini not found at {alembic_ini} — run alembic init first")

    from alembic import command  # noqa: PLC0415
    from alembic.config import Config  # noqa: PLC0415

    cfg = Config(str(alembic_ini))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")


@pytest.fixture()
def pg_store(_pg_migrations):
    """Fresh PostgreSQLEventStore per test with all event tables truncated.

    Depends on ``_pg_migrations`` to ensure the schema exists before
    attempting to truncate tables.  Each test function receives an empty
    store so tests are fully isolated.
    """
    import sqlalchemy  # noqa: PLC0415

    from store import PostgreSQLEventStore  # noqa: PLC0415

    url = _require_test_db_url()

    engine = sqlalchemy.create_engine(url)
    with engine.connect() as conn:
        conn.execute(
            sqlalchemy.text(
                "TRUNCATE TABLE deployment_events, pr_events, push_events RESTART IDENTITY CASCADE"
            )
        )
        conn.commit()
    engine.dispose()

    yield PostgreSQLEventStore(url)


@pytest.fixture()
def pg_engine(_pg_migrations):
    """Raw SQLAlchemy engine for schema inspection in migration tests."""
    import sqlalchemy  # noqa: PLC0415

    url = _require_test_db_url()
    engine = sqlalchemy.create_engine(url)
    yield engine
    engine.dispose()
