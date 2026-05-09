"""Pre-existing redactor tests. Must not regress when WI-1 lands."""
from src.redactor import redact_one


def test_redact_one_strips_openai_keys():
    out = redact_one("export OPENAI_API_KEY=sk-abc123def456ghi789jkl")
    assert "<REDACTED>" in out
    assert "sk-abc123" not in out


def test_redact_one_passes_clean_strings():
    assert redact_one("git status") == "git status"


def test_redact_strips_aws_access_key():
    assert "<REDACTED>" in redact_one("AKIAABCDEFGHIJKLMNOP")
