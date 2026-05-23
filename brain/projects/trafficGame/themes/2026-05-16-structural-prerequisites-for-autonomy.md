---
title: trafficGame — the structural prerequisites that unblocked unattended forge cycles
description: What trafficGame needed before forge could run it unattended: lean fast test suite, .forge/ gitignore, god-file decomposition (Game.ts 1,732 LOC), seeded brain themes + roadmap, and harness respect for the locked-core git/test mandates. C1–C5 are now met; the merge model (C6) is the residual blocker.
category: reference
keywords: [trafficgame, prerequisites, simplification, test-stack, gitignore, decomposition, locked-core, git-ownership, roadmap, autonomy]
created_at: 2026-05-16T00:00:00Z
updated_at: 2026-05-16T00:00:00Z
related_themes:
  - merge-boundary-stacked-initiative-failure
  - objective-gate-autonomous-closure
---

# trafficGame — structural prerequisites for autonomy

trafficGame could not be progressed unattended by forge until it reached
a specific structural state. Each item below blocked real cycles and was
fixed before the three feature initiatives (world-graph-foundation/ux,
intersection-backpressure) ran clean (PM→dev→approve, 0 send-backs).

- **Test stack (C1).** The ~18k-LOC / 106-file suite (UI files ≈665
  lines) broke the per-iteration quality gate. The Phase-1
  rip-and-redraw to two layers (pure unit + app-owned e2e; HEAD commit
  `ee9b58f`) made the gate fast and trustworthy.
- **Scratch hygiene (C2).** `.forge/`, `AGENT.md`, `PROMPT.md`,
  `fix_plan.md` leaked into PRs until the project `.gitignore` excluded
  them; the W4 v3/v4 reviewer flagged this explicitly.
- **Source decomposition (C3).** Game.ts (1,732 LOC), TrafficMap (517),
  GameRenderState (32 fields) caused WI file-collisions. Phase-2 (5
  parallel extractions) and Phase-3 (CanvasScreen lifecycle,
  GameRenderState split, SimulationTimeScale delete — HEAD `9bf787b`)
  brought the tree under the project's ~150-LOC core norm.
- **Architecture context (C4).** The seven hand-authored
  `2026-05-10-*` snapshot themes + the bootstrapped `roadmap.md` gave
  the architect/PM a queryable model they previously lacked.
- **Locked-core respect (C5).** trafficGame's CLAUDE.md owns git, forbids
  modifying tests to pass, and uses per-map hand-calibrated thresholds.
  Forge had to switch to commit-not-reset to honour git ownership.

C1–C5 are met today. The residual blocker is **not** in trafficGame —
it is forge's merge model (C6 / stacked-PR conflicts): every approved
feature initiative is stranded unmerged in `_queue/done/`.

## Sources

- [`2026-05-16_trafficgame-arc-reflection.md`](../../../_raw/cycles/2026-05-16_trafficgame-arc-reflection.md) — cycle archive: structural-prerequisite synthesis.
- [`retro.md`](../../../../_logs/2026-05-16_trafficgame-arc-reflection/retro.md) — §3 contract clauses C1–C6 derived from trafficGame.

## Related

- [`recent-extractions-and-tech-debt`](2026-05-10-recent-extractions-and-tech-debt.md) — the god-file decomposition backlog (C3).
- [`test-stack-and-gates`](2026-05-10-test-stack-and-gates.md) — the suite weight that broke C1.
