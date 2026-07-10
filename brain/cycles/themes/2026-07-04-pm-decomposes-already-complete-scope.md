---
title: PM decomposes already-complete scope from prior initiative
description: PM emitted WIs for resources already migrated in a dependency initiative; the already-complete guard caught it at $0 cost but the WI specs consumed decomposition budget and created misleading AC counts.
category: antipattern
created_at: 2026-07-04
updated_at: 2026-07-04
---

# PM decomposes already-complete scope from prior initiative

## What happened

The policy/checks migration initiative declared `depends_on_initiatives: [INIT-2026-07-01-migrate-framework-release-folder-permissions]`. WI-4 covered 6 checks resources and was emitted with 3 ACs and `files_in_scope: 23`. Across all three dev-loop passes, WI-4 delivered 0 files and exited immediately with `stop_reason: already-complete` at $0 cost.

The already-complete guard handled this correctly and cheaply. However:
- PM spent decomposition budget on a WI with no real work.
- The 3 ACs in WI-4 were never verified by a ralph agent (the guard fires before the agent starts).
- The final delivery stats include WI-4's AC count in the initiative total — inflating apparent scope.

## Why it matters

At $0 cost per occurrence this is benign for individual cycles. At scale (many dependent initiatives), PM routinely decomposing already-complete scope adds noise to metrics, inflates WI counts, and makes retrospective analysis harder. The PM has no pre-flight mechanism to diff the manifest scope against the current project tree before emitting WIs.

## Fix direction

PM pre-flight: before emitting a WI for a resource class, check whether the corresponding `*_framework.go` file already exists in the worktree. If it does, skip the WI (or emit it as `status: skipped` with a note). This requires the PM to have read access to the worktree at decomposition time — which it already does (it reads the project tree for context).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch/events.jsonl` — WI-4 `ralph.end` events (all three passes: `stop_reason: already-complete`, `iterations: 0`, `cost_usd: 0`)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch.md`
