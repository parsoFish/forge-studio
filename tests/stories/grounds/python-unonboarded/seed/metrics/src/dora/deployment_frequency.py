"""DORA Deployment Frequency metric.

Deployment Frequency: the daily rate of successful deployments to production
over a rolling 30-day window.

Prometheus gauge: gitweave_deployment_frequency_daily
Labels: repository, environment
Formula: count(successful deployment_status events in last 30 days) / 30
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from prometheus_client import Gauge

if TYPE_CHECKING:
    from store import EventStore

_WINDOW_DAYS = 30

DEPLOYMENT_FREQUENCY_GAUGE = Gauge(
    "gitweave_deployment_frequency_daily",
    "Daily deployment frequency over a 30-day rolling window",
    ["repository", "environment"],
)


def calculate_deployment_frequency(
    repo: str,
    environment: str,
    store: "EventStore",
    now: datetime,
) -> float:
    """Return the daily deployment frequency for a repo+environment pair.

    Counts successful deployment_status events within the last 30 days
    (inclusive of exactly 30 days ago) and divides by 30.

    Args:
        repo: Repository full name (e.g. "octocat/Hello-World").
        environment: Deployment target environment (e.g. "production").
        store: EventStore to query events from.
        now: Reference timestamp for the rolling window boundary.

    Returns:
        Deployment frequency as a float (count / 30). Returns 0.0 when
        there are no successful deployments in the window.
    """
    since = now - timedelta(days=_WINDOW_DAYS)
    events = store.get_events(repo=repo, event_type="deployment_status", since_dt=since)

    count = sum(
        1
        for e in events
        if e.get("state") == "success"
        and e.get("environment") == environment
    )

    return count / _WINDOW_DAYS


def update_gauge(repo: str, environment: str, store: "EventStore", now: datetime) -> None:
    """Recalculate and set the Prometheus gauge for a repo+environment pair."""
    frequency = calculate_deployment_frequency(repo, environment, store, now)
    DEPLOYMENT_FREQUENCY_GAUGE.labels(repository=repo, environment=environment).set(frequency)
