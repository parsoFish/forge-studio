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
  - phase-isolation-benchmarks
  - quality-gate-cmd-must-assert-new-work
  - objective-gate-autonomous-closure
  - cycle-event-log-replay
---

# Real-capability harness — self-verify forge against a real repo

How forge checks it can still ship a correct cycle before being pointed at a
real operator project: run a real cycle against a real dogfood repo and assert
the **outcomes**, not a synthetic rubric.

The dogfood repo is `claude-harness` (the `claude-trail` CLI at
`projects/claude-harness/`) — a zero-runtime-dependency TypeScript CLI built and
operated autonomously by claude so the operator's real projects stay clean.
Being forge's punching bag (~203 tests, ~12 real cycles) surfaced **real forge
defects unit tests and the old synthetic benches missed**: a hardcoded
`main...HEAD` gate diff (broke on master-default repos), no-origin assumptions,
the hollow-gate / `gate-too-loose` arc, unifier wedging on resume, sparse-event
observability gaps. These live in the seams between phases and in real-repo edge
cases (default branch, remote, resume state) — no phase-isolated fixture would
produce them.

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

## Why this is NOT the 2026-05-25 benches trap

The 2026-05-25 removal of `benchmarks/` warned that synthetic per-phase rubrics
were starting to **teach the phases toward the bench shape** rather than measure
real-cycle outcomes. A real-capability harness avoids the trap by construction:
its only target is "did forge ship a correct, cheap cycle against a real repo?" —
no per-phase rubric, no threshold to game, no hand-curated fixture to overfit,
just a real repo, real git history, and binary outcome assertions. It is the
real-cycle instantiation of `eval-driven-development`'s "full-cycle runs measure
*system* behaviour" clause, promoted to a codified gate. The synthetic phase
benches stay retired; this replaces them.

The negative example —
`brain/cycles/_raw/2026-05-23_betterado-init01-dogfood-abandoned-arc.md` — is why
the *routine* target is not a real operator project: too expensive and
taste-driven to re-run cheaply. The arm's-length, binary-acceptance
`claude-harness` exists precisely so routine self-verification stays cheap and
unambiguous.

## How to apply

- *Routine:* pick one corpus initiative, reset `claude-harness` to its
  pre-landing SHA, re-run it, diff its golden + check the outcome set.
- *Release:* run the greenfield 1→5 chain; a break in any earlier initiative's
  output shape surfaces downstream as a golden mismatch.
- See [ADR 022](../../../docs/decisions/022-real-capability-harness.md) for the
  decision + runner contract (inputs: corpus manifest + base SHA + tier + cost
  ceiling; outputs: pass/fail per outcome assertion + realised cost) and
  [the rebuild ROADMAP](../../../docs/planning/2026-05-30-claude-trail-rebuild/ROADMAP.md)
  for the decomposition. The standing runner is codified separately by evolving
  `scripts/verify-cycle.mjs`.

## See also

- [[eval-driven-development]] — full-cycle runs measure system behaviour; this
  is that clause promoted to a gate.
- [[phase-isolation-benchmarks]] — the synthetic counterpart this replaces (now
  retired).
- [[quality-gate-cmd-must-assert-new-work]] — a real defect this harness class
  surfaced (hollow gate / gate-too-loose).
- [[objective-gate-autonomous-closure]] — outcome-only gating, same philosophy
  at the cycle-closure level.
- [[cycle-event-log-replay]] — the event log the harness reads to assert
  outcomes.
