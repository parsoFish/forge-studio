---
initiative_id: INIT-2026-05-09-env-optimiser-redact-argv
project: env-optimiser
project_repo_path: /tmp/env-optimiser
created_at: 2026-05-09T16:00:00Z
iteration_budget: 30
cost_budget_usd: 15
phase: done
features:
  - feature_id: FEAT-1
    title: redact_argv helper for sensitive CLI arguments
    depends_on: []
---

# Initiative: env-optimiser — redact_argv

The env-optimiser CLI logs argv on every invocation for support
debugging. Sensitive arguments (e.g. `--token`, `--password`,
`--api-key`) end up in plaintext logs, which violates the redaction
policy.

## Features

### FEAT-1 — `redact_argv(argv) -> argv'`

`src/redactor.py` exports `redact_argv(argv: list[str]) -> list[str]`
that returns a copy of `argv` with any value following a sensitive flag
replaced by `***`.

- Recognised sensitive flags (case-insensitive): `--token`,
  `--password`, `--api-key`, `--secret`.
- Bare values without preceding sensitive flag remain unredacted.
- Equal-sign form (`--token=abc`) is also redacted (becomes `--token=***`).
- Empty argv returns empty list.
- Original argv is not mutated.

Tests in `tests/test_redact_argv.py` cover all five cases.
