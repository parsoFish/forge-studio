---
source_type: docs
source_url: docs/decisions/012-crash-recovery.md
source_title: ADR 012 — Crash recovery via worktree heartbeat + atomic claim
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 012 — Crash recovery via worktree heartbeat + atomic claim

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

`forge serve` is a long-running process. It will die — power loss, OOM, manual restart. When it does, in-flight initiatives must not be silently lost. V1's solution involved session/process-isolation modules and a stateful worker. V2 needs equivalent correctness with much less code.

## Decision

Recovery is two file-system checks at startup:

1. **Stale-heartbeat sweep.** For each `_queue/in-flight/<id>.heartbeat`, check `mtime`. If older than `staleHeartbeatThreshold` (default 5 minutes), worktree is presumed orphaned. Move `_queue/in-flight/<id>.md` back to `_queue/pending/`, attempt `git worktree remove --force`, log a `recovery` event.
2. **Missing-worktree sweep.** For each `_queue/in-flight/<id>.md`, parse manifest's `worktree_path` frontmatter. If worktree no longer exists on disk, treat as above.

Both sweeps run on `forge serve` startup before claiming any new work. Also on a 5-minute timer.

In-flight initiatives write their **current phase + iteration count** to manifest frontmatter on every Ralph iteration. On recovery, this lets the next claim resume from the same prompt state.

## Consequences

- Full recovery in two grep-able file-system passes.
- No DB transactions, no journaling, no leader election.
- Silent loss is impossible — stale heartbeats produce log events the human can audit.
- Trade-off: 5-minute window where a stuck initiative looks alive — acceptable for unattended cadence. If user manually moves a manifest while scheduler is running, weird things happen — the manifest format documents this constraint.

## Alternatives considered

- `flock(2)`-based locks — fragile across restarts; harder to inspect.
- A real lock manager (etcd-style) — wildly over-engineered for one machine.
- No recovery; require manual triage — fails the unattended-operation requirement.

## References

- v1's `src/agents/runner.ts` session-recovery code (inspiration; not ported)
