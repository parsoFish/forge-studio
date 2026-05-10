"""env-optimiser redact_argv helper."""

from __future__ import annotations

SENSITIVE_FLAGS = frozenset({"--token", "--password", "--api-key", "--secret"})


def redact_argv(argv: list[str]) -> list[str]:
    out: list[str] = []
    redact_next = False
    for arg in argv:
        lower = arg.lower()
        if redact_next:
            out.append("***")
            redact_next = False
            continue
        if "=" in arg:
            head, _, _ = arg.partition("=")
            if head.lower() in SENSITIVE_FLAGS:
                out.append(f"{head}=***")
                continue
        if lower in SENSITIVE_FLAGS:
            out.append(arg)
            redact_next = True
            continue
        out.append(arg)
    return out
