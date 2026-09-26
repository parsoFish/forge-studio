"""Integration tests for bearer token authentication on the /metrics endpoint.

Tests exercise the Flask test client against the full request/response cycle,
following the same pattern as ``test_webhook_endpoint.py``.  They are written
BEFORE the implementation exists and are expected to FAIL until
``metrics/src/metrics_app.py`` is created.

Coverage plan
-------------
* GET /metrics — happy path with valid token
* GET /metrics — rejected: missing header, empty header, wrong scheme, wrong token
* GET /metrics — rejected: METRICS_AUTH_TOKEN not configured
* GET /healthz — always 200, no auth required
* Rejection logging — WARNING level, never leaks configured or request token
"""

import logging
import os
import sys

import pytest

# Add src to path so we can import the metrics app module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

TEST_TOKEN = "test-prometheus-token-secure!!"
METRICS_PATH = "/metrics"
HEALTHZ_PATH = "/healthz"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(monkeypatch):
    """Flask app with METRICS_AUTH_TOKEN configured."""
    monkeypatch.setenv("METRICS_AUTH_TOKEN", TEST_TOKEN)
    from metrics_app import create_app

    flask_app = create_app()
    flask_app.config["TESTING"] = True
    # Ensure Flask's internal logger propagates to pytest's caplog handler
    flask_app.logger.propagate = True
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def app_no_token(monkeypatch):
    """Flask app with METRICS_AUTH_TOKEN absent from the environment."""
    monkeypatch.delenv("METRICS_AUTH_TOKEN", raising=False)
    from metrics_app import create_app

    flask_app = create_app()
    flask_app.config["TESTING"] = True
    flask_app.logger.propagate = True
    return flask_app


@pytest.fixture
def client_no_token(app_no_token):
    return app_no_token.test_client()


# ---------------------------------------------------------------------------
# Happy path — valid bearer token grants access to /metrics
# ---------------------------------------------------------------------------


class TestMetricsWithValidToken:
    """GET /metrics with a correct Authorization: Bearer <token> header must succeed."""

    def test_valid_bearer_token_returns_200(self, client):
        """Prometheus scraper presenting the correct configured token receives metrics."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert response.status_code == 200

    def test_valid_token_response_body_is_not_empty(self, client):
        """The metrics response must contain actual Prometheus exposition content."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert response.data.strip(), "Metrics response body must not be empty"


# ---------------------------------------------------------------------------
# Missing Authorization header — must return 403 with plain text body
# ---------------------------------------------------------------------------


class TestMetricsWithMissingAuthHeader:
    """GET /metrics with no Authorization header must be rejected with HTTP 403."""

    def test_missing_auth_header_returns_403(self, client):
        """Unauthenticated Prometheus scrape must be denied — not silently ignored."""
        response = client.get(METRICS_PATH)
        assert response.status_code == 403

    def test_missing_auth_header_response_is_plain_text(self, client):
        """Rejection response must be plain text, not JSON or HTML.

        Prometheus expects plain text; a JSON body with an 'error' key is an
        implementation detail of the webhook service, not appropriate here.
        """
        response = client.get(METRICS_PATH)
        assert "text/plain" in response.content_type

    def test_missing_auth_header_response_body_is_not_empty(self, client):
        """The 403 body must contain a human-readable error description."""
        response = client.get(METRICS_PATH)
        assert response.data.strip(), "403 response body must not be empty"


# ---------------------------------------------------------------------------
# Empty / structurally invalid Authorization header — must return 403
# ---------------------------------------------------------------------------


class TestMetricsWithMalformedAuthHeader:
    """GET /metrics with a structurally invalid Authorization header must return 403."""

    def test_empty_authorization_header_returns_403(self, client):
        """An empty header value provides no credentials."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": ""},
        )
        assert response.status_code == 403

    def test_non_bearer_scheme_basic_returns_403(self, client):
        """Basic auth credentials are not an accepted scheme for /metrics."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
        )
        assert response.status_code == 403

    def test_non_bearer_scheme_token_returns_403(self, client):
        """'Token <value>' scheme must not be accepted — only Bearer is supported."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": f"Token {TEST_TOKEN}"},
        )
        assert response.status_code == 403

    def test_bearer_keyword_only_returns_403(self, client):
        """'Bearer' with no following token value must be rejected."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": "Bearer"},
        )
        assert response.status_code == 403

    def test_bearer_with_trailing_whitespace_only_returns_403(self, client):
        """'Bearer ' followed by only whitespace provides no usable token."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": "Bearer   "},
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Wrong token — must return 403
# ---------------------------------------------------------------------------


class TestMetricsWithWrongToken:
    """GET /metrics presenting an incorrect bearer token must return 403."""

    def test_wrong_bearer_token_returns_403(self, client):
        """A token that does not match METRICS_AUTH_TOKEN must be denied."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": "Bearer totally-wrong-token"},
        )
        assert response.status_code == 403

    def test_wrong_token_response_is_plain_text(self, client):
        """Wrong-token rejection must return plain text, matching the missing-header case."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert "text/plain" in response.content_type

    def test_partial_token_match_returns_403(self, client):
        """A prefix of the real token must not be accepted — exact match is required."""
        partial = TEST_TOKEN[: len(TEST_TOKEN) // 2]
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": f"Bearer {partial}"},
        )
        assert response.status_code == 403

    def test_token_with_extra_characters_appended_returns_403(self, client):
        """Appending extra characters to a valid token must still cause rejection."""
        response = client.get(
            METRICS_PATH,
            headers={"Authorization": f"Bearer {TEST_TOKEN}extra"},
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Missing METRICS_AUTH_TOKEN env var — startup warning + reject all requests
# ---------------------------------------------------------------------------


class TestMetricsWithMissingEnvToken:
    """When METRICS_AUTH_TOKEN is absent at startup, all /metrics requests return 403."""

    def test_missing_env_token_rejects_even_previously_valid_header(self, client_no_token):
        """No request, however well-formed, can succeed without a configured token.

        The server cannot verify any token if it has none to compare against,
        so the only safe behaviour is to reject all /metrics requests.
        """
        response = client_no_token.get(
            METRICS_PATH,
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert response.status_code == 403

    def test_missing_env_token_rejects_unauthenticated_request_too(self, client_no_token):
        """Unauthenticated request also returns 403 when no token is configured."""
        response = client_no_token.get(METRICS_PATH)
        assert response.status_code == 403

    def test_missing_env_token_logs_warning_at_startup(self, monkeypatch, caplog):
        """Operators must be warned at startup when METRICS_AUTH_TOKEN is not set.

        This mirrors the WEBHOOK_SECRET startup-warning behaviour and ensures
        misconfigured deployments are surfaced immediately in logs.
        """
        monkeypatch.delenv("METRICS_AUTH_TOKEN", raising=False)
        with caplog.at_level(logging.WARNING):
            from metrics_app import create_app

            create_app()
        warning_messages = [r.message for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("METRICS_AUTH_TOKEN" in msg for msg in warning_messages), (
            "A WARNING log mentioning METRICS_AUTH_TOKEN must be emitted at startup "
            "when the env var is absent"
        )


# ---------------------------------------------------------------------------
# /healthz is always accessible — no authentication required
# ---------------------------------------------------------------------------


class TestHealthzIsAlwaysAccessible:
    """/healthz must respond with 200 regardless of authentication state or header content."""

    def test_healthz_returns_200_with_no_auth_header(self, client):
        """Kubernetes liveness/readiness probe with no Authorization header must succeed."""
        response = client.get(HEALTHZ_PATH)
        assert response.status_code == 200

    def test_healthz_returns_200_with_correct_token(self, client):
        """A probe that happens to send a valid bearer token is also accepted."""
        response = client.get(
            HEALTHZ_PATH,
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert response.status_code == 200

    def test_healthz_returns_200_with_wrong_token(self, client):
        """Health probes must NOT require authentication — wrong token is irrelevant."""
        response = client.get(
            HEALTHZ_PATH,
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 200

    def test_healthz_returns_200_when_metrics_auth_token_not_configured(self, client_no_token):
        """Health probe must succeed even when the server is misconfigured.

        Kubernetes must always be able to determine pod liveness; blocking
        /healthz on misconfiguration would cause unnecessary pod restarts.
        """
        response = client_no_token.get(HEALTHZ_PATH)
        assert response.status_code == 200

    def test_healthz_response_body_is_not_empty(self, client):
        """Health check response must contain a non-empty body (e.g. 'ok')."""
        response = client.get(HEALTHZ_PATH)
        assert response.data.strip(), "/healthz response body must not be empty"


# ---------------------------------------------------------------------------
# Rejection logging — WARNING level, never leaks configured or request token
# ---------------------------------------------------------------------------


class TestMetricsRejectionLogging:
    """Auth rejections on /metrics must be logged at WARNING level without leaking tokens."""

    def test_rejection_is_logged_at_warn_level_or_higher(self, client, caplog):
        """A denied /metrics scrape must produce at least one WARNING log record."""
        with caplog.at_level(logging.WARNING):
            client.get(
                METRICS_PATH,
                headers={"Authorization": "Bearer wrong-token"},
            )
        assert any(r.levelno >= logging.WARNING for r in caplog.records), (
            "Bearer token rejection must produce at least one WARNING (or higher) log record"
        )

    def test_rejection_log_never_contains_the_configured_token(self, client, caplog):
        """The value of METRICS_AUTH_TOKEN must never appear in any log record.

        If the configured secret leaked into logs, it would be visible to anyone
        with log access and compromise all Prometheus scrapers using that token.
        """
        with caplog.at_level(logging.DEBUG):
            client.get(
                METRICS_PATH,
                headers={"Authorization": f"Bearer {TEST_TOKEN}"},
            )
        for record in caplog.records:
            assert TEST_TOKEN not in record.message, (
                f"METRICS_AUTH_TOKEN value must never appear in log output; "
                f"found in: {record.message!r}"
            )

    def test_rejection_log_never_contains_the_provided_wrong_token(self, client, caplog):
        """An attacker-supplied token value must not be echoed back in log output.

        Logging user-supplied input verbatim creates a log injection risk and
        could reveal attempted values to other log consumers.
        """
        wrong_token = "attacker-supplied-token-DO-NOT-LOG"
        with caplog.at_level(logging.DEBUG):
            client.get(
                METRICS_PATH,
                headers={"Authorization": f"Bearer {wrong_token}"},
            )
        for record in caplog.records:
            assert wrong_token not in record.message, (
                "Request-supplied bearer token value must not appear in log output"
            )

    def test_missing_auth_header_rejection_is_also_logged(self, client, caplog):
        """Unauthenticated (header-absent) scrapes must also be logged at WARNING."""
        with caplog.at_level(logging.WARNING):
            client.get(METRICS_PATH)
        assert any(r.levelno >= logging.WARNING for r in caplog.records), (
            "Missing-header rejection must also produce a WARNING log record"
        )
