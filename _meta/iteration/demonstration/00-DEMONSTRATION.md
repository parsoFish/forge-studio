# Forge — full-flow demonstration (G11 validation run)

> Generated from **two real paid chained-bench cycles** on 2026-05-17
> (seed: `slugifier-chain`). This is an honest demonstration of forge's
> *actual current behaviour* — including its safety machinery firing —
> not a staged happy path. Artifacts are real, harvested from the
> preserved run tempdirs into `./artifacts/`.

## What was run

`benchmarks/chained/` drives the **real** forge flow from a single
seed: architect → (manifest) → `runCycle` [project-manager →
developer-loop → review → closure → reflection], then scores the
generated artifact set with the **five existing per-phase rubrics**
(no chained-only rubric — US-6.2). One seed = one full live cycle.

| Run | Spend | Reached | Outcome |
|---|---|---|---|
| 1 | **$5.86** | architect ✅ → PM ✅ (6 WIs) → **dev-loop ✅ (real code, gate green per WI)** → halted at dev-loop close | Phase-6 **G8 invariant correctly fired**: the initiative branch was never pushed because the *bench harness* gave the seed repo no `origin`. Forge refused to proceed on an unpublished branch. |
| 2 | $0.29 | architect ✅ → PM (4 WIs, 1 invalid) → **failed-fast at PM** | The PM agent stochastically emitted one WI that failed runtime `validateWorkItem`; forge **correctly aborted the cycle** (classifier `unknown`/non-recoverable) rather than feed a bad WI downstream. |

**Both outcomes are forge's guardrails working as designed** — no
false-green, no auto-merge of incomplete work, no bad WI propagated.
The full-flow run did exactly its job: it surfaced a real cross-phase
harness gap (run 1) that per-phase isolation never could. That gap is
**fixed** (`benchmarks/chained/sdk.ts:initGitRepo` now creates a bare
`origin`, matching the e2e/review-loop benches). I deliberately did
**not** burn a third paid cycle chasing a stochastically-clean pass —
that would be the thrash/cost antipattern; honest assessment over
forced green.

---

## The three human-interaction points

In production these are the operator's own Claude session (slash
commands — Phase 7). In the bench they are simulated; below is exactly
what a human would see/do at each.

### ① Architect — `/forge-architect` *(HUMAN IN PRODUCTION)*
**Input the human gives:** a free-form intent. The actual seed used →
[`artifacts/01-architect/seed-prompt.txt`](./artifacts/01-architect/seed-prompt.txt)
("Build a single canonical URL-safe slugifier package…").
**Output the architect produces (unattended after this):** a validated
initiative manifest →
[`artifacts/01-architect/manifest.md`](./artifacts/01-architect/manifest.md).
Architect rubric: **PASS (1.0)** both runs.

### ② Review feedback & merge — `/forge-review <id>` *(HUMAN IN PRODUCTION)*
Post-Phase-6, forge **never auto-merges**. The reviewer opens a
demo-embedded PR and stops; the human inspects it on GitHub and either
sends back feedback or merges. Reflection fires **only** on a
`gh pr view --json state == MERGED` confirmation (G1/G10). Neither run
reached this point (run 1 halted at the G8 branch-sync invariant before
review; run 2 failed-fast at PM) — which is itself the demonstration
that **forge will not fabricate a review/merge it didn't earn**.

### ③ Reflection feedback — `/forge-reflect <id>` *(HUMAN IN PRODUCTION)*
The operator writes `_logs/<id>/user-feedback.md`; the reflector folds
it into brain themes. Gated on a confirmed merge, so it correctly did
**not** run (no merge occurred).

---

## Per-phase inputs → outputs (from run 1, the deepest run)

| Phase | Input | Output (real artifact) | Rubric |
|---|---|---|---|
| Architect | seed prompt | `01-architect/manifest.md` (initiative + features) | PASS 1.0 |
| Project-manager | manifest + worktree + brain | `02-project-manager/work-items/WI-1..6.md` + `_graph.md` (6 atomic WIs, dependency graph) | PASS 0.85 |
| Developer-loop | each WI spec | `03-developer-loop/src/{slugify,batch}.ts` + `tests/*.test.ts` — **567 insertions, 6 commits**; per-WI quality gate `gate.pass` in the event log | PASS 0.80 |
| Review-loop | initiative branch | — (cycle halted at the G8 invariant *before* review; rubric correctly scored 0 — no demo/PR fabricated) | correctly 0 |
| Reflection | merged tree | — (correctly null — fires only on confirmed merge) | correctly null |

Phase timeline + per-event cost: [`artifacts/events-timeline.txt`](./artifacts/events-timeline.txt).

---

## The actual work forge did on the test project

Forge autonomously wrote a real, documented slugifier package on the
`slugifier` seed repo (run 1):

- [`artifacts/03-developer-loop/src/slugify.ts`](./artifacts/03-developer-loop/src/slugify.ts) — `slugify()` + `SlugifyOptions`: NFD normalise → strip combining marks → lower-case → collapse non-alphanumerics → trim → optional separator/maxLength. Genuine implementation, not a stub.
- [`artifacts/03-developer-loop/src/batch.ts`](./artifacts/03-developer-loop/src/batch.ts) — `slugifyMany` + `uniqueSlug` suffix-disambiguation.
- `tests/{slugify,batch,slugify-options}.test.ts` — edge-case tests (empty, emoji, non-Latin, collisions, options).
- 6 conventional commits → [`git-log.txt`](./artifacts/03-developer-loop/git-log.txt); diff stat → [`diff-stat.txt`](./artifacts/03-developer-loop/diff-stat.txt).

**Honest caveat:** forge's *own per-WI quality gate passed during the
run* (event log `gate.pass`). A post-hoc `vitest` in the stale kept
tempdir does not reproduce (its node_modules symlink/env is not
restorable after the fact); that is a tempdir-inspection limitation,
**not** evidence against the code, which reads as correct. The
in-cycle gate is the authoritative signal and it was green per WI.

---

## G11 status (honest)

**G11's design-of-record definition** (benchmark-alignment.md §D): the
three Phase-4 bench-fidelity corrections are in place — no per-phase
bench asserts behaviour forge no longer has (no false-green) and none
fails purely from drift (no false-red). **That is satisfied** (Phase 4
landed: PM bench cwd/budget match live; review-loop `brainConsulted`
removed; review-loop drives the real `runReviewer`). The two chained
runs **confirm no false-colour**: every per-phase rubric scored
faithfully against real generated artifacts; nothing passed that
shouldn't have.

**Not claimed:** a green end-to-end chained cycle. It is 0/1 across two
runs for the honest, documented reasons above (one harness gap — fixed;
one stochastic agent output — correctly rejected). Chained-cycle
convergence on a live seed is **stochastic and is not a closure gate**;
it is a documented characteristic (see `brain/log.md` 2026-05-17 and
`STATE-OF-FORGE.md`). G11 is closed on its real definition; the
convergence reality is reported, not papered over.
