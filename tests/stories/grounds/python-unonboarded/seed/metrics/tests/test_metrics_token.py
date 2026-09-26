"""Unit tests for bearer token extraction and verification logic.

These tests exercise the ``check_bearer_token`` pure function in isolation,
following the same pattern as ``test_webhook_signature.py``.  They are
written BEFORE the implementation exists and are expected to FAIL until
``metrics/src/metrics_app.py`` is created.
"""

import inspect
import sys
import os

import pytest

# Add src to path so we can import the metrics app module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

TEST_TOKEN = "test-prometheus-token-secure!!"


# ---------------------------------------------------------------------------
# Happy path — valid header + matching token is accepted
# ---------------------------------------------------------------------------


class TestCheckBearerTokenAcceptsValidCredentials:
    """check_bearer_token returns True when the header exactly matches the configured token."""

    def test_correct_bearer_token_is_accepted(self):
        """Well-formed 'Bearer <token>' matching the configured value must be accepted."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Bearer {TEST_TOKEN}", TEST_TOKEN) is True

    def test_token_with_special_characters_is_accepted(self):
        """Tokens containing hyphens, underscores, and dots must be accepted."""
        from metrics_app import check_bearer_token

        token = "my-secret.token_v2"
        assert check_bearer_token(f"Bearer {token}", token) is True

    def test_token_comparison_is_case_sensitive(self):
        """Token matching must be case-sensitive — 'TOKEN' != 'token'."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Bearer {TEST_TOKEN.upper()}", TEST_TOKEN) is False


# ---------------------------------------------------------------------------
# Missing or malformed header — must return False
# ---------------------------------------------------------------------------


class TestCheckBearerTokenRejectsMissingHeader:
    """check_bearer_token returns False when the Authorization header is absent or empty."""

    def test_none_auth_header_is_rejected(self):
        """No Authorization header — typical unauthenticated Prometheus scrape."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(None, TEST_TOKEN) is False

    def test_empty_string_auth_header_is_rejected(self):
        """An empty Authorization header value is equivalent to absent."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("", TEST_TOKEN) is False

    def test_whitespace_only_auth_header_is_rejected(self):
        """A whitespace-only header provides no credentials."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("   ", TEST_TOKEN) is False

    def test_bearer_keyword_only_no_token_is_rejected(self):
        """'Bearer' with no following token value must be rejected."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("Bearer", TEST_TOKEN) is False

    def test_bearer_with_trailing_space_only_is_rejected(self):
        """'Bearer ' followed by only whitespace provides no token."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("Bearer   ", TEST_TOKEN) is False


# ---------------------------------------------------------------------------
# Wrong or non-Bearer scheme — must return False
# ---------------------------------------------------------------------------


class TestCheckBearerTokenRejectsInvalidCredentials:
    """check_bearer_token returns False for wrong tokens and unsupported auth schemes."""

    def test_wrong_bearer_token_is_rejected(self):
        """A token that does not match the configured value must be rejected."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("Bearer wrong-token", TEST_TOKEN) is False

    def test_partial_token_prefix_is_rejected(self):
        """A prefix of the real token must not pass — exact match is required."""
        from metrics_app import check_bearer_token

        partial = TEST_TOKEN[: len(TEST_TOKEN) // 2]
        assert check_bearer_token(f"Bearer {partial}", TEST_TOKEN) is False

    def test_token_with_extra_characters_appended_is_rejected(self):
        """Appending extra characters to a valid token must cause rejection."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Bearer {TEST_TOKEN}extra", TEST_TOKEN) is False

    def test_basic_auth_scheme_is_rejected(self):
        """Basic auth credentials are not accepted on the /metrics bearer-only gate."""
        from metrics_app import check_bearer_token

        assert check_bearer_token("Basic dXNlcjpwYXNz", TEST_TOKEN) is False

    def test_token_auth_scheme_is_rejected(self):
        """'Token <value>' scheme (used by some services) must not be accepted."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Token {TEST_TOKEN}", TEST_TOKEN) is False


# ---------------------------------------------------------------------------
# Missing configured token — no token is ever valid without a server secret
# ---------------------------------------------------------------------------


class TestCheckBearerTokenRejectsWhenNoConfiguredToken:
    """check_bearer_token returns False when the server has no configured token."""

    def test_none_configured_token_rejects_valid_looking_header(self):
        """If METRICS_AUTH_TOKEN is not set, every request must be rejected."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Bearer {TEST_TOKEN}", None) is False

    def test_empty_configured_token_rejects_bearer_header(self):
        """An empty configured token must cause all requests to be rejected."""
        from metrics_app import check_bearer_token

        assert check_bearer_token(f"Bearer {TEST_TOKEN}", "") is False


# ---------------------------------------------------------------------------
# Security audit: constant-time comparison prevents timing attacks
# ---------------------------------------------------------------------------


class TestCheckBearerTokenConstantTimeComparison:
    """Security audit: token comparison must be timing-attack resistant."""

    def test_check_bearer_token_uses_hmac_compare_digest(self):
        """check_bearer_token must use hmac.compare_digest, not bare == on token strings.

        Bearer token comparison using == leaks timing information that could allow
        an attacker to enumerate valid token prefixes.  hmac.compare_digest runs
        in constant time regardless of how many characters match.
        """
        from metrics_app import check_bearer_token

        source = inspect.getsource(check_bearer_token)
        assert "hmac.compare_digest" in source, (
            "check_bearer_token must use hmac.compare_digest (not ==) "
            "to prevent timing-based side-channel attacks on the bearer token"
        )
