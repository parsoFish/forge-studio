"""TDD tests for PostgreSQLEventStore — written before implementation.

Specification-level tests that define the expected behaviour for the
PostgreSQLEventStore class as described in the work item:

  - store_event then get_events round-trip for all three DORA event types
  - Correct filtering by repo and event_type (conjunctive, not disjunctive)
  - Inclusive >= boundary semantics for since_dt
  - Naive datetime normalisation to UTC (both on write and on query)
  - Unknown event_type handled gracefully (no crash on store; empty list on get)
  - Multiple commits JSON round-trip (order preserved, count preserved)
  - Lazy initialisation — constructor must not open a database connection
  - psycopg2-binary is importable (dependency must be declared in requirements.txt)

All integration tests require a live PostgreSQL instance via the ``pg_store``
fixture defined in conftest.py.  Set TEST_DATABASE_URL to run them:

    TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gitweave_test pytest

Tests that require a DB are automatically skipped when TEST_DATABASE_URL is
absent so the suite remains runnable in CI environments without Docker.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


# ---------------------------------------------------------------------------
# Driver dependency — must fail (RED) until psycopg2-binary is in requirements
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreDependencies:
    """Runtime driver dependencies must be importable from a fresh virtualenv."""

    def test_psycopg2_is_importable(self):
        """psycopg2 must be importable — add psycopg2-binary to requirements.txt.

        SQLAlchemy uses psycopg2 for synchronous postgresql:// connections.
        This test is RED until ``psycopg2-binary`` is added to requirements.txt
        and installed.
        """
        import importlib.util

        spec = importlib.util.find_spec("psycopg2")
        assert spec is not None, (
            "psycopg2 is not importable. "
            "Add 'psycopg2-binary>=2.9' to requirements.txt and re-install."
        )

    def test_sqlalchemy_is_importable(self):
        """SQLAlchemy must be importable — already declared in requirements.txt."""
        import importlib.util

        assert importlib.util.find_spec("sqlalchemy") is not None


# ---------------------------------------------------------------------------
# Lazy initialisation — constructor must not open a DB connection
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreLazyInit:
    """Constructor stores the URL but defers engine creation until first use."""

    def test_constructor_does_not_raise_with_unreachable_url(self):
        """Constructing with a bad URL must not raise — only first I/O should."""
        from store import PostgreSQLEventStore

        store = PostgreSQLEventStore("postgresql://no-such-host:5432/nosuchdb")
        assert store is not None

    def test_engine_is_none_after_construction(self):
        """_engine must be None immediately after construction (lazy init)."""
        from store import PostgreSQLEventStore

        store = PostgreSQLEventStore("postgresql://dummy:5432/dummy")
        assert store._engine is None

    def test_engine_is_initialised_after_first_store_event(self, pg_store):
        """Calling store_event triggers lazy engine creation."""
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        assert pg_store._engine is not None


# ---------------------------------------------------------------------------
# Round-trip: store_event → get_events for all three DORA event types
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreRoundTrip:
    """All three DORA event types survive a store→retrieve cycle without data loss."""

    def test_push_event_round_trip(self, pg_store):
        event = {
            "event_type": "push",
            "repo": "octocat/Hello-World",
            "ref": "refs/heads/main",
            "commits": [{"sha": "abc123", "timestamp": "2024-03-10T10:00:00+00:00"}],
            "created_at": datetime(2024, 3, 10, 12, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["repo"] == "octocat/Hello-World"
        assert results[0]["ref"] == "refs/heads/main"
        assert results[0]["commits"][0]["sha"] == "abc123"

    def test_pull_request_event_round_trip(self, pg_store):
        event = {
            "event_type": "pull_request",
            "repo": "octocat/Hello-World",
            "pr_number": 42,
            "commit_sha": "e5bd3914e2e596debea16f433f57875b5b90bcd6",
            "merged_at": datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc),
            "created_at": datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World", "pull_request", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["pr_number"] == 42
        assert results[0]["commit_sha"] == "e5bd3914e2e596debea16f433f57875b5b90bcd6"
        assert results[0]["merged_at"] == datetime(2024, 3, 10, 14, 0, 0, tzinfo=timezone.utc)

    def test_deployment_status_event_round_trip(self, pg_store):
        event = {
            "event_type": "deployment_status",
            "repo": "octocat/Hello-World",
            "environment": "production",
            "state": "success",
            "deployment_id": 99,
            "created_at": datetime(2024, 3, 10, 15, 0, 0, tzinfo=timezone.utc),
        }
        pg_store.store_event(event)
        results = pg_store.get_events(
            "octocat/Hello-World",
            "deployment_status",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1
        assert results[0]["environment"] == "production"
        assert results[0]["state"] == "success"
        assert results[0]["deployment_id"] == 99

    def test_retrieved_event_always_includes_event_type_field(self, pg_store):
        """get_events injects event_type back into each returned dict."""
        for event_type in ("push", "pull_request", "deployment_status"):
            pg_store.store_event(
                {
                    "event_type": event_type,
                    "repo": "r",
                    "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                }
            )
            results = pg_store.get_events(
                "r", event_type, datetime(2023, 1, 1, tzinfo=timezone.utc)
            )
            assert results[0]["event_type"] == event_type, (
                f"event_type field must be '{event_type}' in returned dict"
            )

    def test_retrieved_event_always_includes_repo_field(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "myorg/myrepo",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "myorg/myrepo", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert results[0]["repo"] == "myorg/myrepo"

    def test_retrieved_event_created_at_is_timezone_aware(self, pg_store):
        """created_at returned by get_events must always have tzinfo set."""
        ts = datetime(2024, 3, 15, 9, 30, 0, tzinfo=timezone.utc)
        pg_store.store_event({"event_type": "push", "repo": "r", "created_at": ts})
        results = pg_store.get_events("r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc))
        assert results[0]["created_at"].tzinfo is not None
        assert results[0]["created_at"] == ts


# ---------------------------------------------------------------------------
# Filtering — repo, event_type, and since_dt are applied conjunctively
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreFiltering:
    """All three filter dimensions (repo, event_type, since_dt) use AND semantics."""

    def test_filters_by_repo_only_returns_matching_repo(self, pg_store):
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "target/repo",
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
            "target/repo", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["repo"] == "target/repo"

    def test_filters_by_event_type_does_not_mix_event_tables(self, pg_store):
        """push and deployment_status events stored together must not bleed across queries."""
        ts = datetime(2024, 1, 15, tzinfo=timezone.utc)
        pg_store.store_event(
            {"event_type": "push", "repo": "r", "created_at": ts}
        )
        pg_store.store_event(
            {
                "event_type": "deployment_status",
                "repo": "r",
                "state": "success",
                "created_at": ts,
            }
        )
        push_results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        deploy_results = pg_store.get_events(
            "r", "deployment_status", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(push_results) == 1
        assert push_results[0]["event_type"] == "push"
        assert len(deploy_results) == 1
        assert deploy_results[0]["event_type"] == "deployment_status"

    def test_since_dt_excludes_events_strictly_before_boundary(self, pg_store):
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

    def test_since_dt_is_inclusive_at_exact_boundary(self, pg_store):
        """created_at == since_dt is included — boundary uses >= semantics."""
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        pg_store.store_event(
            {"event_type": "push", "repo": "r", "created_at": boundary}
        )
        results = pg_store.get_events("r", "push", boundary)
        assert len(results) == 1

    def test_since_dt_excludes_event_one_second_before_boundary(self, pg_store):
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

    def test_all_three_filters_applied_conjunctively(self, pg_store):
        """Only the event matching ALL three criteria appears in results."""
        ts = datetime(2024, 6, 1, tzinfo=timezone.utc)
        # Matches repo but wrong event_type
        pg_store.store_event(
            {"event_type": "deployment_status", "repo": "target/repo", "created_at": ts}
        )
        # Matches event_type but wrong repo
        pg_store.store_event(
            {"event_type": "push", "repo": "other/repo", "created_at": ts}
        )
        # Matches repo + event_type but before since_dt
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "target/repo",
                "created_at": datetime(2023, 1, 1, tzinfo=timezone.utc),
            }
        )
        # Matches all three — the only expected result
        pg_store.store_event(
            {"event_type": "push", "repo": "target/repo", "created_at": ts}
        )
        results = pg_store.get_events(
            "target/repo", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["event_type"] == "push"
        assert results[0]["repo"] == "target/repo"


# ---------------------------------------------------------------------------
# Naive datetime normalisation
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreDatetimeNormalisation:
    """Naive datetimes (tzinfo=None) must be treated as UTC throughout."""

    def test_store_event_with_naive_created_at_is_retrievable(self, pg_store):
        """A naive created_at is stored as UTC and returned with tzinfo=UTC."""
        naive_dt = datetime(2024, 5, 1, 10, 0, 0)
        assert naive_dt.tzinfo is None

        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "ref": "refs/heads/main",
                "commits": [],
                "created_at": naive_dt,
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["created_at"].tzinfo is not None
        assert results[0]["created_at"] == datetime(2024, 5, 1, 10, 0, 0, tzinfo=timezone.utc)

    def test_naive_created_at_at_query_boundary_is_included(self, pg_store):
        """Naive created_at at exact boundary is included (naive ≡ UTC)."""
        naive_dt = datetime(2024, 6, 1, 0, 0, 0)
        pg_store.store_event(
            {"event_type": "push", "repo": "r", "created_at": naive_dt}
        )
        utc_boundary = datetime(2024, 6, 1, tzinfo=timezone.utc)
        results = pg_store.get_events("r", "push", utc_boundary)
        assert len(results) == 1

    def test_get_events_with_naive_since_dt_normalises_to_utc(self, pg_store):
        """A naive since_dt is treated as UTC — matching stored UTC events."""
        ts = datetime(2024, 6, 1, tzinfo=timezone.utc)
        pg_store.store_event({"event_type": "push", "repo": "r", "created_at": ts})

        naive_boundary = datetime(2024, 6, 1)  # same instant as ts, no tzinfo
        results = pg_store.get_events("r", "push", naive_boundary)
        assert len(results) == 1

    def test_missing_created_at_defaults_to_approximately_now_utc(self, pg_store):
        """An event without created_at is stored with now(UTC) and is retrievable."""
        before = datetime.now(timezone.utc) - timedelta(seconds=1)
        pg_store.store_event(
            {"event_type": "push", "repo": "r", "ref": "refs/heads/main", "commits": []}
        )
        results = pg_store.get_events("r", "push", before)
        assert len(results) == 1
        assert results[0]["created_at"] >= before


# ---------------------------------------------------------------------------
# Unknown event_type handling
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreUnknownEventType:
    """Unsupported event_type values must not crash the store."""

    def test_store_event_with_unknown_event_type_does_not_raise(self, pg_store):
        """Storing an unrecognised event_type falls back silently — no exception."""
        pg_store.store_event(
            {
                "event_type": "some_future_event_type",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        # Reaching here means no exception was raised

    def test_get_events_returns_empty_list_for_unknown_event_type(self, pg_store):
        """Querying an unrecognised event_type always returns [] — no table maps to it."""
        results = pg_store.get_events(
            "r", "unknown_event_type", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert results == []

    def test_unknown_event_does_not_appear_in_push_queries(self, pg_store):
        """An unknown-type event stored via fallback must not pollute push queries."""
        pg_store.store_event(
            {
                "event_type": "some_future_event_type",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 0

    def test_get_events_returns_empty_list_before_any_events_stored(self, pg_store):
        """Store starts empty — all queries return []."""
        for event_type in ("push", "pull_request", "deployment_status", "unknown"):
            results = pg_store.get_events(
                "r", event_type, datetime.min.replace(tzinfo=timezone.utc)
            )
            assert results == [], f"Expected [] for event_type={event_type!r}, got {results}"


# ---------------------------------------------------------------------------
# Multiple commits round-trip
# ---------------------------------------------------------------------------


class TestPostgreSQLEventStoreMultipleCommits:
    """Commits list is JSON-serialised for storage and deserialised on retrieval."""

    def test_push_with_multiple_commits_preserves_all_commits(self, pg_store):
        commits = [
            {"sha": "aaa111", "timestamp": "2024-03-10T10:00:00+00:00"},
            {"sha": "bbb222", "timestamp": "2024-03-10T11:00:00+00:00"},
            {"sha": "ccc333", "timestamp": "2024-03-10T12:00:00+00:00"},
        ]
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "ref": "refs/heads/main",
                "commits": commits,
                "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        stored = results[0]["commits"]
        assert len(stored) == 3
        assert stored[0]["sha"] == "aaa111"
        assert stored[1]["sha"] == "bbb222"
        assert stored[2]["sha"] == "ccc333"

    def test_push_commits_order_is_preserved_across_round_trip(self, pg_store):
        """Commit insertion order must be identical after JSON deserialisation."""
        commits = [{"sha": f"sha{i:03d}"} for i in range(10)]
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "ref": "refs/heads/main",
                "commits": commits,
                "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        stored_shas = [c["sha"] for c in results[0]["commits"]]
        assert stored_shas == [f"sha{i:03d}" for i in range(10)]

    def test_push_with_absent_commits_returns_empty_list(self, pg_store):
        """If commits field is absent from the event, get_events returns commits=[]."""
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "ref": "refs/heads/new-branch",
                # commits intentionally omitted
                "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert results[0]["commits"] == []

    def test_push_with_empty_commits_list_round_trips_to_empty_list(self, pg_store):
        """An explicit empty commits list is stored and returned as []."""
        pg_store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "ref": "refs/heads/branch",
                "commits": [],
                "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
            }
        )
        results = pg_store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert results[0]["commits"] == []
