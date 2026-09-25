"""DORA Mean Time to Restore (MTTR) computation.

MTTR measures how long it takes to recover from a failure in production.
Returned as seconds over the most recent 30-day window.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from store import EventStore

_WINDOW_DAYS = 30


def compute_mttr(
    store: "EventStore",
    repo: str,
    environment: str,
) -> float:
    """Return the mean time to restore (seconds) from failure to next success.

    For each deployment failure, finds the immediately following successful
    deployment and measures the elapsed time.  Averages across all such
    failure–recovery pairs in the 30-day window.

    Args:
        store:       EventStore implementation to query for deployment events.
        repo:        Repository full name (e.g. 'org/repo').
        environment: Target environment label (e.g. 'production').

    Returns:
        Mean time to restore in seconds as a float.  Returns 0.0 when no
        failure–recovery pair is found in the window.
    """
    since = datetime.now(timezone.utc) - timedelta(days=_WINDOW_DAYS)
    events = store.get_events(repo=repo, event_type="deployment_status", since_dt=since)
    env_events = sorted(
        [e for e in events if e.get("environment") == environment],
        key=lambda e: e.get("created_at", datetime.min),
    )

    restore_times: list[float] = []
    i = 0
    while i < len(env_events):
        event = env_events[i]
        if event.get("state") == "failure":
            failure_time = event.get("created_at")
            if failure_time is None:
                i += 1
                continue
            if failure_time.tzinfo is None:
                failure_time = failure_time.replace(tzinfo=timezone.utc)

            # Find the next success after this failure.
            for j in range(i + 1, len(env_events)):
                candidate = env_events[j]
                if candidate.get("state") == "success":
                    restore_time = candidate.get("created_at")
                    if restore_time is None:
                        break
                    if restore_time.tzinfo is None:
                        restore_time = restore_time.replace(tzinfo=timezone.utc)
                    restore_times.append((restore_time - failure_time).total_seconds())
                    break
        i += 1

    if not restore_times:
        return 0.0
    return sum(restore_times) / len(restore_times)
