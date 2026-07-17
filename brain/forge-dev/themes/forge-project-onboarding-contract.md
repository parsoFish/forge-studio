---
title: >-
  The forge↔project contract — six clauses a project must meet for unattended
  progress
description: >-
  Empirically derived from what trafficGame needed before forge could run it
  unattended. C1 fast gate, C2 scratch hygiene, C3 decomposed source, C4
  machine-readable arch context, C5 honoured locked-core mandates, C6
  satisfiable merge model (resolved post-Phase-6, no longer open).
category: decision
keywords:
  - contract
  - onboarding
  - preflight
  - quality-gate
  - gitignore
  - decomposition
  - roadmap
  - locked-core
  - merge-model
  - C1-C6
  - automated-cycles
created_at: 2026-05-16T00:00:00.000Z
updated_at: 2026-05-16T00:00:00.000Z
related_themes:
  - merge-boundary-stacked-initiative-failure
  - file-based-state-machine
  - quality-gates-orchestrator-verified
---

# The forge↔project contract

For forge to progress a project toward **more automated cycles with less
hand-holding**, the project must satisfy a contract. Not aspirational — each
clause generalises a specific trafficGame blocker fixed before unattended runs worked.

- **C1 — Fast, trustworthy quality gate.** One command, deterministic,
  green at HEAD, fast (≈≤10s). trafficGame's 18k-LOC/106-file suite
  broke the per-iteration gate until the Phase-1 rip-and-redraw.
- **C2 — Scratch hygiene.** Project `.gitignore` excludes `.forge/`,
  `AGENT.md`, `PROMPT.md`, `fix_plan.md`. Until it did, every cycle
  committed forge scratch into the PR and confused the reviewer.
- **C3 — Decomposed source under the project's own size norm.** Oversized
  god-files (Game.ts at 1,732 LOC) make work items collide on shared
  files; Phase-2/3 extractions were prerequisites for clean parallel WIs.
- **C4 — Machine-consumable architecture context.** A `roadmap.md` plus
  seeded brain themes. Without queryable structure (and with the F-37
  `cwd` bug) the architect/PM hallucinated paths.
- **C5 — Locked-core mandates the harness honours.** The project's
  CLAUDE.md constraints (e.g. trafficGame: user owns git, never modify
  tests to pass, per-map calibrated thresholds) must be respected;
  forge had to change to commit-not-reset to honour git ownership.
- **C6 — A satisfiable merge model (was OPEN; satisfied post-Phase-6, see
  "Deepened 2026-05-31" below).** Either initiatives serialize behind their
  base merge, or forge enforces non-stacked branches before `gh pr merge`.
  When this theme was written neither held — the proximate cause of
  "`done/` ≠ merged" and the then-live blocker to unattended operation.

This contract is the operator's durable deliverable from the trafficGame arc.
It should become a written preflight (closure goal G2) and, because it is
load-bearing, a candidate ADR-017. trafficGame met C1–C5 at the time.

## Deepened 2026-05-31 (betterado onboarding run)

Onboarding a Go infra provider showed the contract was directionally sound but
under-specified. See [`docs/forge-project-contract.md`](../../../docs/forge-project-contract.md) for the project-type-agnostic articulation; key deltas:

- **C1 is about *discrimination*.** The gate must FAIL before work exists and PASS only on real work. Scope the gate to the unit of change.
- **C2 generalises to *hermeticity*.** Ignore anything build/tools write into the tree; force-track config in ignored dirs.
- **New C7 — external-resource model**: creds-free in-loop gate + isolated self-cleaning live confirmation; API responses are machine evidence.

C1/C2 and C7 are **not yet machine-checked** by `forge preflight` (see [`docs/known-gaps.md`](../../../docs/known-gaps.md) §2026-05-31). C6 is now satisfied post-Phase-6.

**Clause-id collision (noted 2026-07-17, R5-07-F6):** this C7 (external-resource
model, landed in `docs/forge-project-contract.md`) is a **different** clause from
[[holistic-metrics-onboarding]]'s proposed-but-unlanded "C7 holistic metrics";
[R1-D1](../../../docs/roadmaps/R1-contract-componentry.md) resolves the numbering
on pick-up — that clause takes the next free id (e.g. C11), never C7.

## Sources

- [`2026-05-16_trafficgame-arc-reflection.md`](../../cycles/_raw/2026-05-16_trafficgame-arc-reflection.md) — cycle archive: the structural-prerequisite evidence.
- [`retro.md`](../../cycles/_raw/2026-05-16_trafficgame-arc-reflection.md) — §3 contract derivation, §6 closure goals G2/G6.

## See also

- [[merge-boundary-stacked-initiative-failure]] — C6, the clause that was open (now resolved post-Phase-6).
- [[file-based-state-machine]] — file-based state machine for queue management.
- [[quality-gates-orchestrator-verified]] — C1's enforcement mechanism.
