"""Integration tests for FastAPI lifespan context manager with PostgreSQL startup replay.

Validates that the FastAPI app:
  1. Has a configured lifespan context manager.
  2. Exports DORA Prometheus metric names in GET /metrics.
  3. Calls replay_counters_from_store() during startup so DORA counters are hydrated.
  4. After a simulated restart (new TestClient context), /metrics reflects the count
     of events persisted in the store before the restart.

"Restart simulation" in tests means: a fresh TestClient context is entered while
the EventStore is pre-populated with events from a previous session.  The lifespan
must replay those events into the Prometheus counters so /metrics shows the correct
historical count.

PostgreSQL-backed tests require TEST_DATABASE_URL and are skipped otherwise.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


# ---------------------------------------------------------------------------
# Helper: parse Prometheus text output
# ---------------------------------------------------------------------------


def _parse_prometheus_value(metrics_text: str, metric_name: str) -> float | None:
    """Extract a scalar metric value from Prometheus text exposition format.

    Returns the value for the first matching sample line, or None if the metric
    is absent.  Only matches non-comment lines starting with `metric_name`.
    """
    for line in metrics_text.splitlines():
        if line.startswith(metric_name) and not line.startswith("#"):
            parts = line.split()
            if len(parts) >= 2:
                return float(parts[-1])
    return None


def _dora_metric_is_present(metrics_text: str, metric_family_name: str) -> bool:
    """Return True if a HELP or TYPE line exists for the given metric family name."""
    for line in metrics_text.splitlines():
        if line.startswith(f"# HELP {metric_family_name}") or line.startswith(
            f"# TYPE {metric_family_name}"
        ):
            return True
    return False


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
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def app_module():
    """Import the FastAPI app module once per test module."""
    import main as m

    return m


# ---------------------------------------------------------------------------
# Lifespan is configured
# ---------------------------------------------------------------------------


class TestFastAPILifespanIsConfigured:
    """The FastAPI app must have a lifespan context manager configured."""

    def test_app_has_custom_lifespan_configured(self, app_module):
        """The FastAPI app must be initialised with a custom lifespan parameter.

        The lifespan is what ensures startup replay runs on container startup.
        Without it, DORA counters would always start at 0 after a restart.

        FastAPI always provides a _DefaultLifespan; we must verify the app has
        a CUSTOM lifespan (not the built-in no-op default).
        """
        lifespan = getattr(app_module.app.router, "lifespan_context", None)
        assert lifespan is not None, (
            "app.router.lifespan_context must be set"
        )
        # FastAPI's built-in default is '_DefaultLifespan'.  A custom lifespan
        # will have a different class name (AsyncContextManager, function, etc.).
        lifespan_class_name = type(lifespan).__name__
        assert lifespan_class_name != "_DefaultLifespan", (
            "app must be created with a custom lifespan= parameter, not the "
            f"FastAPI built-in _DefaultLifespan — got type: {lifespan_class_name}"
        )

    def test_lifespan_startup_does_not_crash_with_empty_store(self, app_module, monkeypatch):
        """The lifespan must complete without raising even when the EventStore is empty."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        try:
            with TestClient(app_module.app) as client:
                response = client.get("/healthz")
            assert response.status_code == 200
        except Exception as exc:
            pytest.fail(
                f"FastAPI lifespan must not raise when EventStore is empty; got: {exc}"
            )


# ---------------------------------------------------------------------------
# DORA metrics are exported
# ---------------------------------------------------------------------------


class TestDORAMetricsAreExported:
    """GET /metrics must include DORA Prometheus metric families after startup."""

    def test_metrics_endpoint_includes_push_events_metric_family(self, app_module, monkeypatch):
        """GET /metrics must expose a push events counter metric family."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        with TestClient(app_module.app) as client:
            response = client.get("/metrics")

        assert response.status_code == 200
        assert _dora_metric_is_present(response.text, "gitweave_push_events"), (
            "GET /metrics must contain '# HELP gitweave_push_events' or "
            "'# TYPE gitweave_push_events' — the push events DORA counter is missing"
        )

    def test_metrics_endpoint_includes_pr_merged_metric_family(self, app_module, monkeypatch):
        """GET /metrics must expose a PR merged counter metric family."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        with TestClient(app_module.app) as client:
            response = client.get("/metrics")

        assert response.status_code == 200
        assert _dora_metric_is_present(response.text, "gitweave_pr_merged"), (
            "GET /metrics must contain '# HELP gitweave_pr_merged' or "
            "'# TYPE gitweave_pr_merged' — the PR merged DORA counter is missing"
        )

    def test_metrics_endpoint_includes_deployment_events_metric_family(self, app_module, monkeypatch):
        """GET /metrics must expose a deployment events counter metric family."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        with TestClient(app_module.app) as client:
            response = client.get("/metrics")

        assert response.status_code == 200
        assert _dora_metric_is_present(response.text, "gitweave_deployment_events"), (
            "GET /metrics must contain '# HELP gitweave_deployment_events' or "
            "'# TYPE gitweave_deployment_events' — the deployment events DORA counter is missing"
        )


# ---------------------------------------------------------------------------
# Lifespan calls replay_counters_from_store during startup
# ---------------------------------------------------------------------------


class TestLifespanCallsReplayOnStartup:
    """The lifespan must call replay_counters_from_store during application startup."""

    def test_replay_counters_from_store_is_called_exactly_once_during_startup(
        self, app_module, monkeypatch
    ):
        """Starting the app must trigger exactly one call to replay_counters_from_store."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        call_count = {"n": 0}
        original = None

        try:
            from replay import replay_counters_from_store as _orig
            original = _orig
        except ImportError:
            pass  # function not yet implemented — the test will fail below anyway

        def spy(*args, **kwargs):
            call_count["n"] += 1
            if original is not None:
                return original(*args, **kwargs)

        monkeypatch.setattr("main.replay_counters_from_store", spy)

        with TestClient(app_module.app):
            pass  # just trigger startup lifespan

        assert call_count["n"] == 1, (
            f"replay_counters_from_store must be called exactly once during "
            f"FastAPI lifespan startup; was called {call_count['n']} time(s)"
        )

    def test_replay_is_called_with_the_store_from_create_event_store(
        self, app_module, monkeypatch
    ):
        """The store passed to replay_counters_from_store must be the one returned by create_event_store."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        sentinel_store = InMemoryEventStore()
        monkeypatch.setattr("main.create_event_store", lambda: sentinel_store)

        captured_store = {"value": None}

        def spy(store, *args, **kwargs):
            captured_store["value"] = store

        monkeypatch.setattr("main.replay_counters_from_store", spy)

        with TestClient(app_module.app):
            pass

        assert captured_store["value"] is sentinel_store, (
            "The store passed to replay_counters_from_store must be the exact object "
            "returned by create_event_store() — the lifespan must not create a second store"
        )

    def test_replay_is_passed_dora_counter_objects(self, app_module, monkeypatch):
        """The Prometheus Counter objects passed to replay_counters_from_store must not be None."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        monkeypatch.setattr("main.create_event_store", lambda: InMemoryEventStore())

        captured = {"push": None, "pr": None, "deployment": None}

        def spy(store, push_counter, pr_counter, deployment_counter):
            captured["push"] = push_counter
            captured["pr"] = pr_counter
            captured["deployment"] = deployment_counter

        monkeypatch.setattr("main.replay_counters_from_store", spy)

        with TestClient(app_module.app):
            pass

        assert captured["push"] is not None, (
            "replay_counters_from_store must receive a push_counter argument"
        )
        assert captured["pr"] is not None, (
            "replay_counters_from_store must receive a pr_counter argument"
        )
        assert captured["deployment"] is not None, (
            "replay_counters_from_store must receive a deployment_counter argument"
        )


# ---------------------------------------------------------------------------
# Restart simulation — metrics reflect seeded event count after startup
# ---------------------------------------------------------------------------


class TestRestartSimulationMetricsHydration:
    """After startup with a pre-populated store, /metrics must reflect the stored event counts.

    This simulates the key container-restart scenario: events were stored in a
    previous service run (backed by PostgreSQL), and after a fresh container start
    the lifespan replays those events so /metrics shows the correct historical totals.

    In tests, we pre-populate an InMemoryEventStore and patch create_event_store
    to return it, simulating the persistent store that survives restarts.
    """

    def test_push_counter_increases_by_seeded_event_count_after_startup(
        self, app_module, monkeypatch
    ):
        """Seeding N push events in the store before startup must increase the push counter by N.

        The test uses a "baseline + delta" approach to handle the global Prometheus
        registry — we measure the counter before and after the lifespan runs, and
        assert the delta equals the number of seeded events.
        """
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        # Baseline: get current push counter value before the lifespan runs
        empty_store = InMemoryEventStore()
        monkeypatch.setattr("main.create_event_store", lambda: empty_store)

        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text

        baseline_value = _parse_prometheus_value(baseline_metrics, "gitweave_push_events_total") or 0.0

        # Prepare pre-populated store (simulates events from previous container run)
        pre_populated = InMemoryEventStore()
        for _ in range(3):
            pre_populated.store_event(_push_event())

        monkeypatch.setattr("main.create_event_store", lambda: pre_populated)

        # Simulate restart: new TestClient triggers lifespan which calls replay
        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        restarted_value = _parse_prometheus_value(restarted_metrics, "gitweave_push_events_total")

        assert restarted_value is not None, (
            "gitweave_push_events_total must appear in GET /metrics"
        )
        assert restarted_value == baseline_value + 3.0, (
            f"After startup replay of 3 push events, push counter must increase by 3; "
            f"baseline={baseline_value}, restarted={restarted_value}, "
            f"expected={baseline_value + 3.0}"
        )

    def test_deployment_counter_increases_by_seeded_event_count_after_startup(
        self, app_module, monkeypatch
    ):
        """Seeding N deployment events in the store before startup must increase the deployment counter by N."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        # Baseline
        empty_store = InMemoryEventStore()
        monkeypatch.setattr("main.create_event_store", lambda: empty_store)

        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text

        baseline_value = _parse_prometheus_value(baseline_metrics, "gitweave_deployment_events_total") or 0.0

        # Seed 2 deployment events
        pre_populated = InMemoryEventStore()
        pre_populated.store_event(_deployment_event())
        pre_populated.store_event(_deployment_event())

        monkeypatch.setattr("main.create_event_store", lambda: pre_populated)

        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        restarted_value = _parse_prometheus_value(restarted_metrics, "gitweave_deployment_events_total")

        assert restarted_value is not None
        assert restarted_value == baseline_value + 2.0, (
            f"After startup replay of 2 deployment events, deployment counter must increase by 2; "
            f"baseline={baseline_value}, restarted={restarted_value}"
        )

    def test_unrelated_counters_do_not_increase_for_push_only_store(
        self, app_module, monkeypatch
    ):
        """When only push events are seeded, PR and deployment counters must not increase."""
        from fastapi.testclient import TestClient
        from store import InMemoryEventStore

        # Baseline
        empty_store = InMemoryEventStore()
        monkeypatch.setattr("main.create_event_store", lambda: empty_store)

        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text

        baseline_pr = _parse_prometheus_value(baseline_metrics, "gitweave_pr_merged_total") or 0.0
        baseline_dep = _parse_prometheus_value(baseline_metrics, "gitweave_deployment_events_total") or 0.0

        # Seed push events only
        pre_populated = InMemoryEventStore()
        for _ in range(5):
            pre_populated.store_event(_push_event())

        monkeypatch.setattr("main.create_event_store", lambda: pre_populated)

        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        restarted_pr = _parse_prometheus_value(restarted_metrics, "gitweave_pr_merged_total") or 0.0
        restarted_dep = _parse_prometheus_value(restarted_metrics, "gitweave_deployment_events_total") or 0.0

        assert restarted_pr == baseline_pr, (
            "PR counter must not change when only push events are seeded in the store"
        )
        assert restarted_dep == baseline_dep, (
            "Deployment counter must not change when only push events are seeded in the store"
        )


# ---------------------------------------------------------------------------
# PostgreSQL restart simulation — skipped without TEST_DATABASE_URL
# ---------------------------------------------------------------------------


class TestPostgreSQLRestartSimulation:
    """Integration test: POST events, simulate container restart, assert /metrics counts match.

    This is the canonical integration test described in the work item:
      1. POST events via /webhook to a PostgreSQL-backed store.
      2. Simulate container restart (new TestClient with lifespan).
      3. Assert /metrics counters match the number of events posted.

    Requires TEST_DATABASE_URL to be set.
    """

    def test_post_push_events_then_restart_shows_push_count_in_metrics(
        self, pg_store, app_module, monkeypatch
    ):
        """POST 3 push events, restart, verify /metrics shows push counter increased by 3."""
        from fastapi.testclient import TestClient

        # Inject the PostgreSQL store into the webhook handler (for POST phase)
        # and the lifespan (for replay phase).
        monkeypatch.setattr("main.create_event_store", lambda: pg_store)

        # Phase 1: Record baseline push counter value before any events
        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text
        baseline_push = _parse_prometheus_value(baseline_metrics, "gitweave_push_events_total") or 0.0

        # Phase 2: Seed push events directly into the PostgreSQL store
        # (simulates POST /webhook events from a previous container run)
        for _ in range(3):
            pg_store.store_event(_push_event(repo="org/my-repo"))

        # Phase 3: Simulate container restart — new TestClient enters lifespan
        # which calls replay_counters_from_store(pg_store, ...) on startup
        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        restart_push = _parse_prometheus_value(restarted_metrics, "gitweave_push_events_total")

        assert restart_push is not None, (
            "gitweave_push_events_total must appear in /metrics after restart"
        )
        assert restart_push == baseline_push + 3.0, (
            f"After restarting with 3 push events in PostgreSQL, "
            f"push counter must have increased by 3; "
            f"baseline={baseline_push}, after_restart={restart_push}"
        )

    def test_metrics_shows_all_event_type_counts_after_restart(
        self, pg_store, app_module, monkeypatch
    ):
        """POST mixed events across types, restart, verify all DORA counters are hydrated."""
        from fastapi.testclient import TestClient

        monkeypatch.setattr("main.create_event_store", lambda: pg_store)

        # Baseline
        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text

        baseline_push = _parse_prometheus_value(baseline_metrics, "gitweave_push_events_total") or 0.0
        baseline_pr = _parse_prometheus_value(baseline_metrics, "gitweave_pr_merged_total") or 0.0
        baseline_dep = _parse_prometheus_value(baseline_metrics, "gitweave_deployment_events_total") or 0.0

        # Seed mixed events in PostgreSQL (simulating previous container's work)
        pg_store.store_event(_push_event("org/repo"))
        pg_store.store_event(_push_event("org/repo"))
        pg_store.store_event(_pr_event("org/repo"))
        pg_store.store_event(_deployment_event("org/repo"))
        pg_store.store_event(_deployment_event("org/repo"))
        pg_store.store_event(_deployment_event("org/repo"))

        # Simulate restart
        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        assert _parse_prometheus_value(restarted_metrics, "gitweave_push_events_total") == baseline_push + 2.0, (
            "Push counter must increase by 2 after restart with 2 seeded push events"
        )
        assert _parse_prometheus_value(restarted_metrics, "gitweave_pr_merged_total") == baseline_pr + 1.0, (
            "PR counter must increase by 1 after restart with 1 seeded PR event"
        )
        assert _parse_prometheus_value(restarted_metrics, "gitweave_deployment_events_total") == baseline_dep + 3.0, (
            "Deployment counter must increase by 3 after restart with 3 seeded deployment events"
        )

    def test_metrics_push_counter_equals_zero_after_restart_with_empty_postgresql_store(
        self, pg_store, app_module, monkeypatch
    ):
        """Restarting with an empty PostgreSQL store must not increment any DORA counter."""
        from fastapi.testclient import TestClient

        monkeypatch.setattr("main.create_event_store", lambda: pg_store)

        # Baseline (before restart)
        with TestClient(app_module.app) as baseline_client:
            baseline_metrics = baseline_client.get("/metrics").text

        baseline_push = _parse_prometheus_value(baseline_metrics, "gitweave_push_events_total") or 0.0

        # Restart with EMPTY store (pg_store fixture truncates tables per test)
        with TestClient(app_module.app) as restarted_client:
            restarted_metrics = restarted_client.get("/metrics").text

        restarted_push = _parse_prometheus_value(restarted_metrics, "gitweave_push_events_total") or 0.0

        assert restarted_push == baseline_push, (
            "An empty PostgreSQL store must not cause any counter to increase on restart"
        )
