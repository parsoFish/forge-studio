# Fix-loop ledger — REFINEMENT-PLAN v2 Phases 1+2

> SSOT for the 2026-07-10 fix loop. The driver (Claude main thread) updates
> STATUS as waves complete; committed at every wave boundary. When all items
> are `done`, the loop ends and the betterado auth cycle
> (auth-initiative-brief.md) is ready for kickoff.

## Driver protocol (survives compaction — re-read this if resuming)

1. Waves run in order; items within a wave run as PARALLEL worktree agents
   (Workflow tool, `isolation: 'worktree'`), each committing on its own branch.
2. Each agent: `npm install` in worktree → TDD (failing test first) →
   implement → `npm run build && npm test` green → conventional commits →
   report branch + SHAs + gate output. Agents NEVER push, never touch main,
   never run `ui:journey` (binds global ports 4123/4124).
3. Driver integrates serially after each wave: review diff → merge branch to
   main → full `npm test` after all merges → `forge brain lint` +
   `forge studio lint` → run `npm run ui:journey` ONCE per UI-touching wave
   (serialized, committed-first) → update this ledger → commit.
4. Safety loop: ScheduleWakeup heartbeat every ~20 min while a wave runs;
   on wake check workflow/agent liveness; stalled >30 min → inspect worktree,
   retry once with refined prompt; second failure → mark `blocked`, continue
   the wave, surface at close.
5. Model policy: sonnet for small/mechanical items, opus/inherit for engine
   items (Waves 3–5). Item risk noted per row.

## Wave 1 — small instruments + prompt clauses (parallel ×6, sonnet)

| # | Item (plan ref) | Surface | Status |
|---|---|---|---|
| W1.1 | 1.1 failure-classifier windowing (G5: classify from last N events, not full-history first-match) | orchestrator failure classifier | done |
| W1.2 | 1.2 gate-node derivation (hardcoded `gate='review'` in derive; show real gate names) | orchestrator/run-model-derive.ts | done |
| W1.3 | 1.7 fan-out truth (G6: runtime honors fanOut-forbidden-on-entry that lint already flags) | orchestrator flow engine | done |
| W1.4 | 1.9 reflector-loss visibility (lint-style check: diff `_queue/done/` vs `brain/cycles/_raw/`) | cli (brain lint family) | done |
| W1.5 | 1.10 reflector question re-emission + category→brain routing prompt clause | skills/ reflector skill | done |
| W1.6 | 2.12 docs-only gate-fit authoring clause | skills/ architect + PM skills | done |

## Wave 2 — cost truth + UI instruments (parallel ×4)

| # | Item (plan ref) | Surface | Status |
|---|---|---|---|
| W2.1 | 1.8 cost-rollup double-count fix THEN 1.4 per-WI cost attribution (same files, one agent, sequential) — opus | orchestrator/run-model-derive.ts + cli/metrics.ts | done |
| W2.2 | 1.3 flow-swap flicker (run-model staleness on flow switch) — sonnet | forge-ui + orchestrator/run-model.ts | done |
| W2.3 | 1.5 WI DAG layout honesty (deps rendered as real edges) — sonnet | forge-ui pipeline-tree | done |
| W2.4 | 1.6 roadmap page rework (initiative-centric, not cycle-centric) — sonnet | forge-ui roadmap page | done |

## Wave 3a — N1 solo (opus/inherit, the big one)

| # | Item | Surface | Status |
|---|---|---|---|
| W3.1 | 2.1 N1 orchestrator-owned gate execution — orchestrator runs gate commands itself, records pass/fail + output as events; deletes the agent-self-reported forensic ladder | orchestrator (gate execution path) + dev-loop/unifier skills | done |

## Wave 3b — engine honesty riding on N1 (parallel ×3, opus)

| # | Item | Surface | Status |
|---|---|---|---|
| W3b.1 | 2.2 unifier iteration cap (G4: cap loops, $84.56 overrun class) + uwi.gate-failed event | orchestrator unifier invocation | done |
| W3b.2 | 2.3 crash-no-identical-retry (classify SIGKILL/env before identical re-spawn) | orchestrator scheduler/cycle-runner | done |
| W3b.3 | 2.4 transient-lint reclassification + N9 rate-limit→env-failure (no cascade) | orchestrator failure classifier | done |

## Wave 4 — delivery honesty (parallel ×4, opus)

| # | Item | Surface | Status |
|---|---|---|---|
| W4.1 | 2.5 demo fan-in honesty + N3 demo-path SSOT (stale metadata, live-evidence id validation) | orchestrator demo fan-in + demo contract | done |
| W4.2 | 2.6 ralph commit discipline (G1/G2) + N2 nonce+producibility in demo contract | loops/ralph + demo contract | done |
| W4.3 | 2.7 send-back gate-body flow + N4 errexit-exempt gate template | orchestrator send-back path + gate template | done |
| W4.4 | 2.8 post-merge CI watch (N6) + 2.9 requeue-resume-from-worktree (N7) | orchestrator scheduler/pr | done |

## Wave 5 — pipeline honesty tail (parallel ×2)

| # | Item | Surface | Status |
|---|---|---|---|
| W5.1 | 2.10 reflector pipeline honesty (consumes 1.10; unreflected-cycle event on crash) — opus | orchestrator reflector invocation | done |
| W5.2 | 2.11 PM turn economy (write-WIs-incrementally, partial graph on exhaustion) — opus | orchestrator PM invocation + PM skill | done |

**Correction (2026-07-11 close-out audit):** W5.2's original row also claimed "env-pin at SDK seam (G8)" — that part did NOT land (commit cca2c17 contains no env handling; no pin/scrub exists anywhere in the SDK spawn seam). Confirmed live the same day: a bridge launched from an unscrubbed shell leaked `ANTHROPIC_BASE_URL`/headroom vars into SDK children — the 3rd occurrence of this leak class. G8 env-pin remains OPEN (deferred; ask-first scheduler-surface mechanism per the fix-loop deferral list).

**Scope note:** the W1–W5 labels above are the fix loop's overnight *wave* numbers, not REFINEMENT-PLAN phases. Every item in this ledger is a plan-item 1.x or 2.x (Phases 1–2). Plan Phases 3–5 (design-phase consolidation / ralph conformance + parallel WIs / pillars + skills) were NOT part of this loop and remain unexecuted as of 2026-07-11.

## Close-out gates (after Wave 5)

- [x] Full `npm test` green on main
- [x] `forge brain lint` 0 errors, `forge studio lint` green
- [x] `npm run ui:journey` green (single serialized run)
- [x] Ledger all-done, committed
- [x] Operator notified → auth cycle kickoff (auth-initiative-brief.md)
