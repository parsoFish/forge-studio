"""Integration tests for the FastAPI HTTP webhook router and event dispatcher.

Tests exercise the FastAPI TestClient against the full request/response cycle,
following the same pattern as ``test_webhook_endpoint.py`` and
``test_metrics_endpoint.py``.  They are written BEFORE the implementation
exists and are expected to FAIL until the FastAPI app is implemented in
``metrics/src/main.py``.

Coverage plan
-------------
* POST /webhook — dispatches on X-GitHub-Event header for all supported event types
* POST /webhook — unsupported event types return 200 (not 4xx) and log at DEBUG
* POST /webhook — missing X-GitHub-Event header returns 400 with clear error
* GET /healthz  — returns 200 JSON {status: ok}
* GET /metrics  — returns prometheus_client text format (Content-Type text/plain)
* Dependency injection — event store is overridable via app.dependency_overrides
* FastAPI app    — importable without starting the server
"""

import json
import logging
import sys
import os

import pytest

# Add src to path so we can import the main application module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

WEBHOOK_PATH = "/webhook"
HEALTHZ_PATH = "/healthz"
METRICS_PATH = "/metrics"

# Supported GitHub event types that the router must handle
SUPPORTED_EVENTS = [
    "push",
    "deployment",
    "deployment_status",
    "workflow_run",
    "release",
    "create",
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def app_module():
    """Import the FastAPI app module once per test module."""
    import main as m
    return m


@pytest.fixture
def event_store(app_module):
    """A fresh EventStore injected via FastAPI's dependency_overrides."""
    store = app_module.EventStore()
    app_module.app.dependency_overrides[app_module.get_event_store] = lambda: store
    yield store
    # Teardown: remove the override so other tests get the default store
    app_module.app.dependency_overrides.pop(app_module.get_event_store, None)


@pytest.fixture
def client(app_module, event_store):
    """FastAPI TestClient with a clean, injectable EventStore for each test."""
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)


@pytest.fixture
def client_bare(app_module):
    """FastAPI TestClient without any dependency override (uses default store)."""
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)


# ---------------------------------------------------------------------------
# POST /webhook — happy path for all supported event types
# ---------------------------------------------------------------------------


class TestWebhookRouteDispatchesSupportedEvents:
    """POST /webhook must return 200 and dispatch each supported X-GitHub-Event type."""

    @pytest.mark.parametrize("event_type", SUPPORTED_EVENTS)
    def test_supported_event_returns_200(self, client, event_type):
        """A valid payload for each supported event type must return HTTP 200."""
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "completed", "ref": "refs/heads/main"},
            headers={"X-GitHub-Event": event_type},
        )
        assert response.status_code == 200, (
            f"POST /webhook with X-GitHub-Event: {event_type} must return 200; "
            f"got {response.status_code}"
        )

    @pytest.mark.parametrize("event_type", SUPPORTED_EVENTS)
    def test_supported_event_response_is_json(self, client, event_type):
        """The webhook response body must be JSON for all supported event types."""
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "completed"},
            headers={"X-GitHub-Event": event_type},
        )
        assert "application/json" in response.headers.get("content-type", ""), (
            f"POST /webhook ({event_type}) must return JSON; "
            f"content-type: {response.headers.get('content-type')}"
        )

    @pytest.mark.parametrize("event_type", SUPPORTED_EVENTS)
    def test_supported_event_response_status_is_ok(self, client, event_type):
        """The JSON response body must contain status='ok' for dispatched events."""
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "completed"},
            headers={"X-GitHub-Event": event_type},
        )
        data = response.json()
        assert data.get("status") == "ok", (
            f"POST /webhook ({event_type}) response must include status='ok'; "
            f"got: {data!r}"
        )

    @pytest.mark.parametrize("event_type", SUPPORTED_EVENTS)
    def test_supported_event_is_recorded_in_store(self, client, event_store, event_type):
        """Dispatching a supported event must result in a store entry being created."""
        client.post(
            WEBHOOK_PATH,
            json={"action": "completed", "ref": "refs/heads/main"},
            headers={"X-GitHub-Event": event_type},
        )
        assert event_store.count() >= 1, (
            f"EventStore must record the '{event_type}' event after dispatch; "
            f"store is still empty"
        )

    def test_push_event_is_recorded_with_correct_type(self, client, event_store):
        """A dispatched 'push' event must appear in the store with type='push'."""
        client.post(
            WEBHOOK_PATH,
            json={"ref": "refs/heads/main", "commits": []},
            headers={"X-GitHub-Event": "push"},
        )
        records = event_store.all()
        assert any(r["type"] == "push" for r in records), (
            f"Store must contain a 'push' record; records: {records!r}"
        )

    def test_deployment_event_is_recorded_with_correct_type(self, client, event_store):
        """A dispatched 'deployment' event must appear in the store with type='deployment'."""
        client.post(
            WEBHOOK_PATH,
            json={"deployment": {"id": 42, "environment": "production"}},
            headers={"X-GitHub-Event": "deployment"},
        )
        records = event_store.all()
        assert any(r["type"] == "deployment" for r in records), (
            f"Store must contain a 'deployment' record; records: {records!r}"
        )

    def test_deployment_status_event_is_recorded_with_correct_type(
        self, client, event_store
    ):
        """'deployment_status' must be recorded — it carries outcome state (success/failure)."""
        client.post(
            WEBHOOK_PATH,
            json={"deployment_status": {"state": "success"}, "deployment": {"id": 42}},
            headers={"X-GitHub-Event": "deployment_status"},
        )
        records = event_store.all()
        assert any(r["type"] == "deployment_status" for r in records)

    def test_workflow_run_event_is_recorded_with_correct_type(self, client, event_store):
        """'workflow_run' must be recorded — it links CI runs to deployment status."""
        client.post(
            WEBHOOK_PATH,
            json={"workflow_run": {"id": 1234, "conclusion": "success"}},
            headers={"X-GitHub-Event": "workflow_run"},
        )
        records = event_store.all()
        assert any(r["type"] == "workflow_run" for r in records)


# ---------------------------------------------------------------------------
# POST /webhook — unsupported event types: 200 + DEBUG log, not 4xx
# ---------------------------------------------------------------------------


class TestWebhookRouteHandlesUnsupportedEvents:
    """POST /webhook with an unrecognised X-GitHub-Event header must return 200."""

    @pytest.mark.parametrize(
        "event_type",
        ["check_run", "check_suite", "gollum", "member", "star", "fork"],
    )
    def test_unsupported_event_returns_200_not_4xx(self, client, event_type):
        """Unrecognised GitHub event types must return 200, never 4xx.

        GitHub retries webhook deliveries that receive non-2xx responses.
        Returning 400 or 404 for unsupported events would cause infinite
        retry loops and unnecessary load on both sides.
        """
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "created"},
            headers={"X-GitHub-Event": event_type},
        )
        assert response.status_code == 200, (
            f"POST /webhook with unsupported event '{event_type}' must return 200; "
            f"got {response.status_code}"
        )

    @pytest.mark.parametrize(
        "event_type",
        ["check_run", "check_suite", "gollum"],
    )
    def test_unsupported_event_response_body_indicates_not_dispatched(
        self, client, event_type
    ):
        """Unsupported event response must distinguish handled vs. ignored events."""
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "created"},
            headers={"X-GitHub-Event": event_type},
        )
        data = response.json()
        assert data.get("dispatched") is False, (
            f"Unsupported event '{event_type}' response must include dispatched=False; "
            f"got: {data!r}"
        )

    def test_unsupported_event_logs_at_debug_level(self, client, caplog):
        """Unsupported event types must be logged at DEBUG, not WARNING/ERROR.

        Operators rely on WARNING logs to signal actionable misconfigurations.
        Unsupported event types are not misconfigurations — GitHub sends many
        event types that not every consumer needs to handle.
        """
        with caplog.at_level(logging.DEBUG):
            client.post(
                WEBHOOK_PATH,
                json={"action": "created"},
                headers={"X-GitHub-Event": "gollum"},
            )

        debug_records = [r for r in caplog.records if r.levelno == logging.DEBUG]
        assert any("gollum" in r.message for r in debug_records), (
            "Unsupported event type must be mentioned in a DEBUG log record"
        )

    def test_unsupported_event_produces_no_warning_or_error(self, client, caplog):
        """Unsupported events must not escalate to WARNING or ERROR log levels."""
        with caplog.at_level(logging.DEBUG):
            client.post(
                WEBHOOK_PATH,
                json={"action": "created"},
                headers={"X-GitHub-Event": "totally_unknown_event"},
            )

        high_level = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert not high_level, (
            f"Unsupported event type must not generate WARNING or higher logs; "
            f"found: {[r.message for r in high_level]}"
        )


# ---------------------------------------------------------------------------
# POST /webhook — missing X-GitHub-Event header
# ---------------------------------------------------------------------------


class TestWebhookRouteMissingEventHeader:
    """POST /webhook without X-GitHub-Event header must return 400 with a clear error."""

    def test_missing_event_header_returns_400(self, client):
        """A webhook delivery missing the required X-GitHub-Event header returns 400.

        Unlike unsupported event types (which return 200), a completely absent
        header is a malformed request — GitHub always sets this header.
        """
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "completed"},
        )
        assert response.status_code == 400, (
            f"POST /webhook without X-GitHub-Event header must return 400; "
            f"got {response.status_code}"
        )

    def test_missing_event_header_response_is_json(self, client):
        """The 400 response for missing X-GitHub-Event must be JSON."""
        response = client.post(WEBHOOK_PATH, json={})
        assert "application/json" in response.headers.get("content-type", "")

    def test_missing_event_header_response_contains_error_field(self, client):
        """The 400 body must contain a non-empty 'detail' or 'error' field."""
        response = client.post(WEBHOOK_PATH, json={})
        data = response.json()
        has_error = "detail" in data or "error" in data
        assert has_error, (
            f"400 response must contain a 'detail' or 'error' field; got: {data!r}"
        )

    def test_empty_event_header_returns_400(self, client):
        """An empty X-GitHub-Event header value is equivalent to absent."""
        response = client.post(
            WEBHOOK_PATH,
            json={"action": "completed"},
            headers={"X-GitHub-Event": ""},
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# GET /healthz — always 200 JSON {status: ok}
# ---------------------------------------------------------------------------


class TestHealthzRoute:
    """GET /healthz must respond with 200 JSON {status: ok} unconditionally."""

    def test_healthz_returns_200(self, client_bare):
        """Health endpoint must return HTTP 200."""
        response = client_bare.get(HEALTHZ_PATH)
        assert response.status_code == 200

    def test_healthz_response_is_json(self, client_bare):
        """Health endpoint response must be JSON."""
        response = client_bare.get(HEALTHZ_PATH)
        assert "application/json" in response.headers.get("content-type", "")

    def test_healthz_response_contains_status_ok(self, client_bare):
        """Health endpoint JSON body must contain exactly {status: ok}."""
        response = client_bare.get(HEALTHZ_PATH)
        data = response.json()
        assert data.get("status") == "ok", (
            f"GET /healthz must return {{\"status\": \"ok\"}}; got: {data!r}"
        )

    def test_healthz_returns_200_regardless_of_authorization_header(self, client_bare):
        """Health probes must not require authentication — Kubernetes sends no auth."""
        response = client_bare.get(
            HEALTHZ_PATH,
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 200

    def test_healthz_is_accessible_when_store_is_empty(self, client):
        """Health check must succeed even when no events have been processed."""
        response = client.get(HEALTHZ_PATH)
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# GET /metrics — Prometheus text format
# ---------------------------------------------------------------------------


class TestMetricsRoute:
    """GET /metrics must return Prometheus exposition format (text/plain)."""

    def test_metrics_returns_200(self, client_bare):
        """Prometheus scrape endpoint must return HTTP 200."""
        response = client_bare.get(METRICS_PATH)
        assert response.status_code == 200

    def test_metrics_content_type_is_prometheus_text(self, client_bare):
        """Prometheus requires the text/plain content-type to parse the response.

        The prometheus_client library uses 'text/plain; version=0.0.4; charset=utf-8'
        as its CONTENT_TYPE_LATEST.  The response must include 'text/plain'.
        """
        response = client_bare.get(METRICS_PATH)
        content_type = response.headers.get("content-type", "")
        assert "text/plain" in content_type, (
            f"GET /metrics must return text/plain content-type; got: {content_type!r}"
        )

    def test_metrics_response_body_is_not_empty(self, client_bare):
        """Prometheus scrape must return non-empty content — an empty body is invalid."""
        response = client_bare.get(METRICS_PATH)
        assert response.content.strip(), "GET /metrics response body must not be empty"

    def test_metrics_response_contains_prometheus_exposition(self, client_bare):
        """The /metrics body must contain valid Prometheus exposition format lines.

        A well-formed Prometheus response begins with '# HELP' or '# TYPE' comment
        lines before each metric family.  Absence of these indicates the response
        is not proper Prometheus exposition format.
        """
        response = client_bare.get(METRICS_PATH)
        body = response.text
        has_prometheus_comments = "# HELP" in body or "# TYPE" in body
        assert has_prometheus_comments, (
            "GET /metrics body must contain Prometheus '# HELP' or '# TYPE' lines; "
            "the endpoint may not be returning prometheus_client output"
        )

    def test_metrics_response_does_not_require_authentication(self, client_bare):
        """GET /metrics must be accessible without an Authorization header.

        Unlike the previous Flask implementation, the new FastAPI app must not
        gate /metrics behind bearer token auth — Prometheus scrape configs
        for this service do not include auth headers in the acceptance criteria.
        """
        response = client_bare.get(METRICS_PATH)
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Dependency injection — event store overridable per-test
# ---------------------------------------------------------------------------


class TestDependencyInjection:
    """FastAPI dependency_overrides must allow the EventStore to be replaced per-test."""

    def test_injected_store_receives_dispatched_events(self, client, event_store):
        """Events dispatched via POST /webhook must land in the injected store."""
        assert event_store.count() == 0  # Verify isolation — store starts empty

        client.post(
            WEBHOOK_PATH,
            json={"ref": "refs/heads/main"},
            headers={"X-GitHub-Event": "push"},
        )

        assert event_store.count() == 1, (
            "The injected EventStore must receive the dispatched 'push' event"
        )

    def test_two_consecutive_events_accumulate_in_injected_store(
        self, client, event_store
    ):
        """Multiple dispatches within the same test must accumulate in the store."""
        client.post(
            WEBHOOK_PATH,
            json={"ref": "refs/heads/main"},
            headers={"X-GitHub-Event": "push"},
        )
        client.post(
            WEBHOOK_PATH,
            json={"deployment": {"id": 1}},
            headers={"X-GitHub-Event": "deployment"},
        )

        assert event_store.count() == 2

    def test_each_test_gets_a_fresh_store_via_fixture(self, client, event_store):
        """The event_store fixture must provide an isolated store per test.

        This test verifies fixture teardown — the store must start empty,
        proving the previous test's events did not bleed through.
        """
        assert event_store.count() == 0, (
            "Each test must receive a fresh, empty EventStore — "
            "events from previous tests must not persist"
        )

    def test_get_event_store_is_a_callable_dependency(self, app_module):
        """get_event_store must be callable so FastAPI can resolve it as a dependency."""
        assert callable(app_module.get_event_store), (
            "get_event_store must be a callable that FastAPI can use as a dependency"
        )

    def test_app_dependency_overrides_is_supported(self, app_module):
        """app.dependency_overrides must be accessible for test-time DI injection."""
        assert hasattr(app_module.app, "dependency_overrides"), (
            "The FastAPI app must expose dependency_overrides for test injection"
        )


# ---------------------------------------------------------------------------
# FastAPI app — importable without starting the server
# ---------------------------------------------------------------------------


class TestAppImportability:
    """The FastAPI app must be importable without starting the HTTP server."""

    def test_app_attribute_is_present(self, app_module):
        """main.app must be a FastAPI application object."""
        from fastapi import FastAPI

        assert isinstance(app_module.app, FastAPI), (
            "main.app must be a FastAPI instance; "
            f"got {type(app_module.app)}"
        )

    def test_import_does_not_bind_to_port(self, app_module):
        """Importing main must not open any network socket.

        uvicorn.run() or any equivalent server start must only be called inside
        the ``if __name__ == '__main__':`` guard, never at module import time.
        """
        import socket

        # A crude but reliable check: bind to port 8000 immediately after import.
        # If the import already bound the port, this will raise OSError.
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", int(os.environ.get("PORT", 8000))))
            s.close()
        except OSError as exc:
            pytest.fail(
                f"main.py appears to bind to the port at import time — "
                f"the server must only start inside `if __name__ == '__main__'`: {exc}"
            )

    def test_get_event_store_is_exported(self, app_module):
        """main.get_event_store must be importable as the FastAPI dependency provider."""
        assert hasattr(app_module, "get_event_store"), (
            "main module must export get_event_store for DI override in tests"
        )

    def test_event_store_class_is_exported(self, app_module):
        """main.EventStore must be importable so tests can instantiate fresh stores."""
        assert hasattr(app_module, "EventStore"), (
            "main module must export EventStore for test fixture construction"
        )

    def test_supported_events_constant_is_exported(self, app_module):
        """main.SUPPORTED_EVENTS must be importable for parametrised test generation."""
        assert hasattr(app_module, "SUPPORTED_EVENTS"), (
            "main module must export SUPPORTED_EVENTS (set or mapping) "
            "so test suites can parametrise against the canonical event list"
        )
