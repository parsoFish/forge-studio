"""TDD tests for the DORA Deployment Frequency metric.

Deployment Frequency: the daily rate of successful deployments to production
over a rolling 30-day window.

Exposed as: gitweave_deployment_frequency_daily Prometheus Gauge
Labels: repository, environment
Formula: count(successful deployment_status events in last 30 days) / 30

Only state='success' deployments are counted. All other states (pending,
failure, in_progress, error) are excluded. Deployments older than 30 days
are excluded (strictly greater than 30 days ago; exactly 30 days ago counts).

Metric updates synchronously after each successful deployment event is stored.

These tests are written BEFORE implementation (TDD red phase) and will FAIL
until metrics/src/dora/deployment_frequency.py is created and
metrics/src/handlers/deployment_status.py is updated to update the gauge.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

# Add src to path so we can import handler modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _days_ago(n: float, relative_to: datetime | None = None) -> datetime:
    """Return a timezone-aware datetime n days before `relative_to` (default: now)."""
    base = relative_to or _utcnow()
    return base - timedelta(days=n)


def _make_store():
    """Return a fresh InMemoryEventStore."""
    from store import InMemoryEventStore
    return InMemoryEventStore()


def _make_deployment_event(
    *,
    repo: str = "octocat/Hello-World",
    environment: str = "production",
    state: str = "success",
    created_at: datetime | None = None,
    deployment_id: int = 1,
) -> dict[str, Any]:
    """Build a normalised deployment_status event dict as produced by the handler."""
    return {
        "event_type": "deployment_status",
        "repo": repo,
        "environment": environment,
        "state": state,
        "created_at": created_at or _utcnow(),
        "deployment_id": deployment_id,
    }


# ---------------------------------------------------------------------------
# Unit tests — calculate_deployment_frequency() pure function
# ---------------------------------------------------------------------------


class TestCalculateDeploymentFrequency:
    """calculate_deployment_frequency(repo, environment, store, now) returns a float."""

    def test_zero_deployments_returns_0_0(self):
        """No deployments in the store yields a frequency of 0.0."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(0.0)

    def test_30_successful_deployments_in_30_days_returns_1_0(self):
        """Exactly one deployment per day over 30 days produces a frequency of 1.0."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        for i in range(30):
            store.store_event(_make_deployment_event(
                created_at=_days_ago(i, relative_to=now),
                deployment_id=i,
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(1.0)

    def test_60_successful_deployments_in_30_days_returns_2_0(self):
        """Two deployments per day over 30 days yields a frequency of 2.0."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        for i in range(60):
            store.store_event(_make_deployment_event(
                created_at=_days_ago(i / 2, relative_to=now),
                deployment_id=i,
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(2.0)

    def test_1_success_and_5_failures_counts_only_success(self):
        """Only state='success' deployments are counted; failures are excluded.

        1 success + 5 failures → frequency = 1 / 30
        """
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        store.store_event(_make_deployment_event(state="success", deployment_id=1, created_at=_days_ago(1, now)))
        for i, bad_state in enumerate(["failure", "pending", "in_progress", "error", "failure"], start=2):
            store.store_event(_make_deployment_event(state=bad_state, deployment_id=i, created_at=_days_ago(1, now)))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(1 / 30)

    def test_deployment_exactly_30_days_ago_is_included(self):
        """A deployment at exactly 30 days ago (not older) falls within the window."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()
        boundary = _days_ago(30, relative_to=now)

        store.store_event(_make_deployment_event(created_at=boundary))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(1 / 30)

    def test_deployment_just_over_30_days_ago_is_excluded(self):
        """A deployment at 30 days + 1 second ago falls outside the window."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()
        just_outside = _days_ago(30, relative_to=now) - timedelta(seconds=1)

        store.store_event(_make_deployment_event(created_at=just_outside))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(0.0)

    def test_deployments_for_different_repo_are_not_counted(self):
        """Deployments from another repository do not affect the target repo's frequency."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        # 10 deployments for a different repo
        for i in range(10):
            store.store_event(_make_deployment_event(
                repo="other/repo",
                deployment_id=i,
                created_at=_days_ago(i, now),
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(0.0)

    def test_deployments_for_different_environment_are_not_counted(self):
        """Deployments to another environment do not affect the target environment's frequency."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        # 10 deployments to staging — should not count for production
        for i in range(10):
            store.store_event(_make_deployment_event(
                environment="staging",
                deployment_id=i,
                created_at=_days_ago(i, now),
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(0.0)

    def test_all_non_success_states_are_excluded(self):
        """pending, failure, in_progress, error states are all excluded from the count."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        non_success_states = ["pending", "failure", "in_progress", "error"]
        for i, state in enumerate(non_success_states):
            store.store_event(_make_deployment_event(
                state=state,
                deployment_id=i,
                created_at=_days_ago(1, now),
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(0.0)

    def test_only_success_in_window_while_old_successes_exist(self):
        """Successes outside the 30-day window are excluded; only in-window ones count."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        # 5 old deployments outside the window
        for i in range(5):
            store.store_event(_make_deployment_event(
                deployment_id=i,
                created_at=_days_ago(31 + i, now),
            ))

        # 3 recent deployments inside the window
        for i in range(3):
            store.store_event(_make_deployment_event(
                deployment_id=100 + i,
                created_at=_days_ago(i + 1, now),
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(3 / 30)

    def test_multiple_repos_and_environments_are_isolated(self):
        """Frequencies for different repo+environment combinations are independent."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        # 6 deployments for repo-A/production
        for i in range(6):
            store.store_event(_make_deployment_event(
                repo="org/repo-a", environment="production",
                deployment_id=i, created_at=_days_ago(i + 1, now),
            ))

        # 15 deployments for repo-B/staging
        for i in range(15):
            store.store_event(_make_deployment_event(
                repo="org/repo-b", environment="staging",
                deployment_id=100 + i, created_at=_days_ago(i + 1, now),
            ))

        freq_a = calculate_deployment_frequency("org/repo-a", "production", store, now)
        freq_b = calculate_deployment_frequency("org/repo-b", "staging", store, now)

        assert freq_a == pytest.approx(6 / 30)
        assert freq_b == pytest.approx(15 / 30)

    @pytest.mark.parametrize("n_deployments,expected", [
        (0, 0.0),
        (1, 1 / 30),
        (30, 1.0),
        (60, 2.0),
        (90, 3.0),
    ])
    def test_parametrized_deployment_counts(self, n_deployments, expected):
        """Parametrized verification of the count/30 formula."""
        from dora.deployment_frequency import calculate_deployment_frequency

        store = _make_store()
        now = _utcnow()

        # Space deployments evenly across 29 days so they all fall within the window
        for i in range(n_deployments):
            offset_days = (29 * i / max(n_deployments, 1)) if n_deployments > 0 else 0
            store.store_event(_make_deployment_event(
                deployment_id=i,
                created_at=_days_ago(offset_days, now),
            ))

        result = calculate_deployment_frequency("octocat/Hello-World", "production", store, now)

        assert result == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Prometheus gauge registration tests
# ---------------------------------------------------------------------------


class TestDeploymentFrequencyGaugeRegistration:
    """gitweave_deployment_frequency_daily Prometheus gauge must be registered correctly."""

    def test_deployment_frequency_gauge_is_importable(self):
        """The DEPLOYMENT_FREQUENCY_GAUGE constant must be importable from the module."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE

        assert DEPLOYMENT_FREQUENCY_GAUGE is not None

    def test_gauge_name_is_gitweave_deployment_frequency_daily(self):
        """The Prometheus metric name must be 'gitweave_deployment_frequency_daily'."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE

        # prometheus_client stores the metric name on _name attribute
        assert DEPLOYMENT_FREQUENCY_GAUGE._name == "gitweave_deployment_frequency_daily"

    def test_gauge_has_repository_label(self):
        """The gauge must carry a 'repository' label for per-repo cardinality."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE

        assert "repository" in DEPLOYMENT_FREQUENCY_GAUGE._labelnames

    def test_gauge_has_environment_label(self):
        """The gauge must carry an 'environment' label for per-environment cardinality."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE

        assert "environment" in DEPLOYMENT_FREQUENCY_GAUGE._labelnames

    def test_gauge_has_exactly_two_labels(self):
        """The gauge must have exactly two labels: repository and environment."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE

        assert set(DEPLOYMENT_FREQUENCY_GAUGE._labelnames) == {"repository", "environment"}


# ---------------------------------------------------------------------------
# Integration tests — gauge updates synchronously after handle()
# ---------------------------------------------------------------------------


class TestDeploymentFrequencyGaugeUpdatesAfterHandle:
    """The Prometheus gauge must reflect the current frequency after each handle() call."""

    def _read_gauge(self, repo: str, environment: str) -> float:
        """Read the current value of the gauge for a given repo+environment."""
        from dora.deployment_frequency import DEPLOYMENT_FREQUENCY_GAUGE
        from prometheus_client import REGISTRY

        # Collect all samples from the gauge family and find the matching label set
        for metric in REGISTRY.collect():
            if metric.name == "gitweave_deployment_frequency_daily":
                for sample in metric.samples:
                    if (
                        sample.labels.get("repository") == repo
                        and sample.labels.get("environment") == environment
                    ):
                        return sample.value
        return 0.0

    def test_gauge_is_updated_synchronously_after_success_deployment(self):
        """Gauge reflects updated frequency immediately after a success event is handled."""
        from handlers.deployment_status import handle
        from store import InMemoryEventStore

        store = InMemoryEventStore()

        payload = {
            "deployment_status": {
                "state": "success",
                "id": 999,
                "created_at": datetime.now(tz=timezone.utc).isoformat(),
                "environment": "production",
            },
            "repository": {"full_name": "sync-test/gauge-update"},
        }

        handle(payload, store)

        gauge_value = self._read_gauge("sync-test/gauge-update", "production")
        assert gauge_value > 0.0, "Gauge must be non-zero after one successful deployment"

    def test_gauge_value_equals_formula_after_multiple_successes(self):
        """Gauge equals count/30 after multiple successful deployments are stored."""
        from handlers.deployment_status import handle
        from store import InMemoryEventStore
        import importlib
        import dora.deployment_frequency as df_module

        store = InMemoryEventStore()

        # Pre-seed 4 successes directly into the store (simulating prior events)
        now = datetime.now(tz=timezone.utc)
        for i in range(4):
            store.store_event(_make_deployment_event(
                repo="formula-test/repo", environment="production",
                deployment_id=i, created_at=_days_ago(i + 1, now),
            ))

        # Trigger one more via the handler
        payload = {
            "deployment_status": {
                "state": "success",
                "id": 500,
                "created_at": now.isoformat(),
                "environment": "production",
            },
            "repository": {"full_name": "formula-test/repo"},
        }
        handle(payload, store)

        gauge_value = self._read_gauge("formula-test/repo", "production")
        assert gauge_value == pytest.approx(5 / 30)

    def test_failure_deployment_does_not_increase_gauge(self):
        """A failure deployment_status event must not increase the frequency gauge."""
        from handlers.deployment_status import handle
        from store import InMemoryEventStore

        store = InMemoryEventStore()

        payload = {
            "deployment_status": {
                "state": "failure",
                "id": 1001,
                "created_at": datetime.now(tz=timezone.utc).isoformat(),
                "environment": "production",
            },
            "repository": {"full_name": "failure-test/repo"},
        }
        handle(payload, store)

        gauge_value = self._read_gauge("failure-test/repo", "production")
        assert gauge_value == pytest.approx(0.0), (
            "Gauge must remain 0.0 when only failure deployments have been processed"
        )

    @pytest.mark.parametrize("state", ["pending", "failure", "in_progress", "error"])
    def test_non_success_states_do_not_update_frequency_gauge(self, state: str):
        """None of the non-success states should be counted in the frequency gauge."""
        from handlers.deployment_status import handle
        from store import InMemoryEventStore

        store = InMemoryEventStore()

        payload = {
            "deployment_status": {
                "state": state,
                "id": 2000,
                "created_at": datetime.now(tz=timezone.utc).isoformat(),
                "environment": "staging",
            },
            "repository": {"full_name": f"state-test/{state}"},
        }
        handle(payload, store)

        gauge_value = self._read_gauge(f"state-test/{state}", "staging")
        assert gauge_value == pytest.approx(0.0), (
            f"Gauge must remain 0.0 for state='{state}'"
        )

    def test_gauge_updates_independently_per_repo_and_environment(self):
        """Gauge for repo-A/production is independent of repo-B/staging."""
        from handlers.deployment_status import handle
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        now = datetime.now(tz=timezone.utc).isoformat()

        # 2 successes for repo-A/production
        for i in range(2):
            handle(
                {
                    "deployment_status": {
                        "state": "success",
                        "id": i,
                        "created_at": now,
                        "environment": "production",
                    },
                    "repository": {"full_name": "isolation-test/repo-a"},
                },
                store,
            )

        # 7 successes for repo-B/staging
        for i in range(7):
            handle(
                {
                    "deployment_status": {
                        "state": "success",
                        "id": 100 + i,
                        "created_at": now,
                        "environment": "staging",
                    },
                    "repository": {"full_name": "isolation-test/repo-b"},
                },
                store,
            )

        gauge_a = self._read_gauge("isolation-test/repo-a", "production")
        gauge_b = self._read_gauge("isolation-test/repo-b", "staging")

        assert gauge_a == pytest.approx(2 / 30)
        assert gauge_b == pytest.approx(7 / 30)


# ---------------------------------------------------------------------------
# Module structure tests — ensure dora package can be imported
# ---------------------------------------------------------------------------


class TestDoraPackageStructure:
    """The dora package must be discoverable under metrics/src/dora/."""

    def test_dora_package_is_importable(self):
        """import dora must succeed — verifies __init__.py exists."""
        import dora  # noqa: F401

    def test_dora_deployment_frequency_module_is_importable(self):
        """import dora.deployment_frequency must succeed."""
        import dora.deployment_frequency  # noqa: F401

    def test_calculate_deployment_frequency_is_callable(self):
        """calculate_deployment_frequency must be a callable exported from the module."""
        from dora.deployment_frequency import calculate_deployment_frequency

        assert callable(calculate_deployment_frequency)
