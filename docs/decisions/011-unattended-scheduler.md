# ADR 011 — Unattended scheduler with file-based initiative queue and worktree pool

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

Forge v2's load-bearing requirement is **unattended operation between human interaction points** — the system must claim initiatives, drive each through PM → Developer Loop → Review-Prep, and surface completed initiatives without prompting the user, for arbitrary durations between the three human-in-the-loop moments (architect, review, reflection).

V1 met a similar requirement with a job queue + worker pool + resource controller + adaptive concurrency + process isolation. That was correct but heavy. V2 must achieve the same outcome without re-introducing that infrastructure.

## Decision

A **persistent process named `forge serve`** runs the scheduler. It is approximately 150 lines of code. Components:

- **`_queue/` directory state machine** — `pending/`, `in-flight/`, `ready-for-review/`, `done/`, `failed/`. Each subdirectory contains initiative manifests (markdown files with YAML frontmatter). State transitions are atomic file moves (`mv pending/<id>.md in-flight/<id>.md`).
- **Bounded worktree pool** — up to `scheduler.maxConcurrentInitiatives` (default 2) `git worktree add` instances at any time. Each in-flight initiative owns one.
- **Atomic claim** — `mv` on a single filesystem is atomic; this is the entire claim mechanism.
- **Heartbeat** — each in-flight initiative writes `_queue/in-flight/<id>.heartbeat` every 30s. The scheduler uses this for crash recovery (see ADR 012).
- **Per-initiative budgets** — `iteration_budget` and `cost_budget_usd` in the manifest frontmatter cap runaway loops.

The scheduler exposes:
- `forge serve` — run forever (or under systemd).
- `forge serve --once` — claim and run a single initiative, then exit (used in tests and one-shot operation).
- `forge enqueue <project> <initiative-spec>` — drop a manifest into `_queue/pending/`.
- `forge status` — print current queue counts and in-flight phase/iteration info.

## Consequences

**Positive:**
- Total scheduler code: scheduler.ts + queue.ts + worktree.ts + notify.ts ≈ 300 LOC vs v1's ~6,000 LOC equivalent.
- No DB, no IPC, no daemon protocol — the filesystem is the protocol.
- Inspectable: `ls _queue/` is the entire system state.
- Trivially recoverable from crash (see ADR 012).

**Negative / accepted trade-offs:**
- `mv`-atomic-claim assumes a single filesystem (no NFS-style network mounts). For our local-first model, fine.
- No priority queue / dedup — pending items are processed in filesystem order. Adequate; can revisit if real need surfaces.
- Static concurrency knob, not adaptive. If the user has more capacity, they raise it. We refuse to re-introduce CPU/memory monitoring.

## Alternatives considered

- **V1's job queue + worker** — the explicit thing we're not rebuilding.
- **systemd timer** — fine for periodic jobs, awkward for the long-running watch-and-claim model.
- **A local message broker (Redis, NATS)** — adds a service to manage; the filesystem suffices.
- **GitHub Actions for scheduling** — possible, but couples to GitHub for what is fundamentally a local concern; rejected.

## References

- v1's `src/jobs/`, `src/monitor/`, `src/agents/runner.ts` — the scope being collapsed
