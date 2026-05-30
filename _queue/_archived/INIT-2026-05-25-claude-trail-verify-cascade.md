---
initiative_id: INIT-2026-05-25-claude-trail-verify-cascade
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T22:00:00.000Z'
iteration_budget: 6
cost_budget_usd: 4.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Probe core — count events, phases, duration
    depends_on: []
  - feature_id: FEAT-2
    title: Probe formatter — one-line health summary
    depends_on: [FEAT-1]
  - feature_id: FEAT-3
    title: CLI wiring + golden test
    depends_on: [FEAT-2]
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-verify-cascade
---

# INIT-2026-05-25-claude-trail-verify-cascade — verification cycle

> **Verification cycle — explicitly throwaway work.** Authored solely
> to exercise:
>
>   1. **Tier 1 thinning** (forge-side) — PM should produce a healthy
>      multi-WI DAG (5–8 WIs across three features) now that the
>      synthetic 1-WI bias is gone, without per-WI count caps from
>      thin-air.
>   2. **UI updates** — the cascading hex tree (phases → features →
>      WIs), event-driven materialisation, repositioned plan/demo
>      badges, dep arcs. Recorded against the operator UI so the
>      transitions are captured.
>
> The code added by this initiative is intentionally small + isolated.
> The cycle archive is the durable artifact; the implementation can be
> reverted later without affecting other features of `claude-trail`.

## What this ships

A new `claude-trail probe <cycle-dir>` subcommand that prints a one-
line health summary of a cycle log directory:

```
$ claude-trail probe _logs/2026-05-25T...
INIT-2026-05-25-...: 47 events, 6 phases, dominant=developer-loop (22 events)
```

The summary helps the operator triage cycle logs at a glance without
opening the full trail or events.jsonl. Pure read-only; no I/O outside
the supplied directory.

## Constraints

- TypeScript + `node --test --experimental-strip-types`, no new deps.
- Must not modify the existing `trail` subcommand, fixtures, or any
  other `src/*.ts` file beyond CLI wiring.
- Each work item declares its own sharp `quality_gate_cmd` pointing at
  a NEW test file (per the existing PM SKILL discipline).
- 90 existing tests must keep passing.

## Acceptance

- `claude-trail probe <fixture-cycle-dir>` exits 0 and prints a single
  line matching: `<initiative-id>: <N> events, <M> phases, dominant=<phase> (<K> events)`.
- All new tests under `tests/probe-*.test.ts` pass.
- Existing 90 tests still pass (no regressions).

## Decomposition hint (PM)

This initiative is intentionally multi-feature + multi-WI. Decompose
into the natural seams: probe-core logic in one feature, output
formatter in another, CLI wiring + the golden test in the third.
Each feature warrants 1–3 WIs. Use the brain for sizing references
from past claude-harness cycles.
