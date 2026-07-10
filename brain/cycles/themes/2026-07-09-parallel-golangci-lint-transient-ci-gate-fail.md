---
title: Parallel golangci-lint process causes transient CI gate terminal classification
description: When a prior cycle's golangci-lint is still running, the orchestrator's CI gate exits with "parallel golangci-lint is running" and classifies the cycle terminal/non-recoverable — a transient resource conflict that should auto-retry.
category: antipattern
created_at: 2026-07-09T22:30:00.000Z
updated_at: 2026-07-09T22:30:00.000Z
---

## What happened

Cycle `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint`.

Dev-loop run 1 completed (10/10 WIs). Unifier UWI-1 hit a go build failure (dead SDKv2 helpers) and pushed the branch. The orchestrator then ran the CI gate:

```
make test && golangci-lint run ./azuredevops/... && make terrafmt-check
```

Output tail:
```
Error: parallel golangci-lint is running
The command is terminated due to an error: parallel golangci-lint is running
```

A golangci-lint process from a previous cycle was still running on the same machine. The CI gate exited non-zero. Combined with the go build failure already present on the branch, the cycle was classified:

```json
{"failure_mode":"terminal","failure_kind":"terminal","recoverable":false,
 "reason":"failure could not be classified — examine events.jsonl manually"}
```

Operator manually requeued. A full second PM run + second dev-loop run was required ($15-20, ~1.5h).

## Why this is an antipattern

The `golangci-lint` parallel-process conflict is a **transient resource contention**, not a code failure. It will self-resolve in minutes. Classifying it as `terminal, recoverable: false` discards all dev-loop work and forces a full re-run.

This is separate from the underlying dead-helper build failure (also present this cycle). But if the transient error fires alone on a clean branch, the entire cycle gets thrown away for a lock contention race.

## Mitigation

**Orchestrator:** Detect "parallel golangci-lint is running" in CI gate stderr → auto-retry after 60–120s. At most 2 retries before escalating to terminal. Applies to any CI gate that uses golangci-lint.

**Operator workaround (current):** Requeue manually; the second run succeeds once the prior lint process finishes.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint/events.jsonl` — lines 2877-2879: `cycle.ci-gate` error with "parallel golangci-lint is running" output; `failure_classification` event
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint.md`
