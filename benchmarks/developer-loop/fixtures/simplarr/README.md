# simplarr (fixture)

Minimal slice of the simplarr project for the developer-loop benchmark.
WI-1 adds a `--dry-run` flag to `bash/cmd_apply.sh`.

## Layout

- `bash/simplarr.sh` — bash entry point.
- `bash/cmd_apply.sh` — apply subcommand (target of WI-1).
- `tests/parity_apply.bats` — pre-existing test (regression guard).
- `tests/dry_run.bats` — failing acceptance test for WI-1.
- `.forge/work-items/WI-1.md` — work-item spec.

## Prerequisites

- `bats-core` installed on the bench host (`apt install bats` or `brew install bats-core`).
