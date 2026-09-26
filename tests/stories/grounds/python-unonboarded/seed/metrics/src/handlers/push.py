"""Handler for GitHub push webhook events.

Parses push payloads and stores a normalised event containing the repo,
ref, and a list of commits (sha + timestamp) required for DORA lead time
for changes metrics.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    from store import EventStore


def handle(payload: dict[str, Any], store: "EventStore") -> dict[str, Any]:
    """Parse a push payload, persist it, and return the normalised event.

    Args:
        payload: Raw GitHub push webhook payload.
        store:   EventStore implementation to persist the parsed event.

    Returns:
        Normalised event dict with keys: repo, ref, commits (list of
        dicts with sha and timestamp), created_at (datetime of push).

    Raises:
        HTTPException(400): When required fields are absent from the payload.
    """
    if "repository" not in payload or "full_name" not in payload.get("repository", {}):
        raise HTTPException(status_code=400, detail="Missing required field: repository.full_name")

    if "ref" not in payload:
        raise HTTPException(status_code=400, detail="Missing required field: ref")

    if "commits" not in payload:
        raise HTTPException(status_code=400, detail="Missing required field: commits")

    repo = payload["repository"]["full_name"]
    ref = payload["ref"]
    raw_commits = payload["commits"]

    commits = [
        {
            "sha": c["id"],
            "timestamp": _parse_iso8601(c["timestamp"], f"commits[].timestamp"),
        }
        for c in raw_commits
    ]

    # Use the most recent commit timestamp as the event's created_at; fall
    # back to now if there are no commits (e.g. branch creation push).
    if commits:
        created_at = max(c["timestamp"] for c in commits)
    else:
        created_at = datetime.now(tz=timezone.utc)

    event: dict[str, Any] = {
        "event_type": "push",
        "repo": repo,
        "ref": ref,
        "commits": commits,
        "created_at": created_at,
    }
    store.store_event(event)
    return event


def _parse_iso8601(value: str, field_name: str) -> datetime:
    """Parse an ISO-8601 timestamp string into a timezone-aware datetime."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid ISO-8601 timestamp for {field_name}: {value!r}",
        )
