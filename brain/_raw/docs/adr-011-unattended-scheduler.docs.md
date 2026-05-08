---
source_type: docs
source_url: docs/decisions/011-unattended-scheduler.md
source_title: ADR 011 — Unattended scheduler with file-based initiative queue and worktree pool
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 011 — Unattended scheduler with file-based initiative queue and worktree pool

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

Forge v2's load-bearing requirement is **unattended operation between human interaction points** — claim initiatives, drive each through PM → Developer Loop → Review-Prep, surface completed initiatives without prompting the user, for arbitrary durations between the three human-in-the-loop moments (architect, review, reflection).

V1 met a similar requirement with a job queue + worker pool + resource controller + adaptive concurrency + process isolation. Correct but heavy. V2 must achieve the same outcome without re-introducing that infrastructure.

## Decision

`forge serve` runs the scheduler. ~150 lines. Components:

- **`_queue/` directory state machine** — `pending/`, `in-flight/`, `ready-for-review/`, `done/`, `failed/`. Each subdirectory contains initiative manifests (markdown files with YAML frontmatter). State transitions are atomic file moves.
- **Bounded worktree pool** — up to `scheduler.maxConcurrentInitiatives` (default 2) `git worktree add` instances at any time.
- **Atomic claim** — `mv` on a single filesystem is atomic; this is the entire claim mechanism.
- **Heartbeat** — each in-flight initiative writes `_queue/in-flight/<id>.heartbeat` every 30s.
- **Per-initiative budgets** — `iteration_budget` and `cost_budget_usd` in manifest frontmatter cap runaway loops.

CLI surface: `forge serve`, `forge serve --once`, `forge enqueue`, `forge status`.

## Consequences

- Scheduler ≈ 300 LOC vs v1's ~6,000 LOC equivalent.
- No DB, no IPC, no daemon protocol — the filesystem IS the protocol.
- Inspectable: `ls _queue/` is the entire system state.
- Trade-off: `mv`-atomic-claim assumes single filesystem (no NFS-style network mounts). No priority queue / dedup — pending items processed in filesystem order. Static concurrency knob, not adaptive. We refuse to re-introduce CPU/memory monitoring.

## Alternatives considered

- V1's job queue + worker — explicitly not rebuilding.
- systemd timer — fine for periodic jobs, awkward for long-running watch-and-claim.
- Local message broker (Redis, NATS) — adds a service to manage.
- GitHub Actions for scheduling — couples to GitHub for what is fundamentally a local concern.

## References

- v1's `src/jobs/`, `src/monitor/`, `src/agents/runner.ts` — the scope being collapsed
