"""Integration tests for the metrics Docker Compose stack.

Spins up the full docker-compose stack and validates the complete flow:

  1. ``docker compose up -d`` starts all services without error.
  2. ``GET /healthz`` returns HTTP 200 within a 60-second timeout.
  3. ``POST /webhook`` with a valid HMAC-SHA256 signature returns 2xx.
  4. The push event is persisted — a row exists in ``push_events`` in PostgreSQL.
  5. ``docker compose down -v`` tears down cleanly.

These tests are **skipped by default** to keep the standard pytest run fast.
Enable them with::

    RUN_COMPOSE_INTEGRATION_TESTS=1 pytest metrics/tests/test_compose_integration.py -v

Prerequisites:
  - Docker Engine and the Compose v2 plugin (``docker compose``) must be available.
  - Ports 8000 and 5432 must be free on the host.
  - ``WEBHOOK_SECRET`` env var must be set (or a default is used for CI).

All tests in this module share a single session-scoped fixture that starts the
stack once and tears it down at the end, so the order matters:

  health → webhook → database assertion

The module exits early (all tests skipped) if ``RUN_COMPOSE_INTEGRATION_TESTS``
is not ``"1"``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Generator

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

METRICS_DIR = Path(__file__).parent.parent
COMPOSE_FILE = METRICS_DIR / "docker-compose.yml"

HEALTHZ_URL = "http://localhost:8000/healthz"
WEBHOOK_URL = "http://localhost:8000/webhook"
POSTGRES_DSN = "postgresql://gitweave:gitweave@localhost:5432/gitweave"

# Use a fixed test secret; the compose stack must wire this via WEBHOOK_SECRET env var.
INTEGRATION_WEBHOOK_SECRET = os.environ.get(
    "WEBHOOK_SECRET", "integration-test-webhook-secret!!"
)

HEALTH_POLL_INTERVAL_S = 2
HEALTH_TIMEOUT_S = 90  # generous — init container + postgres startup can be slow


# ---------------------------------------------------------------------------
# Skip guard — this module must not run in the default ``pytest`` invocation
# ---------------------------------------------------------------------------


def _require_integration_tests() -> None:
    """Skip all tests in this module unless RUN_COMPOSE_INTEGRATION_TESTS=1."""
    if os.environ.get("RUN_COMPOSE_INTEGRATION_TESTS") != "1":
        pytest.skip(
            "Integration tests disabled. "
            "Set RUN_COMPOSE_INTEGRATION_TESTS=1 to enable. "
            "Requires Docker, free ports 8000 and 5432.",
            allow_module_level=True,
        )


_require_integration_tests()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_hmac(body: bytes, secret: str) -> str:
    """Return the GitHub-style HMAC-SHA256 signature for ``body``."""
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


def _compose(*args: str, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """Run ``docker compose`` in the metrics directory and return the result."""
    merged_env = {**os.environ}
    if env:
        merged_env.update(env)
    # Ensure the webhook secret is forwarded to compose so services can pick it up
    merged_env.setdefault("WEBHOOK_SECRET", INTEGRATION_WEBHOOK_SECRET)

    return subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), *args],
        cwd=str(METRICS_DIR),
        env=merged_env,
        capture_output=True,
        text=True,
        check=check,
    )


def _poll_healthz(timeout_s: int = HEALTH_TIMEOUT_S, interval_s: int = HEALTH_POLL_INTERVAL_S) -> bool:
    """Poll GET /healthz until it returns 200 or ``timeout_s`` elapses.

    Returns True if healthy within the timeout, False otherwise.
    Requires the ``requests`` package (listed in requirements.txt).
    """
    import requests  # local import — only needed for integration tests

    deadline = time.monotonic() + timeout_s
    last_exc: Exception | None = None
    while time.monotonic() < deadline:
        try:
            resp = requests.get(HEALTHZ_URL, timeout=5)
            if resp.status_code == 200:
                return True
        except requests.exceptions.ConnectionError as exc:
            last_exc = exc
        time.sleep(interval_s)

    if last_exc:
        pytest.fail(
            f"GET {HEALTHZ_URL} did not return 200 within {timeout_s}s. "
            f"Last error: {last_exc!r}. "
            "Check 'docker compose logs' for service startup errors."
        )
    return False


# ---------------------------------------------------------------------------
# Session-scoped fixture — start/stop the compose stack once per test session
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def compose_stack() -> Generator[None, None, None]:
    """Start the compose stack before tests and tear it down afterwards.

    Uses module scope so the (slow) startup happens once per file, and all
    tests in this module share the same running stack.
    """
    # Ensure there is no stale stack from a previous failed run
    _compose("down", "-v", "--remove-orphans", check=False)

    try:
        result = _compose("up", "-d", "--build")
    except subprocess.CalledProcessError as exc:
        pytest.fail(
            f"'docker compose up -d --build' failed:\n"
            f"STDOUT:\n{exc.stdout}\n"
            f"STDERR:\n{exc.stderr}\n"
            "Ensure a Dockerfile exists in metrics/ and docker-compose.yml is valid."
        )

    yield

    # Teardown: bring the stack down and remove volumes to leave a clean state
    _compose("down", "-v", "--remove-orphans", check=False)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """The metrics service must become healthy within the configured timeout."""

    def test_healthz_returns_200_after_startup(self, compose_stack):
        """GET /healthz must return HTTP 200 once the metrics service is ready.

        The service is considered ready only after:
          1. postgres is healthy (pg_isready passes)
          2. alembic migrate init container has completed successfully
          3. the metrics FastAPI app has bound to port 8000

        Polling with a 90-second timeout accounts for image pull + postgres
        initialization + migration execution on a cold start.
        """
        is_healthy = _poll_healthz()
        assert is_healthy, (
            f"GET {HEALTHZ_URL} did not return 200 within {HEALTH_TIMEOUT_S}s. "
            "Run 'docker compose logs metrics' for details."
        )

    def test_healthz_response_body_contains_ok_status(self, compose_stack):
        """The /healthz response body must contain a JSON 'status': 'ok' field."""
        import requests

        resp = requests.get(HEALTHZ_URL, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

        body = resp.json()
        assert body.get("status") == "ok", (
            f"/healthz response body must be {{\"status\": \"ok\"}}; got: {body!r}"
        )


# ---------------------------------------------------------------------------
# Webhook endpoint — HMAC-signed request
# ---------------------------------------------------------------------------

# Minimal valid GitHub push webhook payload (required fields for push handler)
_PUSH_PAYLOAD = {
    "ref": "refs/heads/main",
    "repository": {
        "full_name": "gitweave-org/integration-test-repo",
    },
    "commits": [
        {
            "id": "aabbccdd11223344556677889900aabbccdd1122",
            "message": "chore: integration test commit",
            "timestamp": "2026-04-06T10:00:00Z",
        }
    ],
}


class TestWebhookEndpoint:
    """POST /webhook must accept HMAC-signed push events and return 2xx."""

    def test_push_webhook_with_valid_hmac_returns_2xx(self, compose_stack):
        """A push webhook signed with the correct HMAC-SHA256 key is accepted.

        GitHub always sends X-Hub-Signature-256 on webhook deliveries.
        The service must verify the signature using WEBHOOK_SECRET and return
        2xx for a correctly-signed request.

        This test uses the INTEGRATION_WEBHOOK_SECRET that is passed to the
        compose stack via the WEBHOOK_SECRET environment variable.
        """
        import requests

        # Ensure the service is up before testing the webhook
        _poll_healthz()

        body = json.dumps(_PUSH_PAYLOAD).encode("utf-8")
        sig = _compute_hmac(body, INTEGRATION_WEBHOOK_SECRET)

        resp = requests.post(
            WEBHOOK_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": sig,
            },
            timeout=10,
        )

        assert resp.status_code < 400, (
            f"POST {WEBHOOK_URL} returned {resp.status_code} for a validly-signed "
            f"push webhook.\n"
            f"Response body: {resp.text!r}\n"
            "Check that WEBHOOK_SECRET is correctly wired in docker-compose.yml and "
            "that the metrics service verifies X-Hub-Signature-256."
        )

    def test_push_webhook_with_invalid_hmac_returns_401(self, compose_stack):
        """A push webhook signed with a wrong key must be rejected with HTTP 401.

        This validates that HMAC verification is actually enforced — not just
        declared but bypassed.
        """
        import requests

        _poll_healthz()

        body = json.dumps(_PUSH_PAYLOAD).encode("utf-8")
        tampered_sig = "sha256=000000000000000000000000000000000000000000000000000000000000dead"

        resp = requests.post(
            WEBHOOK_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": tampered_sig,
            },
            timeout=10,
        )

        assert resp.status_code == 401, (
            f"POST {WEBHOOK_URL} with an invalid HMAC must return 401 Unauthorized; "
            f"got {resp.status_code}.\n"
            f"Response body: {resp.text!r}\n"
            "Ensure the metrics service enforces X-Hub-Signature-256 verification."
        )


# ---------------------------------------------------------------------------
# Database persistence — event row exists after webhook
# ---------------------------------------------------------------------------


class TestDatabasePersistence:
    """A push webhook must produce a row in the push_events PostgreSQL table."""

    def _connect(self):
        """Return a psycopg2 connection to the compose postgres instance."""
        try:
            import psycopg2  # noqa: PLC0415
        except ImportError:
            pytest.skip(
                "psycopg2 not installed — install psycopg2-binary to run DB assertions. "
                "pip install psycopg2-binary"
            )
        return psycopg2.connect(POSTGRES_DSN)

    def test_push_event_row_exists_in_postgres_after_webhook(self, compose_stack):
        """After a valid push webhook, a row must appear in the push_events table.

        This is the end-to-end persistence assertion:
          webhook received → push handler invoked → PostgreSQLEventStore.store_event()
          → INSERT into push_events → row queryable via direct DB connection.

        The test re-uses the payload from TestWebhookEndpoint to avoid sending
        a second webhook and complicating isolation. The ordering within the
        module fixture means this test always runs after the webhook test.
        """
        import requests

        # Ensure service is up and send the webhook (idempotent — row may already exist)
        _poll_healthz()

        body = json.dumps(_PUSH_PAYLOAD).encode("utf-8")
        sig = _compute_hmac(body, INTEGRATION_WEBHOOK_SECRET)
        requests.post(
            WEBHOOK_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": sig,
            },
            timeout=10,
        )

        # Give the service a moment to complete the async insert
        time.sleep(1)

        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, repo, ref FROM push_events WHERE repo = %s LIMIT 1",
                    ("gitweave-org/integration-test-repo",),
                )
                row = cur.fetchone()
        finally:
            conn.close()

        assert row is not None, (
            "No row found in push_events for 'gitweave-org/integration-test-repo' "
            "after posting a valid push webhook. "
            "Ensure the metrics service routes push events to PostgreSQLEventStore "
            "and that alembic migrations created the push_events table."
        )

        _id, repo, ref = row
        assert repo == "gitweave-org/integration-test-repo", (
            f"push_events.repo mismatch: expected 'gitweave-org/integration-test-repo', "
            f"got {repo!r}"
        )
        assert ref == "refs/heads/main", (
            f"push_events.ref mismatch: expected 'refs/heads/main', got {ref!r}"
        )

    def test_alembic_migrations_created_push_events_table(self, compose_stack):
        """The push_events table must exist — proof that alembic upgrade head ran.

        If the migrate init container did not run or failed silently, this table
        would not exist and all persistence tests would fail with a cryptic
        ``relation "push_events" does not exist`` error rather than a clear
        migration-failure message.
        """
        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name IN ('push_events', 'pr_events', 'deployment_events')
                    ORDER BY table_name
                    """
                )
                tables = {row[0] for row in cur.fetchall()}
        finally:
            conn.close()

        expected = {"push_events", "pr_events", "deployment_events"}
        assert tables == expected, (
            f"Expected alembic migrations to create tables {expected}; "
            f"found: {tables!r}. "
            "Check that the migrate init container ran 'alembic upgrade head' "
            "before the metrics service started."
        )
