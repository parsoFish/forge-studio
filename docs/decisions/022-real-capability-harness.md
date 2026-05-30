# ADR 022 — claude-harness as forge's standing real-capability regression harness

- **Status:** accepted
- **Date:** 2026-05-30
- **Supersedes / amends:** amends the 2026-05-25 "benches removed" stance in
  [`CLAUDE.md`](../../CLAUDE.md) (search "bench harnesses were removed") and
  reframes [`phase-isolation-benchmarks`](../../brain/cycles/themes/phase-isolation-benchmarks.md)
  + [`eval-driven-development`](../../brain/cycles/themes/eval-driven-development.md):
  the *synthetic per-phase* benches stay retired; a *real-cycle* harness replaces
  them. Builds on [ADR 017](./017-forge-project-contract.md) (the project
  contract a harness run asserts against) and [ADR 019](./019-cycle-resume-from-unifier.md)
  (resume semantics a tiered run must respect).

## Context

On 2026-05-25 forge removed the per-phase + e2e bench harnesses under
`benchmarks/`. The stated reason (preserved in `CLAUDE.md`): they had grown into
"a set of synthetic rubrics and thresholds that were starting to *teach* the
phases toward the bench shape rather than measure real-cycle outcomes — the
opposite of the intent." The closing note promised benches would be "rebuilt
later, anchored on actual past successful cycle artifacts rather than
hand-curated fixtures."

Since then the `claude-harness` project (the `claude-trail` CLI at
`projects/claude-harness/`) has, as a side effect of being forge's dogfood
target, become exactly that: a real repository that forge cycles run against
end-to-end. It is a zero-runtime-dependency TypeScript CLI
(`node --experimental-strip-types`, `node:test`) — ~203 tests green across ~12
real cycles. Crucially, running forge against it has surfaced **real forge
defects that unit tests and the old synthetic benches never caught**:

- a hardcoded `main...HEAD` gate diff that broke on master-default repos;
- no-origin-remote assumptions in closure;
- the "hollow gate / gate-too-loose" arc — WIs passing `npm test` while
  producing no files (see
  [`quality-gate-cmd-must-assert-new-work`](../../brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md)),
  forcing `quality_gate_cmd` + an iter-0-gate-must-fail check;
- unifier wedging on resume (`gate-too-loose`, 0 iterations — see the
  `verify-cascade-v4` archive);
- sparse-event-log observability gaps.

These are *system* behaviours. No phase-isolated synthetic fixture would have
produced them, because they live in the seams between phases and in the
real-repo edge cases (default branch name, remote presence, resume state).

The corpus to drive this already exists and is greppable:

- 10 closed initiative manifests at
  `_queue/done/INIT-2026-05-2*-claude-trail-*.md`;
- 8 reflection archives at `brain/cycles/_raw/*claude-trail*.md`;
- the abandoned betterado dogfood arc at
  `brain/cycles/_raw/2026-05-23_betterado-init01-dogfood-abandoned-arc.md`
  (the negative example: a real project is too costly/taste-driven to be the
  *routine* regression target — which is why `claude-harness` exists).

## Decision

**`claude-harness` is forge's standing real-capability regression harness.** It
is the gate forge passes before being pointed at a real operator project.

**1. It asserts real-cycle OUTCOMES, not synthetic rubrics.** This is the line
that keeps it out of the 2026-05-25 trap. A harness run asserts only
observable, binary, system-level outcomes:

- the cycle reached `pr-open` / merge (not abandoned, not wedged);
- the dev-loop completed N/N work items (no `complete:0, failed:N`);
- the project's own `npm test` is green **post-merge** on the harness repo;
- the golden trail files (`*.trail.golden.md`) the cycle should produce are
  present and match byte-for-byte;
- total cycle cost is under a declared ceiling.

It does **not** score token-level agent behaviour, prose quality, or any
hand-curated rubric. There is nothing for the phases to "teach toward" because
the only target is "did forge ship a correct cycle against a real repo, cheaply."
This is the real-cycle instantiation of
[`eval-driven-development`](../../brain/cycles/themes/eval-driven-development.md)'s
"occasional full-cycle runs measure *system* behaviour" clause — promoted from
occasional to a codified gate.

**2. Mode is TIERED.**

- **Routine tier — frozen-SHA-per-initiative.** Reset the `claude-harness` repo
  to a known base SHA, re-run *one* initiative from the corpus, assert its
  outcomes. Cheap, low-flake (one cycle, deterministic base, one golden set).
  This is the everyday verification.
- **Release tier — full greenfield rebuild.** Run initiatives 1→5 from an empty
  repo (the roadmap below), reconstructing `claude-trail` from scratch. Reserved
  for major forge releases — expensive, exercises the whole pipeline including
  scaffold-from-nothing and cross-cycle dependency ordering.

**3. Trigger is a MANUAL GATE.** Operator-initiated. It runs as the gate *before
pointing forge at a real project* (e.g. betterado). It is **not** nightly, and
**not** CI-on-every-change — running real cycles costs real money and the value
is the pre-flight assurance, not continuous noise.

**4. A standing runner will be codified separately** by evolving
`scripts/verify-cycle.mjs` (the operator owns that work; this ADR does not write
runner code). The runner's **contract** is:

- **Inputs:**
  - an initiative manifest drawn from the corpus
    (`_queue/done/INIT-...-claude-trail-*.md`);
  - a base SHA for the `claude-harness` repo (routine tier) **or** the
    empty-repo marker (release tier);
  - the tier selector (`routine` | `release`);
  - the cost ceiling for the run.
- **Behaviour:** reset the harness repo to the base SHA (routine) or init empty
  (release), enqueue the initiative(s), run the real forge pipeline
  (PM → dev-loop → unifier → review → closure) with auto-approve so it stays
  unattended, then evaluate the outcome assertions in (1).
- **Outputs:** a pass/fail verdict per outcome assertion, the realised cost vs
  ceiling, and the artifact bundle (events.jsonl rollup, golden diff, PR URL)
  for operator inspection — the same shapes `verify-cycle.mjs` already records
  under `forge-ui/.demo-shots/verify/`.
- **Failure semantics:** any failed assertion fails the gate; a wedged or
  resumed-to-empty cycle (`complete:0`) is an explicit fail, not an indeterminate.

## Consequences

- **A real pre-flight gate exists again, without the teaching trap.** Forge gets
  a "can it still ship a correct, cheap cycle against a real repo?" check that is
  outcome-only, so phases can't overfit it.
- **The corpus is the test suite.** Closed manifests + reflection archives are
  reused as regression cases; new cycles extend the corpus naturally (the
  roadmap initiatives double as cases — see the ROADMAP).
- **Cheap by default, thorough on demand.** Routine frozen-SHA runs are one
  deterministic cycle; the expensive full rebuild is reserved for releases.
- **No drift from real-world.** Because the target is a real repo with real git
  history, default-branch / remote / resume edge cases are exercised for free —
  exactly the class of defect the synthetic benches missed.
- **Bounded operator cost.** Manual-gate trigger means runs happen when the
  operator is about to bet on forge (e.g. before betterado), not continuously.
- **The 2026-05-25 note is amended, not reversed.** Synthetic per-phase benches
  stay dead; what returns is a real-cycle harness. `CLAUDE.md` should link here
  so the nuance survives.

## Alternatives considered

- **Rebuild the synthetic per-phase benches.** Rejected — this is precisely the
  2026-05-25 trap (phases overfit the rubric). Outcome-only real cycles avoid it.
- **Point routine verification at a real operator project (betterado).**
  Rejected — taste-driven / expensive / mutates the operator's real work; the
  abandoned betterado dogfood arc is the evidence. The whole point of
  `claude-harness` is an arm's-length, binary-acceptance target.
- **CI-on-every-change.** Rejected — real cycles cost money and the value is the
  pre-flight assurance, not continuous signal; a manual gate fits unattended
  operation's economics.
- **Full greenfield rebuild every time.** Rejected as the routine mode — too
  expensive and flakier; kept as the release-tier mode only.
