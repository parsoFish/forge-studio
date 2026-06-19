# ADR 011 — Unattended scheduler with file-based initiative queue and worktree pool

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

Forge's load-bearing requirement is **unattended operation between human interaction points** — the system must claim initiatives, drive each through PM → Developer Loop → Review-Prep, and surface completed initiatives without prompting the user, for arbitrary durations between the three human-in-the-loop moments (architect, review, reflection).

The prior approach met a similar requirement with a job queue + worker pool + resource controller + adaptive concurrency + process isolation. That was correct but heavy. The current architecture must achieve the same outcome without re-introducing that infrastructure.

## Decision

A **persistent process named `forge serve`** runs the scheduler. The original scaffold target was ~150 LOC; the **as-built reality is larger** (the 2026-05-17 as-built snapshot, formerly at `docs/_archive/architecture/as-built-snapshot-2026-05-17.md`, was removed 2026-06-07 — see git history; §B showed post-stripback `scheduler.ts` at ~676 LOC, `cycle.ts` at ~404 LOC, orchestrator total ≈10,857 non-test LOC). The target stands as a *pressure*, not a measured fact. **Note:** the LOC figures are a point-in-time snapshot (2026-05-16/17); `scheduler-dispatch.ts` was later extracted from `scheduler.ts` as a separate module. Components:

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
- Honest LOC reconciliation (2026-05-16, post F-24…F-44): the scheduler subsystem ≈ **1,600 LOC** and the whole `orchestrator/` ≈ **4,400 LOC** vs the prior codebase's ~6,000 — still smaller, but well over the scaffold's "≈ 300 LOC" target. Most of the growth is the shared bench↔live `*-invocation.ts` prompt contracts (~1,100 LOC, single source of truth, defensible) plus the F-27 resilience layer. The cap is a *pressure to delete*, not a measured fact; the simplification track (Phase 3 — extract `pr.ts`, split files ≤800 LOC) reduces it. Per-file:
  - `scheduler.ts` (~874) — claim loop + recovery + dispatch + cleanup + bounded auto-retry.
  - `queue.ts` (~185) — file-state machine + recovery sweep.
  - `worktree.ts` (~120) — `add` / `remove` / `cleanup` / `list`.
  - `notify.ts` (~75) — desktop + webhook providers.
  - `file-verdict.ts` (~310) — F-02 file-based verdict provider (production human-in-the-loop transport for review verdicts).
  - `config.ts` (~85) — F-10 / F-18 `forge.config.json` loader + env assertion.
  Each addition closes a specific operational gap surfaced in the [pass-1 review](../../_review/00-summary.md). Net surface still much smaller than the prior approach.
- No DB, no IPC, no daemon protocol — the filesystem is the protocol.
- Inspectable: `ls _queue/` is the entire system state.
- Trivially recoverable from crash (see ADR 012).

**Negative / accepted trade-offs:**
- `mv`-atomic-claim assumes a single filesystem (no NFS-style network mounts). For our local-first model, fine.
- No priority queue / dedup — pending items are processed in filesystem order. Adequate; can revisit if real need surfaces.
- Static concurrency knob, not adaptive. If the user has more capacity, they raise it. We refuse to re-introduce CPU/memory monitoring.

## Alternatives considered

- **The prior job queue + worker** — the explicit thing we're not rebuilding.
- **systemd timer** — fine for periodic jobs, awkward for the long-running watch-and-claim model.
- **A local message broker (Redis, NATS)** — adds a service to manage; the filesystem suffices.
- **GitHub Actions for scheduling** — possible, but couples to GitHub for what is fundamentally a local concern; rejected.

## References

- The prior `src/jobs/`, `src/monitor/`, `src/agents/runner.ts` — the scope being collapsed
