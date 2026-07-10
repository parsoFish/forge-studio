---
title: failure_classification emits stale event IDs from prior failure leg after CI-gate failure
description: After CI-gate failed post dev-loop completion, orchestrator re-emitted failure_classification with event IDs from an earlier PM-failure leg, reporting wrong failure mode.
category: antipattern
created_at: 2026-07-10
updated_at: 2026-07-10
---

## Pattern

In the build-migration cycle (INIT-2026-07-01-migrate-framework-build), the dev-loop completed successfully (5/5 WIs complete). The CI gate (`make test && golangci-lint run ./azuredevops/... && make terrafmt-check`) then failed: 3 gofumpt violations + 2 unused types. The orchestrator emitted a `failure_classification` event with:

- `failure_kind: terminal`
- `reason: "PM emitted zero work items — the initiative body may have no decomposable ACs or the PM ignored them entirely; amend the initiative body and re-queue"`
- `evidence_event_ids: ["EV_mr2m17zw_6fnxfyb3", "EV_mr2m17zw_6fnxfyb3", "EV_mr2m17zw_p3m2g55r"]`

These event IDs are from the PM-failure leg (first PM run, ~11 hours earlier). The current failure was a CI lint failure on a complete dev-loop. The classification was factually wrong — it caused the operator to investigate a non-existent decompose bug before realising the actual failure was 5 gofumpt lines.

## Impact

- Operator misled: 4 manual recovery commands needed (gofumpt -w, delete 2 unused types, commit, requeue)
- Pipeline required a full second dev-loop + unifier pass to reach CI green
- External monitoring/tooling reading `failure_classification` would conclude the initiative is non-recoverable (terminal, PM failure) when it is actually recoverable with a lint fix

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` lines 1198-1200 (ci-gate failure + failure_classification)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build.md` finding #7
- User feedback: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/retro.md` Q4
