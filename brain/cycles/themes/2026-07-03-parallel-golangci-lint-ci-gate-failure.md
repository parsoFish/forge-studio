---
title: Parallel golangci-lint process causes CI gate failure and forces full dev-loop re-run
description: A pre-existing golangci-lint instance on the host killed the CI delivery gate ("parallel golangci-lint is running"), triggering a full second dev-loop pass — all WIs repeated unnecessarily.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Parallel golangci-lint process causes CI gate failure and forces full dev-loop re-run

## What happened

In the INIT-2026-07-01-new-api-notification cycle, after a complete dev-loop pass (all 3 WIs delivered, live acceptance green, unifier finished), the CI delivery gate at 06:44:28 emitted:

```
Error: parallel golangci-lint is running
The command is terminated due to an error: parallel golangci-lint is running
```

The gate returned non-zero; the orchestrator classified it as `ci-gate-failed` and did not open a PR. A full second dev-loop pass was launched — WI-1, WI-2, and WI-3 all ran again from scratch, duplicating ~$7-10 of token cost and ~50 minutes of wall time.

## Root cause

`golangci-lint` uses a file-based lock; if a prior lint run from another process (e.g. a concurrent forge worktree or a stale background process) holds the lock, a new invocation exits with the "parallel" error rather than waiting or retrying.

## Fix direction

The CI gate runner should detect the `parallel golangci-lint is running` error string specifically and retry with exponential backoff (e.g. 30s, 60s, 120s) before classifying the gate as failed. This is a transient host contention error, not a real lint failure. Alternatively, pass `--allow-parallel-runners` to `golangci-lint` if the lint configuration permits it.

Would be true for any project using golangci-lint — this is a forge machinery lesson.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification/events.jsonl` (event at 06:44:28, `ci-gate-failed`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification.md`
