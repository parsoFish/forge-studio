import sys
import os
import hashlib
import hmac
import json
import logging

import pytest

# Add src to path so we can import webhook module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

TEST_SECRET = "test-integration-secret-secure!!"
WEBHOOK_PATH = "/webhook"


def _compute_signature(body: bytes, secret: str) -> str:
    """Compute the expected HMAC-SHA256 signature for test requests."""
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(monkeypatch):
    """Flask app with WEBHOOK_SECRET set."""
    monkeypatch.setenv("WEBHOOK_SECRET", TEST_SECRET)
    from webhook import create_app

    flask_app = create_app()
    flask_app.config["TESTING"] = True
    # Ensure Flask's internal logger propagates to pytest's caplog handler
    flask_app.logger.propagate = True
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def app_no_secret(monkeypatch):
    """Flask app with WEBHOOK_SECRET absent from the environment."""
    monkeypatch.delenv("WEBHOOK_SECRET", raising=False)
    from webhook import create_app

    flask_app = create_app()
    flask_app.config["TESTING"] = True
    flask_app.logger.propagate = True
    return flask_app


@pytest.fixture
def client_no_secret(app_no_secret):
    return app_no_secret.test_client()


# ---------------------------------------------------------------------------
# Happy path — valid signatures pass the gate
# ---------------------------------------------------------------------------


class TestWebhookWithValidSignature:
    def test_valid_signature_is_not_rejected(self, client):
        body = b'{"event": "deployment_status"}'
        sig = _compute_signature(body, TEST_SECRET)
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": sig,
                "Content-Type": "application/json",
            },
        )
        assert response.status_code != 401

    def test_empty_body_with_valid_signature_is_not_rejected(self, client):
        body = b""
        sig = _compute_signature(body, TEST_SECRET)
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": sig,
                "Content-Type": "application/json",
            },
        )
        assert response.status_code != 401


# ---------------------------------------------------------------------------
# Invalid signature — must return 401 with JSON error body
# ---------------------------------------------------------------------------


class TestWebhookWithInvalidSignature:
    def test_invalid_signature_returns_401(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": "sha256=deadbeef",
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 401

    def test_invalid_signature_response_is_json(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": "sha256=deadbeef",
                "Content-Type": "application/json",
            },
        )
        assert "application/json" in response.content_type

    def test_invalid_signature_response_contains_non_empty_error_field(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": "sha256=deadbeef",
                "Content-Type": "application/json",
            },
        )
        data = json.loads(response.data)
        assert "error" in data
        assert data["error"]  # must be a non-empty string, not null/empty

    def test_tampered_body_returns_401(self, client):
        original_body = b'{"event": "deployment_status"}'
        valid_sig = _compute_signature(original_body, TEST_SECRET)
        tampered_body = b'{"event": "push", "injected": true}'
        response = client.post(
            WEBHOOK_PATH,
            data=tampered_body,
            headers={
                "X-Hub-Signature-256": valid_sig,
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Missing signature header — must return 401 with JSON error body
# ---------------------------------------------------------------------------


class TestWebhookWithMissingSignatureHeader:
    def test_missing_signature_header_returns_401(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 401

    def test_missing_signature_header_response_is_json(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        assert "application/json" in response.content_type

    def test_missing_signature_header_response_contains_error_field(self, client):
        body = b'{"event": "deployment_status"}'
        response = client.post(
            WEBHOOK_PATH,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        data = json.loads(response.data)
        assert "error" in data
        assert data["error"]


# ---------------------------------------------------------------------------
# Missing WEBHOOK_SECRET — startup warning + reject all requests
# ---------------------------------------------------------------------------


class TestWebhookWithMissingSecret:
    def test_missing_webhook_secret_rejects_all_requests_with_401(self, client_no_secret):
        body = b'{"event": "deployment_status"}'
        # Even a cryptographically valid signature must be rejected — we have no
        # reference secret to compare against, so verification cannot succeed.
        sig = _compute_signature(body, "any-secret")
        response = client_no_secret.post(
            WEBHOOK_PATH,
            data=body,
            headers={
                "X-Hub-Signature-256": sig,
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 401

    def test_missing_webhook_secret_logs_warning_at_startup(self, monkeypatch, caplog):
        """Operators must be warned at startup when the secret is not configured."""
        monkeypatch.delenv("WEBHOOK_SECRET", raising=False)
        with caplog.at_level(logging.WARNING):
            from webhook import create_app

            create_app()
        warning_messages = [r.message for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("WEBHOOK_SECRET" in msg for msg in warning_messages), (
            "A WARNING log mentioning WEBHOOK_SECRET must be emitted when the env var is absent"
        )


# ---------------------------------------------------------------------------
# Rejection logging — WARN level, never leaks secret or raw body
# ---------------------------------------------------------------------------


class TestWebhookRejectionLogging:
    def test_rejection_is_logged_at_warn_level_or_higher(self, client, caplog):
        body = b'{"event": "deployment_status"}'
        with caplog.at_level(logging.WARNING):
            client.post(
                WEBHOOK_PATH,
                data=body,
                headers={
                    "X-Hub-Signature-256": "sha256=deadbeef",
                    "Content-Type": "application/json",
                },
            )
        assert any(r.levelno >= logging.WARNING for r in caplog.records), (
            "Signature rejection must produce at least one WARNING (or higher) log record"
        )

    def test_rejection_log_never_contains_the_secret(self, client, caplog):
        body = b'{"event": "deployment_status"}'
        with caplog.at_level(logging.DEBUG):
            client.post(
                WEBHOOK_PATH,
                data=body,
                headers={
                    "X-Hub-Signature-256": "sha256=deadbeef",
                    "Content-Type": "application/json",
                },
            )
        for record in caplog.records:
            assert TEST_SECRET not in record.message, (
                f"Webhook secret must never appear in log output; found in: {record.message!r}"
            )

    def test_rejection_log_never_contains_raw_body(self, client, caplog):
        # Use a distinctive payload so any accidental logging is detectable
        body = b'{"event": "deployment_status", "sensitive_field": "DO_NOT_LOG_ME"}'
        with caplog.at_level(logging.DEBUG):
            client.post(
                WEBHOOK_PATH,
                data=body,
                headers={
                    "X-Hub-Signature-256": "sha256=deadbeef",
                    "Content-Type": "application/json",
                },
            )
        raw_body_str = body.decode("utf-8")
        for record in caplog.records:
            assert raw_body_str not in record.message, (
                "Raw request body must never appear in log output"
            )
