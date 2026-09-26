"""Integration tests: DORA Prometheus gauges in the /metrics endpoint.

Seeds InMemoryEventStore with synthetic events, GETs /metrics via TestClient,
and asserts all four DORA gauge names appear in the Prometheus exposition body.
Also validates the output with ``promtool check metrics`` when promtool is
available on PATH.

Expected gauge names (from acceptance criteria):
  - gitweave_deployment_frequency_daily
  - gitweave_lead_time_for_changes_seconds
  - gitweave_change_failure_rate
  - gitweave_mttr_seconds

Expected labels on each gauge: repository, environment
"""

import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

METRICS_PATH = "/metrics"

EXPECTED_GAUGE_NAMES = [
    "gitweave_deployment_frequency_daily",
    "gitweave_lead_time_for_changes_seconds",
    "gitweave_change_failure_rate",
    "gitweave_mttr_seconds",
]


# ---------------------------------------------------------------------------
# Helpers — synthetic event factories
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _deployment_success_event(
    repo: str = "org/repo",
    environment: str = "production",
    hours_ago: float = 1.0,
) -> dict:
    return {
        "event_type": "deployment_status",
        "repo": repo,
        "environment": environment,
        "state": "success",
        "deployment_id": 101,
        "created_at": _now() - timedelta(hours=hours_ago),
    }


def _deployment_failure_event(
    repo: str = "org/repo",
    environment: str = "production",
    hours_ago: float = 2.0,
) -> dict:
    return {
        "event_type": "deployment_status",
        "repo": repo,
        "environment": environment,
        "state": "failure",
        "deployment_id": 102,
        "created_at": _now() - timedelta(hours=hours_ago),
    }


def _pr_merged_event(
    repo: str = "org/repo",
    hours_ago: float = 3.0,
) -> dict:
    return {
        "event_type": "pull_request",
        "repo": repo,
        "pr_number": 42,
        "commit_sha": "abc123def456",
        "merged_at": _now() - timedelta(hours=hours_ago),
        "created_at": _now() - timedelta(hours=hours_ago),
    }


def _push_event(
    repo: str = "org/repo",
    hours_ago: float = 4.0,
) -> dict:
    ts = (_now() - timedelta(hours=hours_ago)).isoformat()
    return {
        "event_type": "push",
        "repo": repo,
        "ref": "refs/heads/main",
        "commits": [{"sha": "abc123def456", "timestamp": ts}],
        "created_at": _now() - timedelta(hours=hours_ago),
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def seeded_store():
    """InMemoryEventStore pre-loaded with one full cycle of synthetic DORA events.

    Includes push, PR merge, successful deployment, and failure+recovery to
    exercise all four computation modules.
    """
    from store import InMemoryEventStore

    store = InMemoryEventStore()
    # Push → PR merge → deploy success (lead time + deployment frequency)
    store.store_event(_push_event(hours_ago=4))
    store.store_event(_pr_merged_event(hours_ago=3))
    store.store_event(_deployment_success_event(hours_ago=2))
    # Failure then recovery → MTTR + change failure rate
    store.store_event(_deployment_failure_event(hours_ago=1.5))
    store.store_event(_deployment_success_event(hours_ago=1.0))
    # Second environment for label coverage
    store.store_event(_deployment_success_event(environment="staging", hours_ago=0.5))
    return store


@pytest.fixture
def client_with_seeded_store(seeded_store):
    """FastAPI TestClient with the seeded InMemoryEventStore injected as the DORA store.

    Overrides the ``get_dora_store`` dependency so the /metrics endpoint sees
    pre-seeded events rather than the default empty store.
    """
    import main as m
    from fastapi.testclient import TestClient

    m.app.dependency_overrides[m.get_dora_store] = lambda: seeded_store
    client = TestClient(m.app)
    yield client
    m.app.dependency_overrides.pop(m.get_dora_store, None)


# ---------------------------------------------------------------------------
# Tests: all four DORA gauge names appear in the /metrics response body
# ---------------------------------------------------------------------------


class TestDoraGaugeNamesInMetricsBody:
    """GET /metrics must contain all four DORA gauge names in the Prometheus body."""

    @pytest.mark.parametrize("gauge_name", EXPECTED_GAUGE_NAMES)
    def test_gauge_name_present_in_metrics_body(
        self, client_with_seeded_store, gauge_name: str
    ):
        """Each DORA gauge name must appear in the Prometheus exposition output."""
        response = client_with_seeded_store.get(METRICS_PATH)
        assert response.status_code == 200
        body = response.text
        assert gauge_name in body, (
            f"Expected gauge '{gauge_name}' not found in /metrics output.\n"
            f"Full body:\n{body}"
        )

    def test_all_four_dora_gauges_present_in_single_response(
        self, client_with_seeded_store
    ):
        """All four DORA gauges must appear together in a single /metrics response."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        missing = [name for name in EXPECTED_GAUGE_NAMES if name not in body]
        assert not missing, (
            f"Missing DORA gauges: {missing}\nFull /metrics body:\n{body}"
        )


# ---------------------------------------------------------------------------
# Tests: Prometheus metadata lines (# HELP / # TYPE) for each gauge
# ---------------------------------------------------------------------------


class TestDoraGaugePrometheusMetadata:
    """Each DORA gauge must have correct # HELP and # TYPE lines in the response."""

    @pytest.mark.parametrize("gauge_name", EXPECTED_GAUGE_NAMES)
    def test_help_line_present_for_gauge(
        self, client_with_seeded_store, gauge_name: str
    ):
        """Each DORA gauge must have a # HELP comment line."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert f"# HELP {gauge_name}" in body, (
            f"Missing '# HELP {gauge_name}' in /metrics output"
        )

    @pytest.mark.parametrize("gauge_name", EXPECTED_GAUGE_NAMES)
    def test_type_line_declares_gauge_type(
        self, client_with_seeded_store, gauge_name: str
    ):
        """Each DORA metric must be declared as TYPE gauge (not counter or histogram)."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert f"# TYPE {gauge_name} gauge" in body, (
            f"Missing '# TYPE {gauge_name} gauge' in /metrics output.\n"
            f"(Found in body: {[l for l in body.splitlines() if gauge_name in l]})"
        )


# ---------------------------------------------------------------------------
# Tests: label names on gauge samples
# ---------------------------------------------------------------------------


class TestDoraGaugeLabels:
    """DORA gauges must carry 'repository' and 'environment' labels on every sample."""

    def test_repository_label_present_in_metrics_body(self, client_with_seeded_store):
        """'repository=' must appear in the /metrics body for DORA label series."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert 'repository="' in body or "repository=" in body, (
            "DORA gauges must expose a 'repository' label; not found in /metrics output"
        )

    def test_environment_label_present_in_metrics_body(self, client_with_seeded_store):
        """'environment=' must appear in the /metrics body for DORA label series."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert 'environment="' in body or "environment=" in body, (
            "DORA gauges must expose an 'environment' label; not found in /metrics output"
        )

    def test_seeded_repo_name_appears_in_metrics_body(self, client_with_seeded_store):
        """The seeded repository name 'org/repo' must appear as a label value."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert "org/repo" in body, (
            "Seeded repository 'org/repo' must appear as a label value in /metrics output"
        )

    def test_production_environment_label_appears_in_metrics_body(
        self, client_with_seeded_store
    ):
        """The 'production' environment label value must appear in /metrics output."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert "production" in body, (
            "Environment label value 'production' must appear in /metrics output"
        )


# ---------------------------------------------------------------------------
# Tests: dummy metric removed
# ---------------------------------------------------------------------------


class TestDummyMetricRemoved:
    """The gitweave_dummy_metric must not appear once DORA gauges are wired in."""

    def test_dummy_metric_absent_from_metrics_body(self, client_with_seeded_store):
        """gitweave_dummy_metric must be replaced — it must not appear in /metrics."""
        response = client_with_seeded_store.get(METRICS_PATH)
        body = response.text
        assert "gitweave_dummy_metric" not in body, (
            "gitweave_dummy_metric must be removed when DORA gauges are registered; "
            "found it in /metrics output"
        )


# ---------------------------------------------------------------------------
# Tests: promtool validation (skipped if promtool not on PATH)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    shutil.which("promtool") is None,
    reason="promtool not on PATH — skipping strict Prometheus format validation",
)
class TestPromtoolMetricsValidation:
    """Validate /metrics output is strictly conformant using promtool check metrics."""

    def test_metrics_output_passes_promtool_check(self, client_with_seeded_store):
        """promtool check metrics must exit 0 for the full /metrics response body.

        This validates strict Prometheus exposition format compliance — not just
        that gauge names appear, but that the format is accepted by the real
        Prometheus toolchain.
        """
        response = client_with_seeded_store.get(METRICS_PATH)
        assert response.status_code == 200

        body_bytes = response.text.encode("utf-8")
        result = subprocess.run(
            ["promtool", "check", "metrics"],
            input=body_bytes,
            capture_output=True,
            timeout=30,
        )
        assert result.returncode == 0, (
            f"promtool check metrics exited {result.returncode}.\n"
            f"stderr: {result.stderr.decode()}\n"
            f"stdout: {result.stdout.decode()}\n"
            f"Metrics body:\n{response.text}"
        )
