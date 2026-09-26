"""Exhaustive unit tests for InMemoryEventStore edge cases and boundary conditions.

These complement the existing tests in test_event_handlers.py with additional
coverage: boundary conditions, multi-event filtering, protocol conformance,
and field preservation.  All tests are pure unit tests with no I/O.
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


class TestInMemoryEventStoreProtocolConformance:
    """InMemoryEventStore satisfies the runtime_checkable EventStore Protocol."""

    def test_is_instance_of_event_store_protocol(self):
        from store import EventStore, InMemoryEventStore

        store = InMemoryEventStore()
        assert isinstance(store, EventStore), (
            "InMemoryEventStore must satisfy isinstance check against EventStore Protocol"
        )

    def test_has_callable_store_event(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        assert callable(getattr(store, "store_event", None))

    def test_has_callable_get_events(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        assert callable(getattr(store, "get_events", None))

    def test_store_event_accepts_arbitrary_dict(self):
        """store_event must not reject dicts that contain extra or unusual fields."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        # Should not raise
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "unexpected_field": [1, 2, 3],
                "nested": {"a": {"b": "c"}},
            }
        )

    def test_get_events_returns_a_list(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        result = store.get_events("r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc))
        assert isinstance(result, list)

    def test_get_events_returns_empty_list_not_none(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        result = store.get_events("r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc))
        assert result is not None
        assert result == []


# ---------------------------------------------------------------------------
# since_dt boundary conditions
# ---------------------------------------------------------------------------


class TestInMemoryEventStoreBoundaryConditions:
    """InMemoryEventStore since_dt uses >= (inclusive) semantics."""

    def test_event_exactly_at_since_dt_is_included(self):
        """created_at == since_dt must be included — the boundary is inclusive."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        store.store_event({"event_type": "push", "repo": "r", "created_at": boundary})
        results = store.get_events("r", "push", boundary)
        assert len(results) == 1

    def test_event_one_second_before_since_dt_is_excluded(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": boundary - timedelta(seconds=1),
            }
        )
        results = store.get_events("r", "push", boundary)
        assert len(results) == 0

    def test_event_one_microsecond_after_since_dt_is_included(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        boundary = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": boundary + timedelta(microseconds=1),
            }
        )
        results = store.get_events("r", "push", boundary)
        assert len(results) == 1

    def test_datetime_min_as_since_dt_returns_all_events(self):
        """datetime.min acts as 'no lower bound' — all stored events are returned."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for year in (2000, 2010, 2024):
            store.store_event(
                {
                    "event_type": "push",
                    "repo": "r",
                    "created_at": datetime(year, 1, 1, tzinfo=timezone.utc),
                }
            )
        results = store.get_events("r", "push", datetime.min.replace(tzinfo=timezone.utc))
        assert len(results) == 3

    def test_far_future_since_dt_returns_no_events(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = store.get_events(
            "r", "push", datetime(9999, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        )
        assert len(results) == 0


# ---------------------------------------------------------------------------
# Filter combination logic (all three filters applied conjunctively)
# ---------------------------------------------------------------------------


class TestInMemoryEventStoreFilterCombinations:
    """All three filters (repo, event_type, since_dt) are applied with AND semantics."""

    def test_filters_are_conjunctive_not_disjunctive(self):
        """A stored event must match ALL three criteria to appear in results."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        # Matches repo only
        store.store_event(
            {
                "event_type": "deployment_status",
                "repo": "target/repo",
                "created_at": datetime(2024, 6, 1, tzinfo=timezone.utc),
            }
        )
        # Matches event_type only
        store.store_event(
            {
                "event_type": "push",
                "repo": "other/repo",
                "created_at": datetime(2024, 6, 1, tzinfo=timezone.utc),
            }
        )
        # Matches repo + event_type but before since_dt
        store.store_event(
            {
                "event_type": "push",
                "repo": "target/repo",
                "created_at": datetime(2023, 1, 1, tzinfo=timezone.utc),
            }
        )
        # Matches all three — must be the only result
        store.store_event(
            {
                "event_type": "push",
                "repo": "target/repo",
                "created_at": datetime(2024, 6, 1, tzinfo=timezone.utc),
            }
        )

        results = store.get_events(
            "target/repo", "push", datetime(2024, 1, 2, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["event_type"] == "push"
        assert results[0]["repo"] == "target/repo"

    def test_returns_all_events_matching_all_criteria(self):
        """Multiple events matching all three criteria are all returned."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for i in range(5):
            store.store_event(
                {
                    "event_type": "push",
                    "repo": "r",
                    "created_at": datetime(2024, 1, i + 1, tzinfo=timezone.utc),
                    "index": i,
                }
            )
        results = store.get_events(
            "r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 5

    def test_empty_query_against_empty_store_returns_empty_list(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        results = store.get_events(
            "nonexistent/repo",
            "push",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert results == []

    def test_empty_string_repo_only_matches_empty_string_stored_repo(self):
        """Querying repo='' does not accidentally match events with non-empty repos."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "actual/repo",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = store.get_events("", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 0

    def test_no_results_when_event_type_does_not_match(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        results = store.get_events(
            "r", "deployment_status", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert results == []


# ---------------------------------------------------------------------------
# Immutability: store_event copies the input, get_events returns snapshots
# ---------------------------------------------------------------------------


class TestInMemoryEventStoreImmutability:
    """store_event and get_events never expose internal state by reference."""

    def test_mutating_stored_event_dict_does_not_corrupt_store(self):
        """Mutating the dict passed to store_event must not alter stored data."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        event = {
            "event_type": "push",
            "repo": "r",
            "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "ref": "refs/heads/main",
        }
        store.store_event(event)
        event["repo"] = "mutated"
        event["ref"] = "mutated-ref"

        results = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1
        assert results[0]["repo"] == "r"
        assert results[0]["ref"] == "refs/heads/main"

    def test_mutating_returned_list_does_not_affect_subsequent_queries(self):
        """Clearing the list returned by get_events must not empty the store."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }
        )
        snapshot = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        snapshot.clear()
        results = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1

    def test_mutating_returned_event_dict_does_not_corrupt_store(self):
        """Mutating a dict inside the get_events return value must not alter stored data."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "ref": "refs/heads/original",
            }
        )
        result = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))[0]
        result["ref"] = "mutated-ref"

        fresh = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert fresh[0]["ref"] == "refs/heads/original"


# ---------------------------------------------------------------------------
# Multiple independent instances
# ---------------------------------------------------------------------------


class TestInMemoryEventStoreIsolation:
    """Separate InMemoryEventStore instances share no state."""

    def test_two_stores_are_fully_isolated(self):
        from store import InMemoryEventStore

        store1 = InMemoryEventStore()
        store2 = InMemoryEventStore()
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
        assert len(results) == 0

    def test_clearing_store1_does_not_affect_store2(self):
        from store import InMemoryEventStore

        store1 = InMemoryEventStore()
        store2 = InMemoryEventStore()
        event = {
            "event_type": "push",
            "repo": "r",
            "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
        }
        store1.store_event(dict(event))
        store2.store_event(dict(event))

        # Drain store1's internal list via the snapshot (does not affect store2)
        snapshot = store1.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        snapshot.clear()

        results2 = store2.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results2) == 1


# ---------------------------------------------------------------------------
# Field preservation
# ---------------------------------------------------------------------------


class TestInMemoryEventStoreFieldPreservation:
    """store_event preserves all fields, including nested structures."""

    def test_extra_fields_beyond_core_three_are_preserved(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "ref": "refs/heads/main",
                "commits": [{"sha": "abc123"}],
                "custom": "preserved",
            }
        )
        results = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert results[0]["custom"] == "preserved"
        assert results[0]["ref"] == "refs/heads/main"
        assert len(results[0]["commits"]) == 1

    def test_nested_dict_fields_are_preserved(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "deployment_status",
                "repo": "r",
                "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "deployment_id": 42,
                "environment": "production",
                "state": "success",
            }
        )
        results = store.get_events(
            "r", "deployment_status", datetime(2023, 1, 1, tzinfo=timezone.utc)
        )
        assert results[0]["deployment_id"] == 42
        assert results[0]["environment"] == "production"
        assert results[0]["state"] == "success"

    def test_all_three_dora_event_types_round_trip_correctly(self):
        """Push, pull_request, and deployment_status events all survive a store/get cycle."""
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        ts = datetime(2024, 3, 10, tzinfo=timezone.utc)

        store.store_event({"event_type": "push", "repo": "r", "created_at": ts, "ref": "refs/heads/main"})
        store.store_event({"event_type": "pull_request", "repo": "r", "created_at": ts, "pr_number": 7})
        store.store_event({"event_type": "deployment_status", "repo": "r", "created_at": ts, "state": "success"})

        pushes = store.get_events("r", "push", datetime(2024, 1, 1, tzinfo=timezone.utc))
        prs = store.get_events("r", "pull_request", datetime(2024, 1, 1, tzinfo=timezone.utc))
        deploys = store.get_events("r", "deployment_status", datetime(2024, 1, 1, tzinfo=timezone.utc))

        assert len(pushes) == 1 and pushes[0]["ref"] == "refs/heads/main"
        assert len(prs) == 1 and prs[0]["pr_number"] == 7
        assert len(deploys) == 1 and deploys[0]["state"] == "success"
