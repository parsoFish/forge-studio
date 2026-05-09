# env-optimiser (fixture)

Minimal slice of the env-optimiser project for the developer-loop benchmark.
Only `src/redactor.py` is in scope for WI-1.

## Layout

- `src/redactor.py` — secret-redaction module.
- `tests/test_redactor.py` — pre-existing tests (must not regress).
- `tests/test_redact_argv.py` — failing acceptance test for WI-1.
- `.forge/work-items/WI-1.md` — work-item spec.
