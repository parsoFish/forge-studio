"""Integration tests for PostgreSQLEventStore.

Requires a live PostgreSQL instance.  Set TEST_DATABASE_URL to run:

    TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gitweave_test pytest

These tests verify that PostgreSQLEventStore satisfies the EventStore Protocol
with identical semantics to InMemoryEventStore — correct filtering, immutability
guarantees, cross-instance persistence, and round-trip fidelity for all three
DORA event types.

All tests use the ``pg_store`` fixture from conftest.py which:
  1. Runs alembic upgrade head (once per session)
  2. Truncates all event tables (once per test function)
  3. Returns a fresh PostgreSQLEventStore instance
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreProtocol:
    """PostgreSQLEventStore satisfies runtime_checkable EventStore Protocol."""

    def test_satisfies_event_store_protocol(self, pg_store):
        from store import EventStore

        assert isinstance(pg_store, EventStore), (
            "PostgreSQLEventStore must satisfy isinstance check against EventStore Protocol"
        )

    def test_has_callable_store_event(self, pg_store):
        assert callable(getattr(pg_store, "store_event", None))

    def test_has_callable_get_events(self, pg_store):
        assert callable(getattr(pg_store, "get_events", None))

    def test_get_events_returns_a_list(self, pg_store):
        result = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert isinstance(result, list)

    def test_postgresql_store_class_is_importable_from_store_module(self):
        """PostgreSQLEventStore must be exported from the store module."""
        import importlib

        store_module = importlib.import_module("store")
        assert hasattr(store_module, "PostgreSQLEventStore"), (
            "store module must export PostgreSQLEventStore"
        )


# ---------------------------------------------------------------------------
# Core behaviour — mirrors InMemoryEventStore contract
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreCore:
    """PostgreSQLEventStore core semantics match the EventStore contract."""

    def test_starts_empty_after_table_truncation(self, pg_store):
        results = pg_store.get_events(
            "octocat/Hello-World",
            "push",
            datetime.min.replace(tzinfo=timezone.utc),
        )
        assert results == []

    def test_store_event_and_retrieve(self, pg_store):
        event = {
            "event_type": "push",
            "repo": "octocat/Hello-World",
            "ref": "refs/heads/main",
            "commits": [],
            "created_at": datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1
        assert results[0]["repo"] == "octocat/Hello-World"
        assert results[0]["ref"] == "refs/heads/main"

    def test_get_events_filters_by_repo(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "octocat/Hello-World",
                "created_at": datetime(2024, 1, 15, tzinfo=timezone.utc),
            }
        )
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "other/repo",
                "created_at": datetime(2024, 1, 15, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "octocat/Hello-World", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["repo"] == "octocat/Hello-World"

    def test_get_events_filters_by_event_type(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "octocat/Hello-World",
                "created_at": datetime(2024, 1, 15, tzinfo=timezone.utc),
            }
        )
        pg_store.store_event(
            {
                "event_type": "deployment_status",
                "repo": "octocat/Hello-World",
                "created_at": datetime(2024, 1, 15, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "octocat/Hello-World", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["event_type"] == "push"

    def test_get_events_filters_by_since_dt(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 6, 1, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 3, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["created_at"] == datetime(2024, 6, 1, tzinfo=timezone.utc)

    def test_get_events_includes_event_at_exact_boundary(self, pg_store):
        """created_at == since_dt is included — boundary is inclusive (>= semantics)."""
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        pg_store.store_event(
            {"event_type": "push", "repo": "r", "created_at": boundary}
        )
        results = pg_store.get_events("r", "push", boundary)
        assert len(results) == 1

    def test_get_events_excludes_event_one_second_before_boundary(self, pg_store):
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": boundary - timedelta(seconds=1),
            }
        )
        results = pg_store.get_events("r", "push", boundary)
        assert len(results) == 0

    def test_returns_multiple_events_matching_criteria(self, pg_store):
        for i in range(4):
            pg_store.store_event(
                {
                    "event_type": "push",
                    "repo": "r",
                    "created_at": datetime(2024, 1, i + 1, tzinfo=timezone.utc),
                }
            )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 4


# ---------------------------------------------------------------------------
# Immutability
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreImmutability:
    """PostgreSQLEventStore must not expose internal state by reference."""

    def test_store_event_does_not_mutate_input_dict(self, pg_store):
        event = {
            "event_type": "push",
            "repo": "r",
            "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "ref": "refs/heads/main",
        }
        pg_store.store_event(event)
        event["repo"] = "mutated"

        results = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["repo"] == "r"

    def test_mutating_returned_list_does_not_affect_store(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        snapshot = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        snapshot.clear()

        results = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1

    def test_mutating_returned_event_dict_does_not_corrupt_stored_data(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "ref": "refs/heads/original",
            }
        )
        result = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )[0]
        result["ref"] = "mutated-ref"

        fresh = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert fresh[0]["ref"] == "refs/heads/original"


# ---------------------------------------------------------------------------
# Persistence across instances
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStorePersistence:
    """Events stored via one instance are visible to a second instance on the same DB."""

    def test_events_persist_across_store_instances(self, pg_store):
        """A second PostgreSQLEventStore pointed at the same DB URL sees stored events."""
        from store import PostgreSQLEventStore

        url = os.environ.get("TEST_DATABASE_URL")
        assert url, "TEST_DATABASE_URL must be set for persistence tests"

        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "persistence/test",
                "created_at": datetime(2024, 3, 1, tzinfo=timezone.utc),
            }
        )

        # Fresh instance — different Python object, same DB connection string
        store2 = PostgreSQLEventStore(url)
        results = store2.get_events(
            "persistence/test", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1, (
            "Events written by one PostgreSQLEventStore instance must be "
            "readable by a separate instance connecting to the same database"
        )

    def test_events_are_not_lost_after_store_object_is_garbage_collected(self, pg_store):
        """Events survive the Python object being deleted (true persistence test)."""
        from store import PostgreSQLEventStore

        url = os.environ.get("TEST_DATABASE_URL")
        assert url

        pg_store.store_event(
            {
                "event_type": "deployment_status",
                "repo": "gc/test",
                "state": "success",
                "created_at": datetime(2024, 3, 1, tzinfo=timezone.utc),
            }
        )

        # Explicitly destroy the first store object
        del pg_store

        # A brand-new instance should still see the data
        store_new = PostgreSQLEventStore(url)
        results = store_new.get_events(
            "gc/test", "deployment_status", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1


# ---------------------------------------------------------------------------
# DORA event type round-trips
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreDORAEventTypes:
    """PostgreSQLEventStore correctly stores and retrieves all three DORA event types."""

    def test_stores_and_retrieves_deployment_event_with_all_fields(self, pg_store):
        event = {
            "event_type": "deployment_status",
            "repo": "octocat/Hello-World",
            "environment": "production",
            "state": "success",
            "deployment_id": 42,
            "created_at": datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World",
            "deployment_status",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1
        stored = results[0]
        assert stored["environment"] == "production"
        assert stored["state"] == "success"
        assert stored["deployment_id"] == 42
        assert stored["created_at"] == datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc)

    def test_stores_and_retrieves_pull_request_event_with_all_fields(self, pg_store):
        event = {
            "event_type": "pull_request",
            "repo": "octocat/Hello-World",
            "pr_number": 7,
            "commit_sha": "e5bd3914e2e596debea16f433f57875b5b90bcd6",
            "merged_at": datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc),
            "created_at": datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World",
            "pull_request",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1
        stored = results[0]
        assert stored["pr_number"] == 7
        assert stored["commit_sha"] == "e5bd3914e2e596debea16f433f57875b5b90bcd6"
        assert stored["merged_at"] == datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc)

    def test_stores_and_retrieves_push_event_with_commits_list(self, pg_store):
        event = {
            "event_type": "push",
            "repo": "octocat/Hello-World",
            "ref": "refs/heads/feature",
            "commits": [
                {
                    "sha": "abc123",
                    "timestamp": datetime(2024, 3, 10, tzinfo=timezone.utc).isoformat(),
                }
            ],
            "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1
        stored = results[0]
        assert stored["ref"] == "refs/heads/feature"
        assert len(stored["commits"]) == 1
        assert stored["commits"][0]["sha"] == "abc123"

    def test_stores_push_event_with_empty_commits_list(self, pg_store):
        """Push events with no commits (e.g., branch creation) must be stored."""
        event = {
            "event_type": "push",
            "repo": "r",
            "ref": "refs/heads/new-branch",
            "commits": [],
            "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["commits"] == []

    def test_deployment_failure_state_stored_correctly(self, pg_store):
        event = {
            "event_type": "deployment_status",
            "repo": "r",
            "environment": "staging",
            "state": "failure",
            "deployment_id": 99,
            "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "r", "deployment_status", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert results[0]["state"] == "failure"
        assert results[0]["environment"] == "staging"
