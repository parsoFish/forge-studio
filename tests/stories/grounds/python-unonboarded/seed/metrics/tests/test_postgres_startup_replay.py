"""Unit tests for replay_counters_from_store() — hydrates Prometheus DORA counters from PostgreSQL.

replay_counters_from_store() is the startup hydration mechanism that reads
persisted events from an EventStore (PostgreSQL in production, InMemoryEventStore
in tests) and increments Prometheus counters, ensuring /metrics reflects history
after a container restart.

These tests use InMemoryEventStore as the test double — no real PostgreSQL
connection is required for unit-level verification.

Behaviour contract:
  1. An empty store leaves all counters at 0.
  2. Push events increment the push counter by their count only.
  3. PR (pull_request) events increment the PR counter by their count only.
  4. Deployment status events increment the deployment counter by their count only.
  5. Each counter is incremented independently — push events do not spill into the
     PR or deployment counters.
  6. The function must not raise for any valid EventStore implementation.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest
from prometheus_client import CollectorRegistry, Counter, generate_latest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


# ---------------------------------------------------------------------------
# Helper: parse counter value from Prometheus text format
# ---------------------------------------------------------------------------


def _get_counter_value(counter: Counter, registry: CollectorRegistry) -> float:
    """Return a Counter's current value by parsing Prometheus text output.

    Avoids accessing private attributes; uses the public generate_latest API.
    Prometheus appends '_total' to Counter metric names in the text exposition.
    """
    text = generate_latest(registry).decode("utf-8")
    expected_name = counter._name + "_total"
    for line in text.splitlines():
        if line.startswith(expected_name) and not line.startswith("#"):
            parts = line.split()
            if len(parts) >= 2:
                return float(parts[-1])
    return 0.0


# ---------------------------------------------------------------------------
# Fixtures — fresh per test to prevent counter pollution across tests
# ---------------------------------------------------------------------------


@pytest.fixture
def registry():
    """Fresh CollectorRegistry per test so counter values do not bleed between tests."""
    return CollectorRegistry()


@pytest.fixture
def push_counter(registry):
    """Fresh push events Counter backed by the isolated test registry."""
    return Counter(
        "gitweave_push_events",
        "Total push events processed",
        registry=registry,
    )


@pytest.fixture
def pr_counter(registry):
    """Fresh PR merged events Counter backed by the isolated test registry."""
    return Counter(
        "gitweave_pr_merged",
        "Total merged pull request events processed",
        registry=registry,
    )


@pytest.fixture
def deployment_counter(registry):
    """Fresh deployment status events Counter backed by the isolated test registry."""
    return Counter(
        "gitweave_deployment_events",
        "Total deployment status events processed",
        registry=registry,
    )


# ---------------------------------------------------------------------------
# Sample event factory helpers
# ---------------------------------------------------------------------------


def _push_event(repo: str = "test/repo") -> dict:
    return {
        "event_type": "push",
        "repo": repo,
        "ref": "refs/heads/main",
        "commits": [],
        "created_at": datetime.now(timezone.utc),
    }


def _pr_event(repo: str = "test/repo") -> dict:
    return {
        "event_type": "pull_request",
        "repo": repo,
        "pr_number": 1,
        "commit_sha": "abc123",
        "merged_at": datetime.now(timezone.utc),
        "created_at": datetime.now(timezone.utc),
    }


def _deployment_event(repo: str = "test/repo") -> dict:
    return {
        "event_type": "deployment_status",
        "repo": repo,
        "environment": "production",
        "state": "success",
        "deployment_id": 42,
        "created_at": datetime.now(timezone.utc),
    }


# ---------------------------------------------------------------------------
# Importability
# ---------------------------------------------------------------------------


class TestReplayCountersFromStoreIsImportable:
    """replay_counters_from_store must be importable from the replay module."""

    def test_function_is_importable_from_replay_module(self):
        """replay_counters_from_store must exist in the replay module as a callable."""
        from replay import replay_counters_from_store  # noqa: F401

        assert callable(replay_counters_from_store), (
            "replay_counters_from_store must be a callable exported from replay.py"
        )


# ---------------------------------------------------------------------------
# Empty store — all counters stay at zero
# ---------------------------------------------------------------------------


class TestReplayCountersFromEmptyStore:
    """replay_counters_from_store must leave all counters at 0 when the store is empty."""

    def test_push_counter_stays_at_zero_for_empty_store(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """An empty store must not increment the push counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        replay_counters_from_store(InMemoryEventStore(), push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 0.0, (
            "Push counter must remain at 0 when the store has no push events"
        )

    def test_pr_counter_stays_at_zero_for_empty_store(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """An empty store must not increment the PR counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        replay_counters_from_store(InMemoryEventStore(), push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(pr_counter, registry) == 0.0, (
            "PR counter must remain at 0 when the store has no PR events"
        )

    def test_deployment_counter_stays_at_zero_for_empty_store(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """An empty store must not increment the deployment counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        replay_counters_from_store(InMemoryEventStore(), push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(deployment_counter, registry) == 0.0, (
            "Deployment counter must remain at 0 when the store has no deployment events"
        )

    def test_does_not_raise_for_empty_store(
        self, push_counter, pr_counter, deployment_counter
    ):
        """replay_counters_from_store must not raise when the store is empty."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        try:
            replay_counters_from_store(InMemoryEventStore(), push_counter, pr_counter, deployment_counter)
        except Exception as exc:
            pytest.fail(
                f"replay_counters_from_store must not raise for an empty store; got: {exc}"
            )


# ---------------------------------------------------------------------------
# Push events
# ---------------------------------------------------------------------------


class TestReplayCountersFromStoreWithPushEvents:
    """replay_counters_from_store increments push counter by the number of stored push events."""

    def test_push_counter_is_1_for_single_push_event(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """A single stored push event must increment the push counter to 1."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_push_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 1.0, (
            "Push counter must be 1 after replaying a single push event"
        )

    def test_push_counter_equals_total_push_event_count(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """The push counter must equal the number of push events stored."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for _ in range(7):
            store.store_event(_push_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 7.0, (
            "Push counter must equal the total number of stored push events (7)"
        )

    def test_pr_counter_stays_at_zero_when_only_push_events_present(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """Push events must not spill into the PR counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_push_event())
        store.store_event(_push_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(pr_counter, registry) == 0.0, (
            "PR counter must remain at 0 when only push events are in the store"
        )

    def test_deployment_counter_stays_at_zero_when_only_push_events_present(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """Push events must not spill into the deployment counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_push_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(deployment_counter, registry) == 0.0, (
            "Deployment counter must remain at 0 when only push events are in the store"
        )


# ---------------------------------------------------------------------------
# PR events
# ---------------------------------------------------------------------------


class TestReplayCountersFromStoreWithPREvents:
    """replay_counters_from_store increments the PR counter by the number of stored PR events."""

    def test_pr_counter_equals_total_pr_event_count(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """The PR counter must equal the number of pull_request events stored."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for _ in range(3):
            store.store_event(_pr_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(pr_counter, registry) == 3.0, (
            "PR counter must equal the number of stored pull_request events (3)"
        )

    def test_push_counter_stays_at_zero_when_only_pr_events_present(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """PR events must not spill into the push counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_pr_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 0.0, (
            "Push counter must remain at 0 when only PR events are in the store"
        )

    def test_deployment_counter_stays_at_zero_when_only_pr_events_present(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """PR events must not spill into the deployment counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_pr_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(deployment_counter, registry) == 0.0, (
            "Deployment counter must remain at 0 when only PR events are in the store"
        )


# ---------------------------------------------------------------------------
# Deployment events
# ---------------------------------------------------------------------------


class TestReplayCountersFromStoreWithDeploymentEvents:
    """replay_counters_from_store increments the deployment counter by stored deployment events."""

    def test_deployment_counter_equals_total_deployment_event_count(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """The deployment counter must equal the number of deployment_status events stored."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for _ in range(4):
            store.store_event(_deployment_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(deployment_counter, registry) == 4.0, (
            "Deployment counter must equal the number of stored deployment_status events (4)"
        )

    def test_push_and_pr_counters_stay_at_zero_when_only_deployment_events_present(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """Deployment events must not spill into push or PR counters."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_deployment_event())
        store.store_event(_deployment_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 0.0
        assert _get_counter_value(pr_counter, registry) == 0.0


# ---------------------------------------------------------------------------
# Mixed events — each counter is independent
# ---------------------------------------------------------------------------


class TestReplayCountersFromStoreWithMixedEvents:
    """replay_counters_from_store counts each event type independently."""

    def test_each_counter_incremented_independently_for_mixed_event_types(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """With 2 push, 3 PR, 1 deployment, each counter must reflect its own count."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        for _ in range(2):
            store.store_event(_push_event())
        for _ in range(3):
            store.store_event(_pr_event())
        store.store_event(_deployment_event())

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 2.0, (
            "Push counter must be 2 — only push events count toward it"
        )
        assert _get_counter_value(pr_counter, registry) == 3.0, (
            "PR counter must be 3 — only pull_request events count toward it"
        )
        assert _get_counter_value(deployment_counter, registry) == 1.0, (
            "Deployment counter must be 1 — only deployment_status events count toward it"
        )

    def test_push_counter_reflects_only_push_events_not_total_events(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """Push counter must count ONLY push-typed events, ignoring all others."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_push_event())   # 1 push
        store.store_event(_pr_event())     # must not be counted as push
        store.store_event(_deployment_event())  # must not be counted as push

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 1.0, (
            "Push counter must be 1 even when 3 total events exist — "
            "only events of type 'push' must be counted"
        )

    def test_different_repos_counted_together_per_event_type(
        self, push_counter, pr_counter, deployment_counter, registry
    ):
        """Events from different repositories must all count toward the same counter."""
        from replay import replay_counters_from_store
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event(_push_event(repo="org/repo-a"))
        store.store_event(_push_event(repo="org/repo-b"))
        store.store_event(_push_event(repo="org/repo-c"))

        replay_counters_from_store(store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 3.0, (
            "All push events regardless of repository must count toward the push counter"
        )


# ---------------------------------------------------------------------------
# PostgreSQL store — skipped without TEST_DATABASE_URL
# ---------------------------------------------------------------------------


class TestReplayCountersFromPostgreSQLStore:
    """replay_counters_from_store must work with a real PostgreSQL EventStore."""

    def test_increments_counters_from_postgresql_store(
        self, pg_store, push_counter, pr_counter, deployment_counter, registry
    ):
        """Seed events in PostgreSQL and verify counters are updated correctly."""
        from replay import replay_counters_from_store

        pg_store.store_event(_push_event("org/repo"))
        pg_store.store_event(_push_event("org/repo"))
        pg_store.store_event(_deployment_event("org/repo"))

        replay_counters_from_store(pg_store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 2.0, (
            "Push counter must be 2 — two push events were seeded in PostgreSQL"
        )
        assert _get_counter_value(deployment_counter, registry) == 1.0, (
            "Deployment counter must be 1 — one deployment event was seeded"
        )
        assert _get_counter_value(pr_counter, registry) == 0.0, (
            "PR counter must remain at 0 — no PR events were seeded"
        )

    def test_empty_postgresql_store_leaves_all_counters_at_zero(
        self, pg_store, push_counter, pr_counter, deployment_counter, registry
    ):
        """An empty PostgreSQL store must not increment any counter."""
        from replay import replay_counters_from_store

        replay_counters_from_store(pg_store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 0.0
        assert _get_counter_value(pr_counter, registry) == 0.0
        assert _get_counter_value(deployment_counter, registry) == 0.0

    def test_replay_with_multiple_repos_in_postgresql(
        self, pg_store, push_counter, pr_counter, deployment_counter, registry
    ):
        """Events from multiple repos must all be counted in the PostgreSQL replay."""
        from replay import replay_counters_from_store

        for repo in ("org/repo-a", "org/repo-b", "org/repo-c"):
            pg_store.store_event(_push_event(repo))
        pg_store.store_event(_pr_event("org/repo-a"))
        pg_store.store_event(_pr_event("org/repo-b"))

        replay_counters_from_store(pg_store, push_counter, pr_counter, deployment_counter)

        assert _get_counter_value(push_counter, registry) == 3.0, (
            "Push counter must aggregate across all repositories"
        )
        assert _get_counter_value(pr_counter, registry) == 2.0, (
            "PR counter must aggregate across all repositories"
        )
