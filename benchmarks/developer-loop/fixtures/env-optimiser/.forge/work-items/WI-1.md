---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2026-05-09-env-optimiser-redact-argv
status: pending
depends_on: []
acceptance_criteria:
  - given: "a list of argv strings, some containing secrets"
    when:  "redact_argv is called with that list"
    then:  "a new list is returned where each element has been passed through redact_one"
  - given: "an empty argv list"
    when:  "redact_argv is called with []"
    then:  "an empty list is returned (not None)"
  - given: "the input argv list reference"
    when:  "redact_argv has returned"
    then:  "the input list is not the same object as the output (no aliasing)"
files_in_scope:
  - src/redactor.py
estimated_iterations: 2
---

# Add `redact_argv` helper to the redactor module

The capture pipeline currently calls `redact(events: list[str])` to scrub a list of stored events. We need a sibling helper, `redact_argv(argv: list[str]) -> list[str]`, that does the same operation but is named after its caller's intent (sanitising a command-line argv before logging it). Implementation should be a thin wrapper around the existing `redact_one`.

## Failing test

`tests/test_redact_argv.py` already exists and fails because `redact_argv` is not defined. **Make it pass without modifying the test file.**

## Hard rules

- Do not modify `redact_one` or the existing `PATTERNS` (the `tests/test_redactor.py` regression tests must keep passing).
- Do not add new dependencies.
- The new function must return a *new* list, not mutate or alias the input.

## Brain themes worth a look

- `secrets-redaction-mandatory` — constitution rule the redactor enforces.
