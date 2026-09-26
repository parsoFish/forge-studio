"""Unit tests for GitHub event handlers and EventStore.

Tests follow TDD: written before implementation. Each test exercises one clear
behaviour — valid payload parsing, required field extraction, malformed payload
rejection, or store insertion.

Fixture JSON files under tests/fixtures/ contain real GitHub webhook payloads.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Add src to path so we can import handler modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


# ---------------------------------------------------------------------------
# EventStore Protocol + InMemoryEventStore
# ---------------------------------------------------------------------------


class TestInMemoryEventStore:
    """InMemoryEventStore implements the EventStore Protocol."""

    def test_starts_empty(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        assert store.get_events("octocat/Hello-World", "push", datetime.min.replace(tzinfo=timezone.utc)) == []

    def test_store_event_and_retrieve(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        event = {
            "event_type": "push",
            "repo": "octocat/Hello-World",
            "ref": "refs/heads/main",
            "commits": [],
            "created_at": datetime(2011, 1, 26, 19, 1, 12, tzinfo=timezone.utc),
        }
        store.store_event(event)
        results = store.get_events(
            "octocat/Hello-World", "push", datetime(2011, 1, 1, tzinfo=timezone.utc)
        )
        assert len(results) == 1
        assert results[0]["repo"] == "octocat/Hello-World"

    def test_get_events_filters_by_repo(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event({"event_type": "push", "repo": "octocat/Hello-World", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        store.store_event({"event_type": "push", "repo": "other/repo", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        results = store.get_events("octocat/Hello-World", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1
        assert results[0]["repo"] == "octocat/Hello-World"

    def test_get_events_filters_by_event_type(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event({"event_type": "push", "repo": "octocat/Hello-World", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        store.store_event({"event_type": "deployment_status", "repo": "octocat/Hello-World", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        results = store.get_events("octocat/Hello-World", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1
        assert results[0]["event_type"] == "push"

    def test_get_events_filters_by_since_dt(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event({"event_type": "push", "repo": "r", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        store.store_event({"event_type": "push", "repo": "r", "created_at": datetime(2024, 6, 1, tzinfo=timezone.utc)})
        results = store.get_events("r", "push", datetime(2024, 3, 1, tzinfo=timezone.utc))
        assert len(results) == 1
        assert results[0]["created_at"] == datetime(2024, 6, 1, tzinfo=timezone.utc)

    def test_store_event_does_not_mutate_input(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        event = {"event_type": "push", "repo": "r", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)}
        store.store_event(event)
        # Mutate the original
        event["repo"] = "mutated"
        results = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1
        assert results[0]["repo"] == "r"

    def test_get_events_returns_snapshot_not_mutable_reference(self):
        from store import InMemoryEventStore

        store = InMemoryEventStore()
        store.store_event({"event_type": "push", "repo": "r", "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        snapshot = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        snapshot.clear()
        results = store.get_events("r", "push", datetime(2023, 1, 1, tzinfo=timezone.utc))
        assert len(results) == 1


# ---------------------------------------------------------------------------
# deployment_status handler
# ---------------------------------------------------------------------------


class TestDeploymentStatusHandler:
    """handlers.deployment_status.handle parses deployment_status webhook payloads."""

    def test_valid_payload_returns_event_dict(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event is not None

    def test_extracts_repo(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["repo"] == "octocat/Hello-World"

    def test_extracts_environment(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["environment"] == "production"

    def test_extracts_state_success(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["state"] == "success"

    def test_extracts_state_failure(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status_failure.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["state"] == "failure"

    def test_extracts_created_at(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["created_at"] == datetime(2012, 7, 20, 1, 19, 13, tzinfo=timezone.utc)

    def test_extracts_deployment_id(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["deployment_id"] == 1

    def test_stores_event_in_store(self):
        from handlers.deployment_status import handle
        from store import InMemoryEventStore

        payload = load_fixture("deployment_status.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "deployment_status",
            datetime(2012, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1

    def test_malformed_missing_deployment_status_key_raises_400(self):
        from handlers.deployment_status import handle
        from fastapi import HTTPException

        payload = {"repository": {"full_name": "octocat/Hello-World"}}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_repository_key_raises_400(self):
        from handlers.deployment_status import handle
        from fastapi import HTTPException

        payload = {"deployment_status": {"state": "success", "id": 1, "created_at": "2012-07-20T01:19:13Z", "environment": "production"}}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_state_raises_400(self):
        from handlers.deployment_status import handle
        from fastapi import HTTPException

        payload = load_fixture("deployment_status.json")
        del payload["deployment_status"]["state"]
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_failure_fixture_deployment_id(self):
        from handlers.deployment_status import handle

        payload = load_fixture("deployment_status_failure.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["deployment_id"] == 7


# ---------------------------------------------------------------------------
# pull_request handler
# ---------------------------------------------------------------------------


class TestPullRequestHandler:
    """handlers.pull_request.handle parses merged PR webhook payloads."""

    def test_merged_pr_returns_event_dict(self):
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event is not None

    def test_extracts_repo(self):
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["repo"] == "octocat/Hello-World"

    def test_extracts_merged_at(self):
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["merged_at"] == datetime(2011, 1, 28, 19, 1, 12, tzinfo=timezone.utc)

    def test_extracts_commit_sha(self):
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["commit_sha"] == "e5bd3914e2e596debea16f433f57875b5b90bcd6"

    def test_extracts_pr_number(self):
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["pr_number"] == 1

    def test_stores_merged_pr_in_store(self):
        from handlers.pull_request import handle
        from store import InMemoryEventStore

        payload = load_fixture("pull_request_merged.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "pull_request",
            datetime(2011, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1

    def test_closed_not_merged_returns_none(self):
        """action=closed but merged=false — not a DORA-relevant merge event."""
        from handlers.pull_request import handle

        payload = load_fixture("pull_request_closed_not_merged.json")
        store = _make_store()
        event = handle(payload, store)
        assert event is None

    def test_closed_not_merged_not_stored(self):
        from handlers.pull_request import handle
        from store import InMemoryEventStore

        payload = load_fixture("pull_request_closed_not_merged.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "pull_request",
            datetime(2011, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 0

    def test_opened_pr_not_stored(self):
        from handlers.pull_request import handle
        from store import InMemoryEventStore

        payload = load_fixture("pull_request_opened.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "pull_request",
            datetime(2011, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 0

    def test_malformed_missing_pull_request_key_raises_400(self):
        from handlers.pull_request import handle
        from fastapi import HTTPException

        payload = {"action": "closed", "repository": {"full_name": "octocat/Hello-World"}}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_repository_key_raises_400(self):
        from handlers.pull_request import handle
        from fastapi import HTTPException

        payload = {"action": "closed", "pull_request": {"merged": True, "merged_at": "2011-01-28T19:01:12Z", "merge_commit_sha": "abc", "number": 1}}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_merged_at_raises_400_for_merged_pr(self):
        from handlers.pull_request import handle
        from fastapi import HTTPException

        payload = load_fixture("pull_request_merged.json")
        del payload["pull_request"]["merged_at"]
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# push handler
# ---------------------------------------------------------------------------


class TestPushHandler:
    """handlers.push.handle parses push webhook payloads."""

    def test_valid_payload_returns_event_dict(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        assert event is not None

    def test_extracts_repo(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["repo"] == "octocat/Hello-World"

    def test_extracts_ref(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["ref"] == "refs/heads/main"

    def test_extracts_commits_list(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        assert len(event["commits"]) == 2

    def test_each_commit_has_sha(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        shas = {c["sha"] for c in event["commits"]}
        assert "0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1a" in shas
        assert "1234567890abcdef1234567890abcdef12345678" in shas

    def test_each_commit_has_timestamp(self):
        from handlers.push import handle

        payload = load_fixture("push.json")
        store = _make_store()
        event = handle(payload, store)
        for commit in event["commits"]:
            assert "timestamp" in commit
            assert isinstance(commit["timestamp"], datetime)

    def test_stores_push_event_in_store(self):
        from handlers.push import handle
        from store import InMemoryEventStore

        payload = load_fixture("push.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2011, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1

    def test_empty_commits_returns_event_with_empty_list(self):
        from handlers.push import handle

        payload = load_fixture("push_empty_commits.json")
        store = _make_store()
        event = handle(payload, store)
        assert event["commits"] == []

    def test_empty_commits_still_stores_event(self):
        from handlers.push import handle
        from store import InMemoryEventStore

        payload = load_fixture("push_empty_commits.json")
        store = InMemoryEventStore()
        handle(payload, store)
        results = store.get_events(
            "octocat/Hello-World",
            "push",
            datetime(2011, 1, 1, tzinfo=timezone.utc),
        )
        assert len(results) == 1

    def test_malformed_missing_repository_raises_400(self):
        from handlers.push import handle
        from fastapi import HTTPException

        payload = {"ref": "refs/heads/main", "commits": []}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_ref_raises_400(self):
        from handlers.push import handle
        from fastapi import HTTPException

        payload = {"repository": {"full_name": "octocat/Hello-World"}, "commits": []}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400

    def test_malformed_missing_commits_key_raises_400(self):
        from handlers.push import handle
        from fastapi import HTTPException

        payload = {"ref": "refs/heads/main", "repository": {"full_name": "octocat/Hello-World"}}
        store = _make_store()
        with pytest.raises(HTTPException) as exc_info:
            handle(payload, store)
        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store():
    from store import InMemoryEventStore

    return InMemoryEventStore()
