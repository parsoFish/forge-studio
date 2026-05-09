---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2026-05-09-simplarr-dry-run
status: pending
depends_on: []
acceptance_criteria:
  - given: "the user invokes `simplarr apply --dry-run`"
    when:  "cmd_apply.sh handles the flag"
    then:  "the script prints a message containing `would apply` and exits 0"
  - given: "the user invokes `simplarr apply` with no flags"
    when:  "cmd_apply.sh runs"
    then:  "the existing `applying stack...` message is still printed (regression guard)"
files_in_scope:
  - bash/cmd_apply.sh
estimated_iterations: 2
---

# Add `--dry-run` flag to bash/cmd_apply.sh

Operators want to preview an apply without actually executing it. Add a `--dry-run` flag to `bash/cmd_apply.sh`. When the flag is present, the script must print a message containing the literal text `would apply` and exit 0 without performing any state-changing action. When the flag is absent, the existing behaviour is unchanged.

## Failing test

`tests/dry_run.bats` already exists and currently fails. **Make it pass without modifying the test file.** The pre-existing `tests/parity_apply.bats` test must continue to pass (the third assertion in `dry_run.bats` is a regression guard — same intent).

## Hard rules

- Only modify `bash/cmd_apply.sh`.
- Keep `set -euo pipefail` discipline (no silent failures).
- Output must include the substring `would apply` exactly once when `--dry-run` is set.

## Brain themes worth a look

- `dual-language-parity-non-negotiable` — tracked in the project README. (PowerShell parity is OUT OF SCOPE for this WI; another WI will mirror the change.)
