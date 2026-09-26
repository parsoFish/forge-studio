"""Startup replay: seed EventStore from GitHub Events API on cold start.

On service startup with an empty database, replay the last 24 hours of
events from the GitHub Events API.  This closes the cold-start gap in
DORA metrics after a fresh deployment.

Behaviour contract:
  1. If the store already has events, skip the API call (idempotent).
  2. If the store is empty, fetch the last 24h from GitHub and store them.
  3. GITHUB_TOKEN and GITHUB_ORG must be set; raise EnvironmentError if not.
  4. HTTP errors from the GitHub API are logged and silently swallowed so
     they do not prevent service startup — the store is left empty.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

# GitHub event types we care about for DORA metrics, mapped to our internal
# event_type strings.
_SUPPORTED_EVENT_TYPES: dict[str, str] = {
    "PushEvent": "push",
    "PullRequestEvent": "pull_request",
    "DeploymentStatusEvent": "deployment_status",
}


def _require_env(name: str) -> str:
    """Return the environment variable value or raise EnvironmentError."""
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(
            f"Required environment variable '{name}' is not set. "
            f"Set {name} before starting the metrics service."
        )
    return value


def _parse_github_event(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a raw GitHub Events API payload to our internal event dict.

    Returns None for unrecognised event types so callers can skip them.
    """
    gh_type = raw.get("type", "")
    event_type = _SUPPORTED_EVENT_TYPES.get(gh_type)
    if event_type is None:
        return None

    repo = raw.get("repo", {}).get("name", "")
    created_at_str = raw.get("created_at", "")
    try:
        created_at = datetime.strptime(created_at_str, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except (ValueError, TypeError):
        logger.warning("Could not parse created_at '%s' for event type %s", created_at_str, gh_type)
        return None

    payload = raw.get("payload", {})
    event: dict[str, Any] = {
        "event_type": event_type,
        "repo": repo,
        "created_at": created_at,
    }

    if event_type == "push":
        event["ref"] = payload.get("ref", "")
        event["commits"] = payload.get("commits", [])

    elif event_type == "pull_request":
        pr = payload.get("pull_request", {})
        event["pr_number"] = pr.get("number")
        event["commit_sha"] = pr.get("merge_commit_sha")
        merged_at_str = pr.get("merged_at")
        if merged_at_str:
            try:
                event["merged_at"] = datetime.strptime(
                    merged_at_str, "%Y-%m-%dT%H:%M:%SZ"
                ).replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                event["merged_at"] = None
        else:
            event["merged_at"] = None

    elif event_type == "deployment_status":
        ds = payload.get("deployment_status", {})
        event["environment"] = ds.get("environment", "")
        event["state"] = ds.get("state", "")
        event["deployment_id"] = ds.get("id")

    return event


def _store_is_empty(store: Any) -> bool:
    """Return True if the store contains no events in any recognised category.

    Queries all three DORA event types with a broad date range to determine
    whether any data has been seeded.
    """
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    # Use a sentinel repo that matches everything by checking all event types
    # across common repos.  Because InMemoryEventStore requires an exact repo
    # match we cannot use a wildcard — instead we check whether any events of
    # any type exist for _any_ repo by using the total count across a broad
    # internal query.
    #
    # Strategy: for each event type, check repo="" which will never match
    # anything real, but we can't do a "has any events" query via the Protocol.
    #
    # Better strategy: inject a sentinel event, check it, and remove it — too
    # invasive.  Instead we expose a lightweight check: if the store is
    # InMemoryEventStore we can inspect _events directly; for PostgreSQL we
    # query the tables.
    from store import InMemoryEventStore, PostgreSQLEventStore  # noqa: PLC0415

    if isinstance(store, InMemoryEventStore):
        return len(store._events) == 0  # noqa: SLF001

    if isinstance(store, PostgreSQLEventStore):
        import sqlalchemy  # noqa: PLC0415

        engine = store._get_engine()  # noqa: SLF001
        with engine.connect() as conn:
            for table in ("push_events", "pr_events", "deployment_events"):
                row = conn.execute(
                    sqlalchemy.text(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
                ).fetchone()
                if row and row[0] > 0:
                    return False
        return True

    # For unknown implementations try a broad date-range query on a sentinel
    # repo — if anything is returned the store is not empty.
    for event_type in ("push", "pull_request", "deployment_status"):
        if store.get_events("", event_type, epoch):
            return False
    return True


def startup_replay(store: Any) -> None:
    """Seed store from the GitHub Events API if the store is currently empty.

    Raises EnvironmentError if GITHUB_TOKEN or GITHUB_ORG are not set.
    Silently swallows HTTP errors so service startup is not blocked.
    """
    github_token = _require_env("GITHUB_TOKEN")
    github_org = _require_env("GITHUB_ORG")

    if not _store_is_empty(store):
        logger.info("startup_replay: store already has events — skipping GitHub API fetch")
        return

    logger.info("startup_replay: store is empty — fetching last 24h from GitHub Events API")

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    url = f"https://api.github.com/orgs/{github_org}/events"
    headers = {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github.v3+json",
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.HTTPError as exc:
        logger.warning(
            "startup_replay: GitHub API returned an HTTP error — "
            "starting with empty store. Error: %s",
            exc,
        )
        return
    except requests.RequestException as exc:
        logger.warning(
            "startup_replay: Network error contacting GitHub API — "
            "starting with empty store. Error: %s",
            exc,
        )
        return

    raw_events: list[dict[str, Any]] = response.json()
    stored_count = 0

    for raw in raw_events:
        event = _parse_github_event(raw)
        if event is None:
            continue  # unrecognised event type

        if event["created_at"] < cutoff:
            continue  # older than 24h window

        store.store_event(event)
        stored_count += 1

    logger.info("startup_replay: stored %d events from the last 24h", stored_count)


def replay_counters_from_store(
    store: Any,
    push_counter: Any,
    pr_counter: Any,
    deployment_counter: Any,
) -> None:
    """Hydrate Prometheus DORA counters from all persisted events in the store.

    Reads every stored event and increments the matching Prometheus counter so
    that /metrics reflects the full event history after a container restart.

    Supports InMemoryEventStore (test/dev) and PostgreSQLEventStore (production).
    For unknown store implementations the function silently does nothing, so
    service startup is never blocked.
    """
    from store import InMemoryEventStore, PostgreSQLEventStore  # noqa: PLC0415

    if isinstance(store, InMemoryEventStore):
        for event in store._events:  # noqa: SLF001
            event_type = event.get("event_type")
            if event_type == "push":
                push_counter.inc()
            elif event_type == "pull_request":
                pr_counter.inc()
            elif event_type == "deployment_status":
                deployment_counter.inc()

    elif isinstance(store, PostgreSQLEventStore):
        import sqlalchemy  # noqa: PLC0415

        engine = store._get_engine()  # noqa: SLF001
        with engine.connect() as conn:
            push_count = conn.execute(
                sqlalchemy.text("SELECT COUNT(*) FROM push_events")  # noqa: S608
            ).fetchone()[0]
            pr_count = conn.execute(
                sqlalchemy.text("SELECT COUNT(*) FROM pr_events")  # noqa: S608
            ).fetchone()[0]
            dep_count = conn.execute(
                sqlalchemy.text("SELECT COUNT(*) FROM deployment_events")  # noqa: S608
            ).fetchone()[0]

        if push_count:
            push_counter.inc(push_count)
        if pr_count:
            pr_counter.inc(pr_count)
        if dep_count:
            deployment_counter.inc(dep_count)
