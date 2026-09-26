"""Unit tests for startup_replay() — fetches last 24h from GitHub Events API on empty DB.

startup_replay() is the bootstrap mechanism that seeds the EventStore from the
GitHub Events API when the service starts against an empty database.  This avoids
a cold-start gap in DORA metrics after a fresh deployment.

Behaviour contract:
  1. If the store is empty, call the GitHub Events API and store matching events.
  2. If the store already has events, skip the API call entirely (idempotent).
  3. Only events within the last 24 hours are stored.
  4. GITHUB_TOKEN must be sent in the Authorization header of every API request.
  5. GITHUB_ORG (or equivalent) must be set to target the correct organisation.
  6. Missing GITHUB_TOKEN or GITHUB_ORG raises a clear configuration error.
  7. HTTP errors from the GitHub API (401, 403, 5xx) are handled gracefully so
     they do not prevent service startup.

All tests mock requests.get — no real network calls are made.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

# ---------------------------------------------------------------------------
# Sample GitHub Events API payloads (realistic but minimal)
# ---------------------------------------------------------------------------

_PUSH_API_EVENT = {
    "type": "PushEvent",
    "repo": {"name": "octocat/Hello-World"},
    "created_at": "2024-03-10T14:00:00Z",
    "payload": {
        "ref": "refs/heads/main",
        "commits": [
            {"sha": "abc123", "timestamp": "2024-03-10T14:00:00Z"},
        ],
    },
}

_PR_API_EVENT = {
    "type": "PullRequestEvent",
    "repo": {"name": "octocat/Hello-World"},
    "created_at": "2024-03-10T15:00:00Z",
    "payload": {
        "action": "closed",
        "pull_request": {
            "merged": True,
            "merged_at": "2024-03-10T15:00:00Z",
            "merge_commit_sha": "def456",
            "number": 42,
        },
    },
}

_DEPLOYMENT_API_EVENT = {
    "type": "DeploymentStatusEvent",
    "repo": {"name": "octocat/Hello-World"},
    "created_at": "2024-03-10T16:00:00Z",
    "payload": {
        "deployment_status": {
            "state": "success",
            "id": 99,
            "created_at": "2024-03-10T16:00:00Z",
            "environment": "production",
        },
    },
}

_OLD_PUSH_API_EVENT = {
    "type": "PushEvent",
    "repo": {"name": "octocat/Hello-World"},
    "created_at": "2020-01-01T00:00:00Z",  # Well outside the 24h window
    "payload": {
        "ref": "refs/heads/main",
        "commits": [],
    },
}


def _make_ok_response(events: list) -> MagicMock:
    """Build a mock requests.Response with status_code=200 and a JSON body."""
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = events
    mock.raise_for_status = MagicMock()
    return mock


def _make_error_response(status_code: int, message: str) -> MagicMock:
    """Build a mock requests.Response representing an HTTP error."""
    import requests

    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = {"message": message}
    mock.raise_for_status = MagicMock(
        side_effect=requests.HTTPError(f"HTTP {status_code}: {message}")
    )
    return mock


# ---------------------------------------------------------------------------
# Replay when store is empty
# ---------------------------------------------------------------------------


class TestStartupReplayWhenStoreIsEmpty:
    """startup_replay() queries GitHub API and populates the store when empty."""

    def test_calls_github_events_api_when_store_is_empty(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_test_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch("requests.get", return_value=_make_ok_response([])) as mock_get:
            startup_replay(store)

        mock_get.assert_called()

    def test_uses_github_token_in_authorization_header(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        token = "ghp_super_secret_token"
        monkeypatch.setenv("GITHUB_TOKEN", token)
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch("requests.get", return_value=_make_ok_response([])) as mock_get:
            startup_replay(store)

        # Token must appear in every API call made by startup_replay
        assert mock_get.called
        all_calls_str = str(mock_get.call_args_list)
        assert token in all_calls_str, (
            f"GITHUB_TOKEN '{token}' must appear in the API request arguments; "
            f"actual calls: {all_calls_str}"
        )

    def test_targets_correct_github_org_in_api_url(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "my-org")

        with patch("requests.get", return_value=_make_ok_response([])) as mock_get:
            startup_replay(store)

        all_calls_str = str(mock_get.call_args_list)
        assert "my-org" in all_calls_str, (
            "GITHUB_ORG 'my-org' must appear in the GitHub API URL; "
            f"actual calls: {all_calls_str}"
        )

    def test_stores_push_events_from_api_response(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch("requests.get", return_value=_make_ok_response([_PUSH_API_EVENT])):
            startup_replay(store)

        results = store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) >= 1, (
            "startup_replay must store PushEvents retrieved from the GitHub API"
        )

    def test_stores_pull_request_events_from_api_response(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch("requests.get", return_value=_make_ok_response([_PR_API_EVENT])):
            startup_replay(store)

        results = store.get_events(
            "octocat/Hello-World",
            "pull_request",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) >= 1, (
            "startup_replay must store PullRequestEvents retrieved from the GitHub API"
        )

    def test_stores_deployment_status_events_from_api_response(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_ok_response([_DEPLOYMENT_API_EVENT]),
        ):
            startup_replay(store)

        results = store.get_events(
            "octocat/Hello-World",
            "deployment_status",
            datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) >= 1, (
            "startup_replay must store DeploymentStatusEvents retrieved from the GitHub API"
        )

    def test_ignores_unknown_event_types_from_api(self, monkeypatch):
        """Events of unrecognised types (star, fork, etc.) must not crash startup_replay."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        star_event = {
            "type": "WatchEvent",
            "repo": {"name": "octocat/Hello-World"},
            "created_at": "2024-03-10T14:00:00Z",
            "payload": {"action": "started"},
        }

        with patch("requests.get", return_value=_make_ok_response([star_event])):
            # Must not raise
            startup_replay(store)


# ---------------------------------------------------------------------------
# 24-hour window filtering
# ---------------------------------------------------------------------------


class TestStartupReplay24HourWindow:
    """startup_replay() limits stored events to the last 24 hours."""

    def test_does_not_store_events_older_than_24_hours(self, monkeypatch):
        """Events timestamped more than 24h ago must not be stored."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_ok_response([_OLD_PUSH_API_EVENT]),
        ):
            startup_replay(store)

        results = store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 0, (
            "startup_replay must not store the 2020 event — "
            "it is outside the 24h replay window"
        )

    def test_stores_event_within_last_24_hours(self, monkeypatch):
        """Events timestamped within the last 24h must be stored."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        now = datetime.now(timezone.utc)
        recent_ts = (now - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ")
        recent_push = {
            "type": "PushEvent",
            "repo": {"name": "octocat/Hello-World"},
            "created_at": recent_ts,
            "payload": {
                "ref": "refs/heads/main",
                "commits": [{"sha": "abc", "timestamp": recent_ts}],
            },
        }

        with patch("requests.get", return_value=_make_ok_response([recent_push])):
            startup_replay(store)

        cutoff = now - timedelta(hours=24)
        results = store.get_events("octocat/Hello-World", "push", cutoff)
        assert len(results) >= 1


# ---------------------------------------------------------------------------
# Idempotency — skip replay when store already has events
# ---------------------------------------------------------------------------


class TestStartupReplayIdempotency:
    """startup_replay() must skip the API call when the store already has events."""

    def test_skips_api_call_when_store_already_has_events(self, monkeypatch):
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        store.store_event(
            {
                "event_type": "push",
                "repo": "octocat/Hello-World",
                "created_at": datetime(2024, 3, 10, tzinfo=timezone.utc),
            }
        )
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch("requests.get") as mock_get:
            startup_replay(store)

        mock_get.assert_not_called(), (
            "startup_replay must not call the GitHub API when the store already has data"
        )

    def test_does_not_duplicate_events_when_called_twice(self, monkeypatch):
        """Calling startup_replay twice on a store that has events after the first call."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_ok_response([_PUSH_API_EVENT]),
        ):
            startup_replay(store)  # First call — empty DB → replay
            count_after_first = len(
                store.get_events(
                    "octocat/Hello-World",
                    "push",
                    datetime(2024, 1, 1, tzinfo=timezone.utc),
                )
            )

        with patch("requests.get") as mock_get_second:
            startup_replay(store)  # Second call — store has events → skip

        mock_get_second.assert_not_called()
        count_after_second = len(
            store.get_events(
                "octocat/Hello-World",
                "push",
                datetime(2024, 1, 1, tzinfo=timezone.utc),
            )
        )
        assert count_after_second == count_after_first, (
            "startup_replay must not add duplicate events on repeated calls"
        )


# ---------------------------------------------------------------------------
# Error handling — configuration errors
# ---------------------------------------------------------------------------


class TestStartupReplayConfigurationErrors:
    """startup_replay() raises a clear error when required env vars are missing."""

    def test_raises_when_github_token_is_absent(self, monkeypatch):
        """Missing GITHUB_TOKEN is a configuration error — service cannot authenticate."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with pytest.raises((ValueError, RuntimeError, KeyError, EnvironmentError)):
            startup_replay(store)

    def test_raises_when_github_org_is_absent(self, monkeypatch):
        """Missing GITHUB_ORG means there is no target to replay events from."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.delenv("GITHUB_ORG", raising=False)

        with pytest.raises((ValueError, RuntimeError, KeyError, EnvironmentError)):
            startup_replay(store)

    def test_error_message_mentions_missing_github_token(self, monkeypatch):
        """The exception message must name the missing variable for quick diagnosis."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with pytest.raises(Exception) as exc_info:
            startup_replay(store)

        assert "GITHUB_TOKEN" in str(exc_info.value), (
            "Exception message must reference 'GITHUB_TOKEN' to aid debugging"
        )


# ---------------------------------------------------------------------------
# Error handling — GitHub API failures
# ---------------------------------------------------------------------------


class TestStartupReplayAPIErrors:
    """startup_replay() handles GitHub API HTTP errors without crashing the service."""

    def test_handles_401_unauthorized_without_propagating(self, monkeypatch):
        """HTTP 401 from GitHub API must not prevent service startup."""
        import requests

        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "bad_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_error_response(401, "Bad credentials"),
        ):
            try:
                startup_replay(store)
            except requests.HTTPError as exc:
                pytest.fail(
                    f"startup_replay must not propagate HTTP 401 — "
                    f"service must still start with an empty store; got: {exc}"
                )

    def test_handles_403_rate_limited_without_propagating(self, monkeypatch):
        """HTTP 403 rate limit must not prevent service startup."""
        import requests

        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_error_response(403, "API rate limit exceeded"),
        ):
            try:
                startup_replay(store)
            except requests.HTTPError as exc:
                pytest.fail(
                    f"startup_replay must not propagate HTTP 403 — "
                    f"service must still start with an empty store; got: {exc}"
                )

    def test_handles_503_service_unavailable_without_propagating(self, monkeypatch):
        """GitHub API downtime (503) must not prevent service startup."""
        import requests

        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_error_response(503, "Service unavailable"),
        ):
            try:
                startup_replay(store)
            except requests.HTTPError as exc:
                pytest.fail(
                    f"startup_replay must not propagate HTTP 503; got: {exc}"
                )

    def test_store_remains_empty_after_failed_replay(self, monkeypatch):
        """If the GitHub API returns an error, the store must remain empty (no partial data)."""
        from store import InMemoryEventStore
        from replay import startup_replay

        store = InMemoryEventStore()
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token")
        monkeypatch.setenv("GITHUB_ORG", "octocat")

        with patch(
            "requests.get",
            return_value=_make_error_response(403, "Rate limited"),
        ):
            startup_replay(store)

        results = store.get_events(
            "octocat/Hello-World",
            "push",
            datetime.min.replace(tzinfo=timezone.utc),
        )
        assert len(results) == 0, (
            "After a failed replay, the store must still be empty "
            "(no partial or corrupt data)"
        )
