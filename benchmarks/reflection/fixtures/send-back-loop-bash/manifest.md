---
initiative_id: INIT-2026-05-09-simplarr-dry-run
project: simplarr
project_repo_path: /tmp/simplarr
created_at: 2026-05-09T08:00:00Z
iteration_budget: 30
cost_budget_usd: 15
phase: done
features:
  - feature_id: FEAT-1
    title: Add `--dry-run` flag to apply command
    depends_on: []
---

# Initiative: simplarr `--dry-run` flag for cmd_apply

The `simplarr apply` command currently mutates the target tree on every
invocation. Operators want a `--dry-run` mode that prints the planned
changes without applying them, so they can preview before committing.

## Features

### FEAT-1 — `--dry-run` flag (no dependencies)

`bash/cmd_apply.sh` accepts `--dry-run`. When present:
- Print every file the command would create / modify / delete.
- Print to stdout, prefixed with `[DRY-RUN]`.
- Exit 0 without touching the filesystem.

Tests in `tests/dry_run.bats` cover the three operation types and the
no-side-effects assertion.
