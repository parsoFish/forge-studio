"""Unit tests for the DORA scrape-time collector function in main.py.

Tests are written BEFORE the implementation exists (TDD) and are expected to
FAIL until ``metrics/src/main.py`` exports:
  - DEPLOYMENT_FREQUENCY_GAUGE  (Gauge, name='gitweave_deployment_frequency_daily')
  - LEAD_TIME_GAUGE             (Gauge, name='gitweave_lead_time_for_changes_seconds')
  - CHANGE_FAILURE_RATE_GAUGE   (Gauge, name='gitweave_change_failure_rate')
  - MTTR_GAUGE                  (Gauge, name='gitweave_mttr_seconds')
  - collect_dora_metrics(store, repo, environment)
  - get_dora_store()            (FastAPI dependency)

Coverage plan
-------------
* Module-level gauge registration — names, types, label declarations
* collect_dora_metrics calls each of the four computation modules exactly once
* Collector passes store, repo, and environment to each module
* Gauge._value matches the return value of each computation module
* Zero-event store: no exception raised
* Repeated calls overwrite gauge values (idempotent — not cumulative)
* Multiple repo/environment combinations produce independent label series
* get_dora_store is exported and callable
"""

import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

# Patch targets — adjust if implementation splits modules into sub-packages
_DF_TARGET = "main.compute_deployment_frequency"
_LT_TARGET = "main.compute_lead_time_for_changes"
_CFR_TARGET = "main.compute_change_failure_rate"
_MTTR_TARGET = "main.compute_mttr"

# Canonical metric names from the acceptance criteria
GAUGE_NAME_DF = "gitweave_deployment_frequency_daily"
GAUGE_NAME_LT = "gitweave_lead_time_for_changes_seconds"
GAUGE_NAME_CFR = "gitweave_change_failure_rate"
GAUGE_NAME_MTTR = "gitweave_mttr_seconds"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_store():
    """A mock EventStore that satisfies the EventStore protocol interface."""
    store = MagicMock()
    store.get_events.return_value = []
    return store


@pytest.fixture
def all_zero_patches():
    """Context-manager that patches all four DORA computation modules to return 0.0."""
    with (
        patch(_DF_TARGET, return_value=0.0),
        patch(_LT_TARGET, return_value=0.0),
        patch(_CFR_TARGET, return_value=0.0),
        patch(_MTTR_TARGET, return_value=0.0),
    ):
        yield


# ---------------------------------------------------------------------------
# Tests: module-level gauge registration
# ---------------------------------------------------------------------------


class TestGaugeRegistration:
    """The four DORA Prometheus gauges must be registered at module level."""

    def test_deployment_frequency_gauge_exported(self):
        """main.DEPLOYMENT_FREQUENCY_GAUGE must be a prometheus_client Gauge."""
        from prometheus_client import Gauge
        import main as m

        assert hasattr(m, "DEPLOYMENT_FREQUENCY_GAUGE"), (
            "main module must export DEPLOYMENT_FREQUENCY_GAUGE"
        )
        assert isinstance(m.DEPLOYMENT_FREQUENCY_GAUGE, Gauge)

    def test_lead_time_gauge_exported(self):
        """main.LEAD_TIME_GAUGE must be a prometheus_client Gauge."""
        from prometheus_client import Gauge
        import main as m

        assert hasattr(m, "LEAD_TIME_GAUGE"), (
            "main module must export LEAD_TIME_GAUGE"
        )
        assert isinstance(m.LEAD_TIME_GAUGE, Gauge)

    def test_change_failure_rate_gauge_exported(self):
        """main.CHANGE_FAILURE_RATE_GAUGE must be a prometheus_client Gauge."""
        from prometheus_client import Gauge
        import main as m

        assert hasattr(m, "CHANGE_FAILURE_RATE_GAUGE"), (
            "main module must export CHANGE_FAILURE_RATE_GAUGE"
        )
        assert isinstance(m.CHANGE_FAILURE_RATE_GAUGE, Gauge)

    def test_mttr_gauge_exported(self):
        """main.MTTR_GAUGE must be a prometheus_client Gauge."""
        from prometheus_client import Gauge
        import main as m

        assert hasattr(m, "MTTR_GAUGE"), (
            "main module must export MTTR_GAUGE"
        )
        assert isinstance(m.MTTR_GAUGE, Gauge)

    @pytest.mark.parametrize(
        "attr, expected_name",
        [
            ("DEPLOYMENT_FREQUENCY_GAUGE", GAUGE_NAME_DF),
            ("LEAD_TIME_GAUGE", GAUGE_NAME_LT),
            ("CHANGE_FAILURE_RATE_GAUGE", GAUGE_NAME_CFR),
            ("MTTR_GAUGE", GAUGE_NAME_MTTR),
        ],
    )
    def test_gauge_has_correct_metric_name(self, attr: str, expected_name: str):
        """Each DORA gauge must be registered with the exact metric name from the spec."""
        import main as m

        gauge = getattr(m, attr, None)
        assert gauge is not None, f"main.{attr} is not defined"
        assert gauge._name == expected_name, (
            f"main.{attr}._name must be '{expected_name}'; got '{gauge._name}'"
        )

    @pytest.mark.parametrize(
        "attr",
        [
            "DEPLOYMENT_FREQUENCY_GAUGE",
            "LEAD_TIME_GAUGE",
            "CHANGE_FAILURE_RATE_GAUGE",
            "MTTR_GAUGE",
        ],
    )
    def test_gauge_declares_repository_label(self, attr: str):
        """Every DORA gauge must declare 'repository' as one of its label names."""
        import main as m

        gauge = getattr(m, attr, None)
        assert gauge is not None, f"main.{attr} is not defined"
        assert "repository" in gauge._labelnames, (
            f"main.{attr} must declare 'repository' label; "
            f"labelnames={list(gauge._labelnames)}"
        )

    @pytest.mark.parametrize(
        "attr",
        [
            "DEPLOYMENT_FREQUENCY_GAUGE",
            "LEAD_TIME_GAUGE",
            "CHANGE_FAILURE_RATE_GAUGE",
            "MTTR_GAUGE",
        ],
    )
    def test_gauge_declares_environment_label(self, attr: str):
        """Every DORA gauge must declare 'environment' as one of its label names."""
        import main as m

        gauge = getattr(m, attr, None)
        assert gauge is not None, f"main.{attr} is not defined"
        assert "environment" in gauge._labelnames, (
            f"main.{attr} must declare 'environment' label; "
            f"labelnames={list(gauge._labelnames)}"
        )


# ---------------------------------------------------------------------------
# Tests: collect_dora_metrics is exported and callable
# ---------------------------------------------------------------------------


class TestCollectorExported:
    """main.collect_dora_metrics must be exported as a public callable."""

    def test_collect_dora_metrics_is_defined(self):
        """main module must export collect_dora_metrics."""
        import main as m

        assert hasattr(m, "collect_dora_metrics"), (
            "main module must export collect_dora_metrics function"
        )

    def test_collect_dora_metrics_is_callable(self):
        """main.collect_dora_metrics must be callable."""
        import main as m

        assert callable(m.collect_dora_metrics), (
            "main.collect_dora_metrics must be a callable function"
        )

    def test_get_dora_store_is_exported_and_callable(self):
        """main module must export get_dora_store as a FastAPI dependency provider."""
        import main as m

        assert hasattr(m, "get_dora_store"), (
            "main module must export get_dora_store for DI injection in tests"
        )
        assert callable(m.get_dora_store), "get_dora_store must be callable"


# ---------------------------------------------------------------------------
# Tests: collector invokes each DORA computation module
# ---------------------------------------------------------------------------


class TestCollectorInvokesModules:
    """collect_dora_metrics must call each DORA computation module exactly once."""

    def test_calls_compute_deployment_frequency(self, mock_store):
        """collect_dora_metrics must invoke compute_deployment_frequency."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=1.5) as mock_df,
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment="production")

        mock_df.assert_called_once()

    def test_calls_compute_lead_time_for_changes(self, mock_store):
        """collect_dora_metrics must invoke compute_lead_time_for_changes."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=3600.0) as mock_lt,
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment="production")

        mock_lt.assert_called_once()

    def test_calls_compute_change_failure_rate(self, mock_store):
        """collect_dora_metrics must invoke compute_change_failure_rate."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.1) as mock_cfr,
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment="production")

        mock_cfr.assert_called_once()

    def test_calls_compute_mttr(self, mock_store):
        """collect_dora_metrics must invoke compute_mttr."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=7200.0) as mock_mttr,
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment="production")

        mock_mttr.assert_called_once()

    def test_passes_store_to_each_module(self, mock_store):
        """The event store must be forwarded to every DORA computation module."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=0.0) as mock_df,
            patch(_LT_TARGET, return_value=0.0) as mock_lt,
            patch(_CFR_TARGET, return_value=0.0) as mock_cfr,
            patch(_MTTR_TARGET, return_value=0.0) as mock_mttr,
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment="production")

        for mock_fn in [mock_df, mock_lt, mock_cfr, mock_mttr]:
            all_passed = list(mock_fn.call_args.args) + list(
                mock_fn.call_args.kwargs.values()
            )
            assert mock_store in all_passed, (
                f"{mock_fn._mock_name} must receive the EventStore as an argument; "
                f"call was: {mock_fn.call_args}"
            )

    def test_passes_repo_to_each_module(self, mock_store):
        """The repository name must be forwarded to every DORA computation module."""
        import main as m
        repo = "org/my-service"

        with (
            patch(_DF_TARGET, return_value=0.0) as mock_df,
            patch(_LT_TARGET, return_value=0.0) as mock_lt,
            patch(_CFR_TARGET, return_value=0.0) as mock_cfr,
            patch(_MTTR_TARGET, return_value=0.0) as mock_mttr,
        ):
            m.collect_dora_metrics(mock_store, repo=repo, environment="production")

        for mock_fn in [mock_df, mock_lt, mock_cfr, mock_mttr]:
            all_passed = list(mock_fn.call_args.args) + list(
                mock_fn.call_args.kwargs.values()
            )
            assert repo in all_passed, (
                f"{mock_fn._mock_name} must receive repo='{repo}'; "
                f"call was: {mock_fn.call_args}"
            )

    def test_passes_environment_to_each_module(self, mock_store):
        """The environment string must be forwarded to every DORA computation module."""
        import main as m
        env = "staging"

        with (
            patch(_DF_TARGET, return_value=0.0) as mock_df,
            patch(_LT_TARGET, return_value=0.0) as mock_lt,
            patch(_CFR_TARGET, return_value=0.0) as mock_cfr,
            patch(_MTTR_TARGET, return_value=0.0) as mock_mttr,
        ):
            m.collect_dora_metrics(mock_store, repo="org/repo", environment=env)

        for mock_fn in [mock_df, mock_lt, mock_cfr, mock_mttr]:
            all_passed = list(mock_fn.call_args.args) + list(
                mock_fn.call_args.kwargs.values()
            )
            assert env in all_passed, (
                f"{mock_fn._mock_name} must receive environment='{env}'; "
                f"call was: {mock_fn.call_args}"
            )


# ---------------------------------------------------------------------------
# Tests: gauge values set from module return values
# ---------------------------------------------------------------------------


class TestCollectorSetsGaugeValues:
    """collect_dora_metrics must set each Prometheus gauge to its module's return value."""

    def test_deployment_frequency_gauge_set_to_module_return(self, mock_store):
        """DEPLOYMENT_FREQUENCY_GAUGE must be set to compute_deployment_frequency's return."""
        import main as m
        expected = 2.5

        with (
            patch(_DF_TARGET, return_value=expected),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/repo-df", environment="production"
            )

        actual = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository="org/repo-df", environment="production"
        )._value.get()
        assert actual == expected, (
            f"DEPLOYMENT_FREQUENCY_GAUGE must be {expected}; got {actual}"
        )

    def test_lead_time_gauge_set_to_module_return(self, mock_store):
        """LEAD_TIME_GAUGE must be set to compute_lead_time_for_changes's return."""
        import main as m
        expected = 3600.0

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=expected),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/repo-lt", environment="production"
            )

        actual = m.LEAD_TIME_GAUGE.labels(
            repository="org/repo-lt", environment="production"
        )._value.get()
        assert actual == expected, (
            f"LEAD_TIME_GAUGE must be {expected}; got {actual}"
        )

    def test_change_failure_rate_gauge_set_to_module_return(self, mock_store):
        """CHANGE_FAILURE_RATE_GAUGE must be set to compute_change_failure_rate's return."""
        import main as m
        expected = 0.15

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=expected),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/repo-cfr", environment="production"
            )

        actual = m.CHANGE_FAILURE_RATE_GAUGE.labels(
            repository="org/repo-cfr", environment="production"
        )._value.get()
        assert actual == expected, (
            f"CHANGE_FAILURE_RATE_GAUGE must be {expected}; got {actual}"
        )

    def test_mttr_gauge_set_to_module_return(self, mock_store):
        """MTTR_GAUGE must be set to compute_mttr's return value."""
        import main as m
        expected = 7200.0

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=expected),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/repo-mttr", environment="production"
            )

        actual = m.MTTR_GAUGE.labels(
            repository="org/repo-mttr", environment="production"
        )._value.get()
        assert actual == expected, (
            f"MTTR_GAUGE must be {expected}; got {actual}"
        )


# ---------------------------------------------------------------------------
# Tests: edge cases
# ---------------------------------------------------------------------------


class TestCollectorEdgeCases:
    """collect_dora_metrics must handle degenerate inputs without raising."""

    def test_does_not_raise_when_all_modules_return_zero(self, mock_store):
        """Collector must succeed even when all DORA metrics are zero (no events)."""
        import main as m

        with (
            patch(_DF_TARGET, return_value=0.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            # Must not raise
            m.collect_dora_metrics(
                mock_store, repo="org/empty-repo", environment="production"
            )

    def test_repeated_calls_overwrite_gauge_values_not_accumulate(self, mock_store):
        """Calling collect_dora_metrics twice must set the gauge, not add to it.

        Prometheus gauges are set-semantics (not counter-semantics). A second
        call with a different value must overwrite, not accumulate.
        """
        import main as m
        repo = "org/repo-idempotent"
        env = "production"

        with (
            patch(_DF_TARGET, return_value=1.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(mock_store, repo=repo, environment=env)

        with (
            patch(_DF_TARGET, return_value=5.0),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(mock_store, repo=repo, environment=env)

        actual = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository=repo, environment=env
        )._value.get()
        assert actual == 5.0, (
            f"Second collect_dora_metrics call must overwrite the gauge (expected 5.0); "
            f"got {actual}. The gauge must not accumulate across calls."
        )

    def test_multiple_repos_produce_independent_label_series(self, mock_store):
        """Collector called for two repos must produce independent gauge label series."""
        import main as m

        with (
            patch(_DF_TARGET, side_effect=[2.0, 3.0]),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/service-a", environment="production"
            )
            m.collect_dora_metrics(
                mock_store, repo="org/service-b", environment="production"
            )

        val_a = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository="org/service-a", environment="production"
        )._value.get()
        val_b = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository="org/service-b", environment="production"
        )._value.get()

        assert val_a == 2.0, f"org/service-a DF gauge must be 2.0; got {val_a}"
        assert val_b == 3.0, f"org/service-b DF gauge must be 3.0; got {val_b}"

    def test_multiple_environments_produce_independent_label_series(self, mock_store):
        """Collector called for two environments must produce independent gauge series."""
        import main as m

        with (
            patch(_DF_TARGET, side_effect=[4.0, 1.0]),
            patch(_LT_TARGET, return_value=0.0),
            patch(_CFR_TARGET, return_value=0.0),
            patch(_MTTR_TARGET, return_value=0.0),
        ):
            m.collect_dora_metrics(
                mock_store, repo="org/repo", environment="production"
            )
            m.collect_dora_metrics(
                mock_store, repo="org/repo", environment="staging"
            )

        val_prod = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository="org/repo", environment="production"
        )._value.get()
        val_staging = m.DEPLOYMENT_FREQUENCY_GAUGE.labels(
            repository="org/repo", environment="staging"
        )._value.get()

        assert val_prod == 4.0, f"production DF gauge must be 4.0; got {val_prod}"
        assert val_staging == 1.0, f"staging DF gauge must be 1.0; got {val_staging}"
