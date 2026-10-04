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

Whenever `forge serve` is live, it claims every eligible manifest in
`_queue/pending/` as capacity allows. `forge studio` starts and supervises
`forge serve` as part of bringing the operator surface up, the same way it
starts the bridge and the UI, so the operator never manages the daemon's
lifecycle as a separate step.

The only operator brake is **one emergency halt**: user-triggered, it stops new
claims, lets every active job run to completion, and loses no progress. Its
mechanism:

- **One record.** `_queue/halt.json` (`{ since, actor }`) — present means
  halted, absent means not. Every check reads the file, so the halt survives a
  Studio restart, a `forge serve` respawn and a reboot. An unreadable record
  reads as halted.
- **Every claim seam refuses.** The queue claim (`tick()` and `claim()`,
  including `forge serve --once`) takes nothing; the drain sweep does not
  re-enter ready-for-review cycles for fix work items; the dispatch claim every
  bridge-spawned agent turn passes refuses with `409 { error: 'halted' }` and
  writes nothing.
- **Active work finishes whole.** Every in-flight run continues through all its
  remaining work items to its own terminal state, and every live agent turn
  runs to its end. The halt sends no signal: `forge serve` stays up and keeps
  polling, so its supervisor never sees a crash.
- **Nothing queued is lost.** Enqueues, requeues, recovery and scheduled
  triggers still write to `_queue/pending/`; that work waits.
- **Shown while on.** One Studio control, on every page, pulls the halt and
  releases it. While it is on, Studio shows how many runs are still finishing
  and how many are queued, and every queued surface says the halt is why
  nothing starts. `GET /api/health` reports it as `serve.halt`.
- **Release** removes the record; the next poll claims as capacity allows.

The scheduler exposes:
- `forge serve` — run in the foreground (or under systemd/pm2 for process
  supervision); normally spawned and supervised by `forge studio` rather than
  invoked by the operator directly.
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
- No lifecycle control for the operator to keep track of. A separate
  start/pause control would be an easy-to-forget second state: an operator could
  pause and walk away believing work was still moving, or start a second
  instance believing the first never launched. None exists. The emergency halt
  is a deliberate brake the operator pulls, and its queue half is a persisted
  claim-nothing state the system sits in until it is released — the same
  class of mechanism as a pause. What keeps it from that failure is that it is
  never unannounced: one control, user-triggered only, shown on every Studio
  page while it is on, and it stops agent dispatches as well as claims.

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
