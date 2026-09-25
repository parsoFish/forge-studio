"""Handler for GitHub pull_request webhook events.

Only merged PRs (action=closed AND merged=true) are DORA-relevant — they
represent a change delivery. Opened, synchronised, or closed-without-merge
events are silently ignored (return None, nothing stored).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    from store import EventStore


def handle(payload: dict[str, Any], store: "EventStore") -> dict[str, Any] | None:
    """Parse a pull_request payload, persist merged events, return normalised event or None.

    Args:
        payload: Raw GitHub pull_request webhook payload.
        store:   EventStore implementation to persist the parsed event.

    Returns:
        Normalised event dict for merged PRs; None for all other actions.

    Raises:
        HTTPException(400): When required fields are absent from a merged PR payload.
    """
    try:
        pr = payload["pull_request"]
    except KeyError:
        raise HTTPException(status_code=400, detail="Missing required field: pull_request")

    try:
        repo = payload["repository"]["full_name"]
    except KeyError:
        raise HTTPException(status_code=400, detail="Missing required field: repository.full_name")

    action = payload.get("action")
    is_merged = pr.get("merged", False)

    # Only DORA-relevant events: closed + actually merged
    if action != "closed" or not is_merged:
        return None

    # From here on the payload represents a real merge — required fields must exist.
    if "merged_at" not in pr or pr["merged_at"] is None:
        raise HTTPException(status_code=400, detail="Missing required field: pull_request.merged_at")

    merge_commit_sha = pr.get("merge_commit_sha")
    if not merge_commit_sha:
        raise HTTPException(status_code=400, detail="Missing required field: pull_request.merge_commit_sha")

    merged_at = _parse_iso8601(pr["merged_at"], "pull_request.merged_at")

    event: dict[str, Any] = {
        "event_type": "pull_request",
        "repo": repo,
        "merged_at": merged_at,
        "commit_sha": merge_commit_sha,
        "pr_number": pr.get("number"),
        "created_at": merged_at,
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
