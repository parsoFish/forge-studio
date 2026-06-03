---
stage: S2B (closure)
date: 2026-05-24
status: closed (bench surface + scoring + fixtures + harness migration); LLM-driven run operator-pending
contract_deps: [C10, C10a, C19, C26, C27]
amends: [02-architect.md, EXECUTION-PLAN.md (§S2B)]
---

# S2B closure — Architect bench reground + cross-phase handoff + cwc Amendment 1 gate

## What landed (deterministic — passes without API access)

### Across prior commits (2026-05-22 and earlier)

| Commit | Headline |
|---|---|
| `acf89d7` | `benchmarks/project-manager/scoring.frozen.ts` — frozen PM-bench rubric pinned at SHA `9585fba` (per C10a). Prevents PM-bench iteration from perturbing `downstream_pm_score`. |
| `f451082` | `benchmarks/_lib/handoff.ts` — single canonical handoff module (`loadArchitectHandoff` + `loadPmHandoff`, per C10). No `architect-handoff.ts` / `pm-handoff.ts` siblings. |
| `6afad11` | `benchmarks/architect/fixtures/betterado/{baseline-pre-s2a,refined-post-s2a}/` — discrimination snapshots: 3 manifests pre-S2A (no PLAN.md, copy-pasted council blocks), 3 manifests + PLAN.md post-S2A (brain reference, resolved escalations). Plus brain themes `council-constraints.md` + `release-substrate-context.md`. |
| `855a7c2` | Bench scoring rewritten: `project_context_lifted` (0.30) + `escalations_resolved` (0.25) + `downstream_pm_score` (0.30) + `specs_concrete_per_feature` (0.05) + `brain_consulted_qualified` (0.05). Per C19, no `aggregate_budget_declared`. Discrimination tests at `scoring.test.ts:439-484`. |
| `9120a05` | `benchmarks/architect/prompts.json` adds B1 (`B1-betterado-substrate-only`) + B2 (`B2-betterado-full-program`). `score.ts` writes handoff dirs at `results/<iso>/<fixtureId>/{manifest.md,plan-doc.md,council-transcript.md}` consumable by `loadArchitectHandoff`. |

### This session (2026-05-24, cwc-driven amendments)

| Change | Files |
|---|---|
| **`interview_section_present` criterion** (cwc Amendment 1 follow-up — see [S2A-CWC-AMENDMENTS.md](./S2A-CWC-AMENDMENTS.md)) — small weight (0.05); specs halved 0.10 → 0.05 to keep total at 1.0. Detects `## Operator brief + interview` heading with non-empty body (Q&A table OR explicit "operator drafted directly" notice OR paraphrase paragraph). Auto-passes when PLAN.md absent. | `benchmarks/architect/scoring.ts`, `score.ts`, `scoring.test.ts` (+8 cases) |
| **Bench harness migrated** from `_queue/pending/` → `projects/<name>/_architect/<session-id>/manifests/` (per C12). `setupTempdir` scaffolds the `_architect/` dir; `findManifest` / `collectSiblings` read from session manifests/ subdir with `_queue/pending/` retained as legacy fallback. User prompt rewritten to instruct the agent to write to the post-S2A surface + emit PLAN.md with required H2 sections + skip `AskUserQuestion` (bench is non-interactive). | `benchmarks/architect/sdk.ts`, `sdk.test.ts` (+1 case, paths updated) |
| **Discrimination fixture updated** — `refined-post-s2a/PLAN.md` heading renamed `## Vision recap` → `## Operator brief + interview` + interview Q&A table added (3 rows). Pre-S2A baseline left untouched as the legacy comparison. | `benchmarks/architect/fixtures/betterado/refined-post-s2a/PLAN.md` |

### Tests

`npm test` after this landing: **747 pass / 1 deliberate skip / 0 fail**. Specifically:
- All `scoring.test.ts` cases pass — including:
  - The discrimination tests (`pre-S2A baseline must score below 0.7` + `post-S2A refined must score ≥ 0.7`) against the betterado fixtures.
  - 8 new `interview_section_present` cases (undefined, empty, present-with-rounds, empty-rounds notice, paraphrase-only, missing-heading, empty-body, `Operator brief and interview` spelling variant).
  - Weight-sum-to-1 invariant including the new `WEIGHT_INTERVIEW`.
- All `sdk.test.ts` cases pass — including the new `_architect/<sid>/` happy path + the legacy `_queue/pending/` fallback.

`npm run build` (`tsc`): clean.

## What's operator-pending (API-blocked)

The deterministic acceptance criteria for S2B are met. The remaining join-step item is the **LLM-driven bench run** against the live architect SKILL:

- `npm run bench:architect` — spawns the architect via SDK against the Anthropic API.
- Same API-key blocker as the brain-bench wake-up item from the 2026-05-23 closure ([BRAIN-STAGE-CLOSURE.md](../2026-05-23-brain-refinement/BRAIN-STAGE-CLOSURE.md) §"Operator-pending items #2"): the OAuth token in the harness sandbox doesn't authenticate the direct API.
- When run by the operator: expectation per EXECUTION-PLAN.md S2B join → S3 step:
  - All 10 fixtures (A1–A8 + B1 + B2) pass ≥ 0.7.
  - B1 emits a PLAN.md with an `## Operator brief + interview` section + the betterado-INIT-01 manifest under `_architect/<sid>/manifests/`.
  - B2 emits 20 manifests + a PLAN.md surfacing aggregate footprint informationally (C19 vocabulary respected).

If the live run reveals a discrimination regression (e.g. the live architect at HEAD scores below the post-S2A fixture), the gap is logged as a cycle archive + cycle-bench-candidate per [01b refinements #6-#7](./01-brain.md). It does not block S3.

## S2B → S3 join

Per [EXECUTION-PLAN.md](./EXECUTION-PLAN.md) §S2B → S3:

> `benchmarks/_lib/handoff.ts` exports load functions; `loadArchitectHandoff('B1-betterado-substrate-only')` returns the manifest + plan-doc + transcript triple.

✅ Landed in `f451082`. The PM bench can now consume the architect's B1 output as input via the optional `from_architect` field in PM `cases.json` (S3's job to wire).

> A real `/forge-architect terraform-provider-betterado` session emits one PLAN.md, zero `_queue/pending/` writes; `architect commit --approve` produces the manifests with per-feature `quality_gate_cmd`, `non_goals`, `hard_constraints` (per C4) populated.

⏳ The bench harness is **wired** for this shape; a real live session is operator-pending (same API blocker).

## Risk notes captured for S3

- **PM bench's `cases.json`** gains an optional `from_architect: <fixtureId>` field per C10. The PM bench harness's fixture loader should call `loadArchitectHandoff(fixtureId)` when this is set. Pre-existing `9585fba` PM-bench shape is frozen via `scoring.frozen.ts` — S3 can iterate the live PM-bench rubric without perturbing architect's `downstream_pm_score`.
- The `interview_section_present` gate fires only when PLAN.md is present. Architect bench runs that error out before PLAN.md emission will silently auto-pass this criterion — that's by design (the manifest_valid gate already catches those).
- The bench user prompt now instructs the agent to use session id `2026-05-24T00-00-00` literally; B2's 20-manifest expectation collides with `multiple_manifests_written` error detection. Future B2 acceptance work will need to expand the runner-error taxonomy or special-case B2 in `score.ts` (out of S2B scope).
