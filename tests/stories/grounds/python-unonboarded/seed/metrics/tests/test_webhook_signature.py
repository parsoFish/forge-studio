import sys
import os
import hashlib
import hmac
import inspect

import pytest

# Add src to path so we can import webhook module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

TEST_SECRET = "test-webhook-secret-32chars-long!!"
TEST_BODY = b'{"action": "completed", "deployment": {"id": 42}}'


def _compute_signature(body: bytes, secret: str) -> str:
    """Compute the expected HMAC-SHA256 signature for test fixtures."""
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


class TestVerifySignatureAcceptsValidRequests:
    """verify_signature returns True for well-formed, correctly signed payloads."""

    def test_valid_signature_is_accepted(self):
        from webhook import verify_signature

        sig = _compute_signature(TEST_BODY, TEST_SECRET)
        assert verify_signature(TEST_BODY, TEST_SECRET, sig) is True

    def test_empty_body_with_valid_signature_is_accepted(self):
        from webhook import verify_signature

        sig = _compute_signature(b"", TEST_SECRET)
        assert verify_signature(b"", TEST_SECRET, sig) is True

    def test_large_body_with_valid_signature_is_accepted(self):
        from webhook import verify_signature

        large_body = b"x" * 10_000
        sig = _compute_signature(large_body, TEST_SECRET)
        assert verify_signature(large_body, TEST_SECRET, sig) is True


class TestVerifySignatureRejectsInvalidRequests:
    """verify_signature returns False for any tampered or malformed input."""

    def test_tampered_body_is_rejected(self):
        from webhook import verify_signature

        valid_sig = _compute_signature(TEST_BODY, TEST_SECRET)
        tampered_body = b'{"action": "pwned"}'
        assert verify_signature(tampered_body, TEST_SECRET, valid_sig) is False

    def test_wrong_secret_is_rejected(self):
        from webhook import verify_signature

        sig_with_wrong_secret = _compute_signature(TEST_BODY, "wrong-secret")
        assert verify_signature(TEST_BODY, TEST_SECRET, sig_with_wrong_secret) is False

    def test_garbled_hex_signature_is_rejected(self):
        from webhook import verify_signature

        assert verify_signature(TEST_BODY, TEST_SECRET, "sha256=deadbeef") is False

    def test_empty_signature_header_is_rejected(self):
        from webhook import verify_signature

        assert verify_signature(TEST_BODY, TEST_SECRET, "") is False

    def test_none_signature_header_is_rejected(self):
        from webhook import verify_signature

        assert verify_signature(TEST_BODY, TEST_SECRET, None) is False

    def test_sha1_prefix_instead_of_sha256_is_rejected(self):
        # GitHub also sends X-Hub-Signature (sha1); the service must only accept sha256
        from webhook import verify_signature

        sha1_mac = hmac.new(TEST_SECRET.encode(), TEST_BODY, hashlib.sha1)
        sha1_sig = f"sha1={sha1_mac.hexdigest()}"
        assert verify_signature(TEST_BODY, TEST_SECRET, sha1_sig) is False

    def test_signature_without_sha256_prefix_is_rejected(self):
        from webhook import verify_signature

        bare_hex = hmac.new(TEST_SECRET.encode(), TEST_BODY, hashlib.sha256).hexdigest()
        assert verify_signature(TEST_BODY, TEST_SECRET, bare_hex) is False

    def test_correct_hash_with_wrong_prefix_is_rejected(self):
        from webhook import verify_signature

        mac = hmac.new(TEST_SECRET.encode(), TEST_BODY, hashlib.sha256)
        # Swap sha256= for sha512= — same hash, wrong label
        bad_prefix_sig = f"sha512={mac.hexdigest()}"
        assert verify_signature(TEST_BODY, TEST_SECRET, bad_prefix_sig) is False


class TestVerifySignatureConstantTimeComparison:
    """Security audit: constant-time comparison must be used to prevent timing attacks."""

    def test_verify_signature_uses_hmac_compare_digest(self):
        """verify_signature must call hmac.compare_digest, never bare == on signatures."""
        from webhook import verify_signature

        source = inspect.getsource(verify_signature)
        assert "hmac.compare_digest" in source, (
            "verify_signature must use hmac.compare_digest (not ==) "
            "to prevent timing-based side-channel attacks"
        )
