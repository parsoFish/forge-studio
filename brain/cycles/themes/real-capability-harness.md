---
title: Real-capability harness — self-verify forge against a real repo, on outcomes
description: >-
  Forge's standing regression gate is a real dogfood repo (claude-harness), not
  synthetic per-phase benches. A tiered, manually-gated runner re-runs a known
  initiative and asserts real-cycle OUTCOMES (reached PR/merge, dev-loop N/N,
  npm test green, goldens match, cost under ceiling) — never a rubric phases can
  overfit.
category: pattern
keywords:
  - regression-harness
  - real-cycle
  - dogfood
  - claude-harness
  - claude-trail
  - golden-file
  - outcome-assertion
  - tiered
  - manual-gate
  - frozen-sha
  - self-verification
created_at: 2026-05-30T12:00:00.000Z
updated_at: 2026-05-30T12:00:00.000Z
related_themes:
  - eval-driven-development
  - quality-gate-cmd-must-assert-new-work
  - objective-gate-autonomous-closure
  - cycle-event-log-replay
---

# Real-capability harness — self-verify forge against a real repo

How forge checks it can still ship a correct cycle before being pointed at a
real operator project: run a real cycle against a real dogfood repo and assert
the **outcomes**, not a synthetic rubric.

The dogfood repo is `claude-harness` (a TypeScript CLI at `projects/claude-harness/`),
built and operated autonomously by claude. Being forge's punching bag (~12 real
cycles) surfaced real defects unit tests missed: hardcoded `main...HEAD` gate diff,
no-origin assumptions, the hollow-gate arc, unifier wedging on resume, sparse-event
observability gaps. These live in the seams between phases and real-repo edge cases
that no phase-isolated fixture would produce.

## The discipline

- **Assert OUTCOMES, not rubrics.** A run checks only observable, binary,
  system-level facts: cycle reached `pr-open` / merge; dev-loop completed N/N WIs
  (no `complete:0, failed:N`); the project's own `npm test` is green post-merge;
  the golden trail files match byte-for-byte; cost is under a declared ceiling.
  Nothing scores agent behaviour or prose — so there is nothing for the phases to
  overfit.
- **Tiered.** *Routine:* frozen-SHA-per-initiative — reset the repo to a known
  base SHA, re-run one initiative, assert. Cheap, low-flake, deterministic.
  *Release:* full greenfield rebuild (initiatives 1→5 from empty), for major
  forge releases.
- **Manual gate.** Operator-initiated, run before betting forge on a real
  project (e.g. betterado). Not nightly, not CI-on-every-change — real cycles
  cost real money; the value is pre-flight assurance.
- **The corpus is the test suite.** Closed manifests
  (`_queue/done/INIT-...-claude-trail-*.md`) + reflection archives
  (`brain/cycles/_raw/*claude-trail*.md`) are reused as cases; new cycles extend
  it. The 5-initiative rebuild roadmap doubles as the corpus.

## Why this avoids the benches trap

The 2026-05-25 removal of `benchmarks/` warned that synthetic per-phase rubrics
teach phases toward the bench shape rather than measure outcomes. This harness
avoids the trap by construction: its only target is "did forge ship a correct,
cheap cycle against a real repo?" — no per-phase rubric, no threshold to game.
It is the real-cycle instantiation of `eval-driven-development`'s "full-cycle
runs measure *system* behaviour" clause. The `claude-harness` dogfood repo
exists so routine self-verification stays cheap and unambiguous.

## How to apply

- *Routine:* pick one corpus initiative, reset `claude-harness` to its pre-landing SHA, re-run it, and check outcomes.
- *Release:* run the greenfield 1→5 chain; breaks surface as golden mismatches.
- See [ADR 022](../../../docs/decisions/022-real-capability-harness.md) for the runner contract. The standing runner evolves in `scripts/verify-cycle.mjs`.

## See also

- [[eval-driven-development]] — full-cycle runs measure system behaviour; this
  is that clause promoted to a gate.
- [[quality-gate-cmd-must-assert-new-work]] — a real defect this harness class
  surfaced (hollow gate / gate-too-loose).
- [[objective-gate-autonomous-closure]] — outcome-only gating, same philosophy
  at the cycle-closure level.
- [[cycle-event-log-replay]] — the event log the harness reads to assert
  outcomes.
