"""DORA Change Failure Rate computation.

Change failure rate measures the percentage of deployments that cause a
failure in production.  Returned as a ratio (0.0–1.0) over the most recent
30-day window.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from store import EventStore

_WINDOW_DAYS = 30


def compute_change_failure_rate(
    store: "EventStore",
    repo: str,
    environment: str,
) -> float:
    """Return the proportion of failed deployments over the last 30 days.

    Args:
        store:       EventStore implementation to query for deployment events.
        repo:        Repository full name (e.g. 'org/repo').
        environment: Target environment label (e.g. 'production').

    Returns:
        Ratio of failed deployments to total deployments as a float in
        [0.0, 1.0].  Returns 0.0 when no deployments are found in the window.
    """
    since = datetime.now(timezone.utc) - timedelta(days=_WINDOW_DAYS)
    events = store.get_events(repo=repo, event_type="deployment_status", since_dt=since)
    env_events = [e for e in events if e.get("environment") == environment]

    if not env_events:
        return 0.0

    failures = [e for e in env_events if e.get("state") == "failure"]
    return len(failures) / len(env_events)
