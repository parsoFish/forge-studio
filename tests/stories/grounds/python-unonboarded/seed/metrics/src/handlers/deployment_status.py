"""Handler for GitHub deployment_status webhook events.

Parses the payload and stores a normalised event containing the fields
required for DORA deployment frequency and change failure rate metrics.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    from store import EventStore

_REQUIRED_STATUS_FIELDS = ("state", "id", "created_at", "environment")


def handle(payload: dict[str, Any], store: "EventStore") -> dict[str, Any]:
    """Parse a deployment_status payload, persist it, and return the normalised event.

    Args:
        payload: Raw GitHub deployment_status webhook payload.
        store:   EventStore implementation to persist the parsed event.

    Returns:
        Normalised event dict with keys: repo, environment, state,
        created_at (datetime), deployment_id.

    Raises:
        HTTPException(400): When required fields are absent from the payload.
    """
    try:
        status = payload["deployment_status"]
    except KeyError:
        raise HTTPException(status_code=400, detail="Missing required field: deployment_status")

    try:
        repo = payload["repository"]["full_name"]
    except KeyError:
        raise HTTPException(status_code=400, detail="Missing required field: repository.full_name")

    for field in _REQUIRED_STATUS_FIELDS:
        if field not in status:
            raise HTTPException(status_code=400, detail=f"Missing required field: deployment_status.{field}")

    created_at = _parse_iso8601(status["created_at"], "deployment_status.created_at")

    event: dict[str, Any] = {
        "event_type": "deployment_status",
        "repo": repo,
        "environment": status["environment"],
        "state": status["state"],
        "created_at": created_at,
        "deployment_id": status["id"],
    }
    store.store_event(event)

    if status["state"] == "success":
        from dora.deployment_frequency import update_gauge
        update_gauge(repo, status["environment"], store, created_at)

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
