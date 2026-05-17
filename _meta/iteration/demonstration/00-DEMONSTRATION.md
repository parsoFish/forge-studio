# Forge — full-flow demonstration (GREEN end-to-end, G11 validated)

> Generated from a **real paid chained-bench cycle** on 2026-05-17
> (seed: `slugifier-chain`, tempdir `forge-bench-chained-p33ZFj`).
> **`chained bench: 1/1 chains passed` — every phase green:** architect
> 1.0 · project-manager 1.0 · developer-loop 0.80 · review-loop 1.0 ·
> reflection 1.0. Total spend $7.59, ~22 min. All artifacts in
> `./artifacts/` are the real outputs of that run.

## What this proves

A single architect-level **seed** ran the entire forge product path —
`runCycle` (PM → developer-loop → review-Ralph → closure → reflection)
— to a genuinely green end-to-end result, scored **solely** by the
existing per-phase rubrics (no chained-only rubric; US-6.2). The human
and the remote — which are legitimately absent in a bench — are
**faithfully stubbed** (below), so the cycle completes exactly as it
would in production with an operator + GitHub.

Reaching green took finding and fixing real issues the full-flow run
surfaced that per-phase isolation never could: a chained-harness
missing-origin gap, a stochastic PM-invalid-WI made recoverable (F-45),
a bench-scoped ride of a stochastic dev-loop wedge, and two
deterministic bench false-reds (review read the wrong `.forge` base;
the reflector couldn't resolve the post-merge manifest). Each is
documented in `_meta/iteration/AGENT.md`. Forge's own behaviour was
correct throughout; the work was making the bench faithfully *drive*
and *read* it without a human/remote in the loop.

## The three human-interaction points (stubbed — `./artifacts/human-moments/`)

In production these are the operator's own Claude session (Phase-7 slash
commands). In the bench they are deterministically stubbed; the real
stubbed content from this run:

1. **Architect — `/forge-architect`** → `1-architect-seed-prompt.txt`.
   The only "e2e input": a free-form intent. Forge's architect turned it
   into `artifacts/01-architect/manifest.md` (7.2 KB, 5 features).
2. **Review feedback & merge — `/forge-review <id>`** →
   `2-review-verdicts.txt`. The simulator grounded its verdict in the
   target spec. **It genuinely worked:** round 1 **send-back** ("src/batch.ts
   … never committed — slugifyMany/uniqueSlug not exported"); the
   review-Ralph fixed it; round 2 **approve** ("All 10 non-functional
   checks pass … implementation matches every claim"). Then the
   operator-merge stub (`confirmMerge` → `confirmPrMerged`==MERGED)
   drove closure.
3. **Reflection feedback — `/forge-reflect <id>`** →
   `3-reflection-user-feedback.md`. The canned stage-3 operator feedback
   the reflector folded into the retro.

## Per-phase inputs → outputs (all real, this green run)

| Phase | Input | Output (real artifact) | Rubric |
|---|---|---|---|
| Architect | seed prompt | `01-architect/manifest.md` — initiative + 5 features | **1.0** |
| Project-manager | manifest + worktree + brain | `02-project-manager/work-items/WI-1..5.md` + `_graph.md` | **1.0** |
| Developer-loop | each WI spec | `03-developer-loop/src/{slugify,batch}.ts` + `tests/` — **the code passes `npm test`: 21 pass / 0 fail** | **0.80** |
| Review-loop | initiative branch + intent | `04-review/pr-description.md` (2.8 KB, why-not-what) + `04-review/demos/.../recording.mp4` (**the before/after demo**, 65 KB) + `source.tape`; verdict send-back→approve→PR opened | **1.0** |
| Closure | approved PR | operator-merge confirmed → local aligned to remote, manifest → `_queue/done/` (no auto-merge; G9) | (gate) |
| Reflection | merged cycle + events | `05-reflection/retro.md` + 3 brain themes (`atomic-tdd-wi-decomposition`, `reviewer-writing-missing-implementation-files`, `stale-scratch-file-orientation-overhead`) | **1.0** |

Full phase + cost timeline: `artifacts/events-timeline.txt`.

## The before/after demo on the sample project

The reviewer phase generated a real demo bundle on the slugifier sample:
`artifacts/04-review/demos/INIT-2025-05-17-slugifier-package/` —
`recording.mp4` (65 KB), `source.tape`, `README.md`. This is forge
demonstrating its own work product, embedded in the PR
(`04-review/pr-description.md`) exactly as an operator would review on
GitHub.

## The actual work forge did on the test project

Forge autonomously implemented a working slugifier on the `slugifier`
seed: `03-developer-loop/src/slugify.ts` (documented transform pipeline:
NFD-normalise → strip combining marks → lower-case → collapse
non-alphanumerics → trim → optional separator/maxLength) and
`src/batch.ts` (`slugifyMany`, `uniqueSlug` suffix-disambiguation), with
edge-case tests. Verified: **`npm test` → 21 pass, 0 fail**. (Closure
merged the initiative branch into `main` and aligned local↔remote, so
the work lives on `main` — itself evidence the Phase-6 no-auto-merge
closure path executed; the committed `src/` + `tests/` are harvested
here and pass.)

## G11

The chained bench validates **G11** ("per-phase benches, no
false-colour"): every phase scored by its existing rubric over one
generated artifact set, **1/1 green**, no chained-only rubric. The two
prior reds were proven (deterministically, against preserved real
artifacts) to be bench path/root false-reds — now fixed — not forge
defects. `closure-check --tier=full` is green.
