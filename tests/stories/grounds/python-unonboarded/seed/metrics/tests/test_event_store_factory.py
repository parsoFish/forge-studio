"""Unit tests for create_event_store() factory function.

create_event_store() reads DATABASE_URL from the environment:
  - DATABASE_URL absent or empty string → InMemoryEventStore (default for dev)
  - DATABASE_URL set to a non-empty string → PostgreSQLEventStore

These tests use monkeypatching to control the environment without requiring
a real database connection.  PostgreSQLEventStore is expected to defer
connection establishment (lazy connect) so the factory can return an
instance without DATABASE_URL pointing to a live server.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


class TestCreateEventStoreFactory:
    """create_event_store() returns the correct implementation based on DATABASE_URL."""

    def test_returns_inmemory_store_when_database_url_is_absent(self, monkeypatch):
        from store import InMemoryEventStore, create_event_store

        monkeypatch.delenv("DATABASE_URL", raising=False)
        store = create_event_store()
        assert isinstance(store, InMemoryEventStore)

    def test_returns_inmemory_store_when_database_url_is_empty_string(self, monkeypatch):
        """Empty DATABASE_URL is treated as absent — default to in-memory store."""
        from store import InMemoryEventStore, create_event_store

        monkeypatch.setenv("DATABASE_URL", "")
        store = create_event_store()
        assert isinstance(store, InMemoryEventStore)

    def test_returns_postgresql_store_when_database_url_is_set(self, monkeypatch):
        """Non-empty DATABASE_URL triggers PostgreSQLEventStore construction."""
        from store import PostgreSQLEventStore, create_event_store

        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/gitweave")
        store = create_event_store()
        assert isinstance(store, PostgreSQLEventStore)

    def test_returned_store_satisfies_event_store_protocol_when_no_url(self, monkeypatch):
        from store import EventStore, create_event_store

        monkeypatch.delenv("DATABASE_URL", raising=False)
        store = create_event_store()
        assert isinstance(store, EventStore)

    def test_returned_store_satisfies_event_store_protocol_when_url_set(self, monkeypatch):
        from store import EventStore, create_event_store

        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/gitweave")
        store = create_event_store()
        assert isinstance(store, EventStore)

    def test_factory_is_exported_from_store_module(self):
        """create_event_store must be a public symbol in the store module."""
        import importlib

        store_module = importlib.import_module("store")
        assert hasattr(store_module, "create_event_store"), (
            "store module must export create_event_store()"
        )

    def test_factory_is_callable(self):
        from store import create_event_store

        assert callable(create_event_store)

    def test_inmemory_store_from_factory_is_fully_functional(self, monkeypatch):
        """The InMemoryEventStore returned by the factory must pass a basic store/get cycle."""
        from store import create_event_store

        monkeypatch.delenv("DATABASE_URL", raising=False)
        store = create_event_store()

        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1

    def test_postgresql_store_from_factory_does_not_connect_eagerly(self, monkeypatch):
        """Constructing a PostgreSQLEventStore must not raise even if the DB is unreachable.

        The factory is called at process startup before the database may be ready.
        Connection must be deferred until the first query or explicitly opened.
        """
        from store import create_event_store

        # Deliberately unreachable DB URL — should not raise during construction
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://ghost:ghost@192.0.2.1:5432/nonexistent",
        )
        try:
            store = create_event_store()
            # Just constructing the store must not raise
            assert store is not None
        except Exception as exc:  # noqa: BLE001
            pytest.fail(
                f"create_event_store() must not raise on unreachable DB URL "
                f"during construction; got {type(exc).__name__}: {exc}"
            )

    def test_calling_factory_twice_returns_independent_instances(self, monkeypatch):
        """Each call to create_event_store() returns a fresh, independent store."""
        from store import create_event_store

        monkeypatch.delenv("DATABASE_URL", raising=False)
        store1 = create_event_store()
        store2 = create_event_store()

        store1.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = store2.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 0, (
            "Each create_event_store() call must return an independent instance — "
            "events in store1 must not appear in store2"
        )


class TestCreateEventStoreEnvironmentPrecedence:
    """DATABASE_URL must take precedence correctly in all edge cases."""

    def test_whitespace_only_database_url_treated_as_empty(self, monkeypatch):
        """A DATABASE_URL containing only whitespace should fall back to InMemoryEventStore."""
        from store import InMemoryEventStore, create_event_store

        monkeypatch.setenv("DATABASE_URL", "   ")
        store = create_event_store()
        assert isinstance(store, InMemoryEventStore)

    def test_valid_postgres_url_returns_postgresql_store(self, monkeypatch):
        from store import PostgreSQLEventStore, create_event_store

        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql+asyncpg://user:pass@localhost:5432/db",
        )
        store = create_event_store()
        assert isinstance(store, PostgreSQLEventStore)
