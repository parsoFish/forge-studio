"""DORA Lead Time for Changes computation.

Lead time for changes measures the time from code commit (PR merge) to a
successful deployment in the target environment.  Returned as seconds over
the most recent 30-day window.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from store import EventStore

_WINDOW_DAYS = 30


def compute_lead_time_for_changes(
    store: "EventStore",
    repo: str,
    environment: str,
) -> float:
    """Return the mean lead time (seconds) from PR merge to successful deployment.

    Pairs each successful deployment with the most recent PR merge that
    preceded it, then averages the time differences over the 30-day window.

    Args:
        store:       EventStore implementation to query for events.
        repo:        Repository full name (e.g. 'org/repo').
        environment: Target environment label (e.g. 'production').

    Returns:
        Mean lead time in seconds as a float.  Returns 0.0 when there is
        insufficient data to compute a meaningful value.
    """
    since = datetime.now(timezone.utc) - timedelta(days=_WINDOW_DAYS)

    deployments = store.get_events(repo=repo, event_type="deployment_status", since_dt=since)
    successful_deployments = sorted(
        [e for e in deployments if e.get("state") == "success" and e.get("environment") == environment],
        key=lambda e: e.get("created_at", datetime.min),
    )
    if not successful_deployments:
        return 0.0

    pr_events = store.get_events(repo=repo, event_type="pull_request", since_dt=since)
    merged_prs = sorted(
        [e for e in pr_events if e.get("merged_at") is not None],
        key=lambda e: e.get("merged_at", datetime.min),
    )
    if not merged_prs:
        return 0.0

    lead_times: list[float] = []
    for deployment in successful_deployments:
        deploy_time = deployment.get("created_at")
        if deploy_time is None:
            continue
        if deploy_time.tzinfo is None:
            deploy_time = deploy_time.replace(tzinfo=timezone.utc)

        # Find the most recent PR merge that occurred before this deployment.
        preceding_merges = [
            pr for pr in merged_prs
            if pr.get("merged_at") is not None and pr["merged_at"] <= deploy_time
        ]
        if not preceding_merges:
            continue

        last_merge = preceding_merges[-1]
        merge_time = last_merge["merged_at"]
        if merge_time.tzinfo is None:
            merge_time = merge_time.replace(tzinfo=timezone.utc)

        lead_times.append((deploy_time - merge_time).total_seconds())

    if not lead_times:
        return 0.0
    return sum(lead_times) / len(lead_times)
