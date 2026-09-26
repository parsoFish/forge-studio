"""Unit tests for the FastAPI webhook event dispatch logic.

These tests exercise the ``dispatch_event`` pure function (or equivalent)
in isolation, following the same pattern as ``test_webhook_signature.py``
and ``test_metrics_token.py``.  They are written BEFORE the implementation
exists and are expected to FAIL until the FastAPI app is implemented in
``metrics/src/main.py``.

Coverage plan
-------------
* dispatch_event — routes push, deployment, deployment_status, workflow_run, release, create
* dispatch_event — unsupported event types are handled gracefully (no exception)
* dispatch_event — unsupported events log at DEBUG, not WARNING/ERROR
* dispatch_event — supported events mark dispatched=True in the return value
* dispatch_event — unsupported events mark dispatched=False in the return value
* SUPPORTED_EVENTS — set/mapping must contain exactly the expected event types
* PORT default — DEFAULT_PORT constant is 8000 when PORT env var is absent
"""

import logging
import sys
import os

import pytest

# Add src to path so we can import main module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

# Supported GitHub event types for GitWeave — the dispatcher must handle all of these
EXPECTED_SUPPORTED_EVENTS = {
    "push",
    "deployment",
    "deployment_status",
    "workflow_run",
    "release",
    "create",
}


# ---------------------------------------------------------------------------
# Supported event types — each dispatches to a dedicated handler
# ---------------------------------------------------------------------------


class TestDispatchEventForSupportedEvents:
    """dispatch_event routes each supported GitHub event type to its handler."""

    @pytest.mark.parametrize("event_type", sorted(EXPECTED_SUPPORTED_EVENTS))
    def test_supported_event_is_dispatched(self, event_type):
        """Each supported event type must be dispatched without raising an exception."""
        from main import dispatch_event, EventStore

        store = EventStore()
        payload = {"action": "completed", "ref": "refs/heads/main"}
        # Must not raise — unsupported handling should be the caller's concern
        result = dispatch_event(event_type, payload, store)
        assert result is not None

    @pytest.mark.parametrize("event_type", sorted(EXPECTED_SUPPORTED_EVENTS))
    def test_supported_event_returns_dispatched_true(self, event_type):
        """dispatch_event must return a result indicating the event was dispatched."""
        from main import dispatch_event, EventStore

        store = EventStore()
        payload = {"action": "completed"}
        result = dispatch_event(event_type, payload, store)
        assert result.get("dispatched") is True, (
            f"dispatch_event('{event_type}', ...) must return dispatched=True; "
            f"got: {result!r}"
        )

    @pytest.mark.parametrize("event_type", sorted(EXPECTED_SUPPORTED_EVENTS))
    def test_supported_event_result_includes_event_type(self, event_type):
        """The dispatch result must echo back the event type that was processed."""
        from main import dispatch_event, EventStore

        store = EventStore()
        result = dispatch_event(event_type, {}, store)
        assert result.get("event") == event_type

    @pytest.mark.parametrize("event_type", sorted(EXPECTED_SUPPORTED_EVENTS))
    def test_supported_event_result_status_is_ok(self, event_type):
        """Successful dispatch must return status='ok'."""
        from main import dispatch_event, EventStore

        store = EventStore()
        result = dispatch_event(event_type, {}, store)
        assert result.get("status") == "ok"

    @pytest.mark.parametrize("event_type", sorted(EXPECTED_SUPPORTED_EVENTS))
    def test_supported_event_is_recorded_in_event_store(self, event_type):
        """After dispatching, the event store must contain the processed event."""
        from main import dispatch_event, EventStore

        store = EventStore()
        dispatch_event(event_type, {"ref": "refs/heads/main"}, store)
        assert store.count() > 0, (
            f"EventStore must record the dispatched '{event_type}' event; "
            f"store is empty after dispatch"
        )


# ---------------------------------------------------------------------------
# Unsupported event types — must return 200-compatible result, log at DEBUG
# ---------------------------------------------------------------------------


class TestDispatchEventForUnsupportedEvents:
    """dispatch_event handles unknown GitHub event types gracefully."""

    @pytest.mark.parametrize(
        "event_type",
        ["check_run", "check_suite", "gollum", "member", "unknown_xyz", ""],
    )
    def test_unsupported_event_does_not_raise(self, event_type):
        """An unsupported event type must never raise an exception.

        GitHub can send any event type; crashing the receiver would cause
        GitHub to retry indefinitely and potentially miss legitimate events.
        """
        from main import dispatch_event, EventStore

        store = EventStore()
        # Must not raise
        dispatch_event(event_type, {"action": "created"}, store)

    @pytest.mark.parametrize(
        "event_type",
        ["check_run", "check_suite", "gollum", "unknown_xyz"],
    )
    def test_unsupported_event_returns_dispatched_false(self, event_type):
        """Unsupported events must return dispatched=False, not dispatched=True.

        The caller (route handler) uses this to distinguish handled events
        from pass-through/ignored ones, without resorting to exceptions.
        """
        from main import dispatch_event, EventStore

        store = EventStore()
        result = dispatch_event(event_type, {}, store)
        assert result.get("dispatched") is False, (
            f"dispatch_event('{event_type}', ...) must return dispatched=False; "
            f"got: {result!r}"
        )

    @pytest.mark.parametrize(
        "event_type",
        ["check_run", "check_suite", "gollum", "unknown_xyz"],
    )
    def test_unsupported_event_result_status_is_ok(self, event_type):
        """Unsupported events still return status='ok' — we accept and ignore them.

        Returning a non-ok status or raising would cause GitHub to retry
        the webhook delivery, which is undesirable for genuinely unsupported types.
        """
        from main import dispatch_event, EventStore

        store = EventStore()
        result = dispatch_event(event_type, {}, store)
        assert result.get("status") == "ok"

    def test_unsupported_event_logs_at_debug_not_warning(self, caplog):
        """Unsupported events must be logged at DEBUG level, never WARNING or above.

        Logging unsupported events at WARNING would spam operators for every
        legitimate-but-unhandled GitHub event type (e.g. star, fork, gollum).
        """
        from main import dispatch_event, EventStore

        store = EventStore()
        with caplog.at_level(logging.DEBUG):
            dispatch_event("gollum", {"action": "created"}, store)

        # At least one DEBUG record should mention the event
        debug_records = [r for r in caplog.records if r.levelno == logging.DEBUG]
        assert any("gollum" in r.message for r in debug_records), (
            "Unsupported event type must be mentioned in at least one DEBUG log record"
        )

    def test_unsupported_event_produces_no_warning_or_error_logs(self, caplog):
        """Unsupported events must not produce WARNING or higher logs.

        Operators rely on WARNING logs to detect misconfigurations; flooding
        them with noise for every unsupported event type is harmful.
        """
        from main import dispatch_event, EventStore

        store = EventStore()
        with caplog.at_level(logging.DEBUG):
            dispatch_event("unknown_event_type_xyz", {"action": "created"}, store)

        high_level_records = [
            r for r in caplog.records if r.levelno >= logging.WARNING
        ]
        assert not high_level_records, (
            f"Unsupported event dispatch must not log at WARNING or above; "
            f"found: {[r.message for r in high_level_records]}"
        )


# ---------------------------------------------------------------------------
# SUPPORTED_EVENTS registry — must list exactly the expected event types
# ---------------------------------------------------------------------------


class TestSupportedEventsRegistry:
    """The module's SUPPORTED_EVENTS constant/mapping must cover the expected set."""

    def test_supported_events_contains_push(self):
        """'push' must be a supported event — it is the most common GitHub event."""
        from main import SUPPORTED_EVENTS

        assert "push" in SUPPORTED_EVENTS

    def test_supported_events_contains_deployment(self):
        """'deployment' is the primary trigger for GitWeave — must be handled."""
        from main import SUPPORTED_EVENTS

        assert "deployment" in SUPPORTED_EVENTS

    def test_supported_events_contains_deployment_status(self):
        """'deployment_status' tracks the outcome of each deployment step."""
        from main import SUPPORTED_EVENTS

        assert "deployment_status" in SUPPORTED_EVENTS

    def test_supported_events_contains_workflow_run(self):
        """'workflow_run' links CI pipeline outcomes to deployments."""
        from main import SUPPORTED_EVENTS

        assert "workflow_run" in SUPPORTED_EVENTS

    def test_supported_events_contains_release(self):
        """'release' signals a new version is available for deployment."""
        from main import SUPPORTED_EVENTS

        assert "release" in SUPPORTED_EVENTS

    def test_supported_events_contains_create(self):
        """'create' covers tag/branch creation events that trigger deployments."""
        from main import SUPPORTED_EVENTS

        assert "create" in SUPPORTED_EVENTS

    def test_supported_events_does_not_contain_unknown_type(self):
        """Fabricated event types must NOT appear in SUPPORTED_EVENTS."""
        from main import SUPPORTED_EVENTS

        assert "totally_unknown_event_xyz" not in SUPPORTED_EVENTS


# ---------------------------------------------------------------------------
# PORT configuration — default 8000, overridable via env var
# ---------------------------------------------------------------------------


class TestPortConfiguration:
    """The server port must default to 8000 and be overridable via the PORT env var."""

    def test_default_port_is_8000(self, monkeypatch):
        """DEFAULT_PORT (or equivalent constant) must be 8000 when PORT is unset."""
        monkeypatch.delenv("PORT", raising=False)
        import importlib
        import main

        importlib.reload(main)
        assert main.PORT == 8000, (
            f"PORT must default to 8000 when PORT env var is absent; got {main.PORT}"
        )

    def test_port_is_overridable_via_env_var(self, monkeypatch):
        """Setting PORT=9090 must result in the app using port 9090."""
        monkeypatch.setenv("PORT", "9090")
        import importlib
        import main

        importlib.reload(main)
        assert main.PORT == 9090, (
            f"PORT env var must override the default port; expected 9090, got {main.PORT}"
        )

    def test_port_is_an_integer(self, monkeypatch):
        """PORT must be stored as an integer, not a string, for uvicorn compatibility."""
        monkeypatch.delenv("PORT", raising=False)
        import importlib
        import main

        importlib.reload(main)
        assert isinstance(main.PORT, int), (
            f"PORT must be an int for uvicorn; got {type(main.PORT)}"
        )


# ---------------------------------------------------------------------------
# EventStore — injectable dependency for tracking processed events
# ---------------------------------------------------------------------------


class TestEventStore:
    """EventStore is a lightweight in-process store for processed webhook events."""

    def test_event_store_initialises_empty(self):
        """A fresh EventStore must have zero recorded events."""
        from main import EventStore

        store = EventStore()
        assert store.count() == 0

    def test_event_store_records_appended_events(self):
        """Appending an event must increment the count."""
        from main import EventStore

        store = EventStore()
        store.append("push", {"ref": "refs/heads/main"})
        assert store.count() == 1

    def test_event_store_records_multiple_events(self):
        """Multiple appends must all be retained."""
        from main import EventStore

        store = EventStore()
        store.append("push", {})
        store.append("deployment", {})
        store.append("release", {})
        assert store.count() == 3

    def test_event_store_records_preserve_event_type(self):
        """Stored records must preserve the original event type."""
        from main import EventStore

        store = EventStore()
        store.append("deployment_status", {"state": "success"})
        records = store.all()
        assert len(records) == 1
        assert records[0]["type"] == "deployment_status"

    def test_event_store_records_preserve_payload(self):
        """Stored records must preserve the full payload without mutation."""
        from main import EventStore

        store = EventStore()
        payload = {"state": "success", "deployment": {"id": 42}}
        store.append("deployment_status", payload)
        records = store.all()
        assert records[0]["payload"] == payload

    def test_event_store_returns_immutable_snapshot(self):
        """store.all() must return a snapshot — mutating it must not affect the store."""
        from main import EventStore

        store = EventStore()
        store.append("push", {})
        snapshot = store.all()
        snapshot.append({"type": "injected", "payload": {}})
        # The store's internal count must still be 1
        assert store.count() == 1

    def test_app_is_importable_without_starting_server(self):
        """The FastAPI app object must be importable without binding to any port.

        If importing the module starts a TCP listener, tests running in parallel
        will collide on port assignment, and CI environments may block port binding.
        """
        import importlib
        import main

        # If import runs uvicorn.run() at module scope, this will block forever.
        # A successful import that returns quickly is the only acceptable outcome.
        assert hasattr(main, "app"), (
            "main.app must be a FastAPI application object importable without "
            "starting the HTTP server"
        )
