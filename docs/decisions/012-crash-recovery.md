# ADR 012 — Crash recovery via worktree heartbeat + atomic claim

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

`forge serve` is a long-running process. It will die — power loss, OOM, manual restart. When it does, in-flight initiatives must not be silently lost. V1's solution involved session/process-isolation modules and a stateful worker. V2 needs equivalent correctness with much less code.

## Decision

**Recovery is two file-system checks at startup**:

1. **Stale-heartbeat sweep.** For each `_queue/in-flight/<id>.heartbeat`, check `mtime`. If older than `staleHeartbeatThreshold` (default 5 minutes), the worktree is presumed orphaned. Move `_queue/in-flight/<id>.md` back to `_queue/pending/`, attempt `git worktree remove --force` of the owning worktree, and log a `recovery` event.
2. **Missing-worktree sweep.** For each `_queue/in-flight/<id>.md`, parse the manifest's `worktree_path` frontmatter field. If the worktree no longer exists on disk, treat as above.

Both sweeps run on `forge serve` startup, before claiming any new work. They also run on a timer (every 5 minutes) to catch worktrees that go missing while the scheduler is up (e.g. the user manually deleted one).

In-flight initiatives also write their **current phase + iteration count** to the manifest's frontmatter on every Ralph iteration. On recovery, this lets the next claim resume from the same prompt state (the Ralph runner reads `fix_plan.md` and `AGENT.md` which are checkpointed in the worktree).

## Consequences

**Positive:**
- Full recovery in two grep-able file-system passes.
- No DB transactions, no journaling, no leader election.
- Silent loss is impossible — stale heartbeats produce log events the human can audit.

**Negative / accepted trade-offs:**
- 5-minute window where a stuck initiative looks alive. Acceptable for the unattended cadence.
- If the user manually moves a manifest while the scheduler is running, weird things happen. The manifest format documents this constraint.

## Alternatives considered

- **`flock(2)`-based locks** — fragile across restarts; harder to inspect.
- **A real lock manager (etcd-style)** — wildly over-engineered for one machine.
- **No recovery; require manual triage** — fails the unattended-operation requirement.

## References

- v1's `src/agents/runner.ts` session-recovery code (inspiration; not ported)
