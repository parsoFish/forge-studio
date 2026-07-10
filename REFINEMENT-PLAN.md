# Forge Refinement Roadmap — post-betterado cycle (2026-07-04)

**Inputs:** 40-entry friction log (`docs/investigations/2026-07-betterado-run-friction.md`), 47 new brain themes from the run, operator cycle notes, the platform user-flow diagram (Flows / Skills / Agents / Knowledge-base pillars), code-grounding of every observed UI defect, and a fresh survey of the Ralph-loop best-practice standard.

**Lens (operator-set):** remove guardrails over adding new ones; simplify and tighten forge as an agentic flow-building platform. Every phase below is judged against that lens plus the north star (unattended operation, battle-tested tools, simplest thing that works).

---

## 1. The cost verdict: complexity is not the root

The betterado roadmap cost **≈ $926 across 53 initiatives (44 merged)** — median ≈ $20/initiative, top item $59.76 (serviceendpoint). For full framework migrations of entire API surfaces per initiative, the baseline is *reasonable*. The waste is itemizable and has specific, fixable causes:

| Waste class | Evidence | Approx. direct cost |
|---|---|---|
| PM max-turns / zero-WI runs (5 themes) | $1.45 + $0.89 + $1.11 + $3.20 + retries | ~$7–10 |
| Unifier unbounded restart loops (16× twice, no events) | 2 themes, ~$8–16 each | ~$16–32 |
| Dead-SDKv2-files recurrence — 7 consecutive cycles, incl. one full second dev-loop pass | 7 themes | ~$25–35 |
| Re-derivation per WI (plan-modifier, config-validator, wiki API shapes, fixture rules — brainReads=0 by design, PM never compiled the rules into specs) | 5 themes, ≥4 extra iterations each occurrence | ~10–15% of dev spend |
| Evidence-fabrication arms race (rounds 2–4, nonce/mtime escalation) | friction log | multi-$ rework rounds |

**Conclusion:** the root is not forge's complexity — it is (a) a **knowledge-flow gap** (the planner is the only legal carrier of brain/profile constraints into the dev loop, and it doesn't compile them into WI specs), and (b) **missing honesty at failure boundaries** (unbounded retries, no gate-failure events, a failure classifier that reports the wrong cause). Both are simplification problems, not add-more-guardrails problems.

**Positive signals to protect (do not regress):** front-loaded demo contracts produced first-pass-authentic evidence (gallery cycle); the iter-0 `already-complete` guard ($0 catch); the manifest "decomposition completeness annotation" (forced full 30-type coverage); nonce+artifact binding as the durable anti-fabrication fix.

---

## 2. Guardrails to REMOVE (the lens, applied)

| # | Guardrail | Why it fails | Replacement |
|---|---|---|---|
| G1 | `autoCommitWorktreeIfDirty` (`loops/ralph/runner.ts`) commits dirty state even when gates are red | Violates the Ralph hard rule "no commit unless everything passes"; how scratch/fabricated state reached branches | Agent commits only; auto-commit only after a green gate, else discard-or-surface |
| G2 | `NO_WORK_INDICATORS` / `WORK_HAPPENED_PATTERNS` heuristic string scans (`loops/ralph/stop-conditions.ts:158-189`) | Heuristic; superseded by deterministic contracts (nonce/artifact binding, `requiredPaths`) | Keep `requiredPaths` + demo contract; delete the string heuristics they superseded |
| G3 | Crash-retry of crash-before-first-tool (unifier, `tool_use_count:0`) | Retrying an identical launch cannot fix a process crash — both retries also crashed | Detect `tool_use_count===0` → skip retry, escalate to cycle-restart directly |
| G4 | Unbounded unifier resume loop (16 restarts, zero events, 2 occurrences) | Implicit infinite retry is a guardrail pretending to be resilience | Cap ≈3 consecutive same-gate failures → emit `uwi.gate-failed` (gate name + output) → human gate |
| G5 | Failure-classifier full-history scan, first-match-wins (`orchestrator/failure-classifier.ts:28-114`) | One stale `pm.empty-decomposition` event permanently masks every later failure ("PM emitted zero work items" shown for everything) | Window classification to the current phase/attempt only |
| G6 | `fanOut`-forbidden-on-entry-node lint rule (`orchestrator/studio/validate.ts:262-278`) | Forces the flow definition to lie — dev node fans out at runtime, checkbox structurally stuck unchecked | Definition states truth: `fanOut: true` on the dev node; runtime honors the flag (see 4.2) |
| G7 | Per-initiative architect plan-gates during a roadmap wave | 23 initiatives × operator block = false-block spam; holdover from the 1-flow→3-flow split | One roadmap-level PLAN gate; per-initiative kickoff moves to the roadmap page (see Phase 3) |
| G8 | `headroom_retrieve` retry spiral in PM (4 runs, ~$3.2, ~18h) | Cache-miss fallback loops instead of degrading | Cap at 1 retry → plain `Read` fallback |
| G9 | Hardcoded `gate = 'review'` for any gated run (`orchestrator/run-model.ts:419`) | Pre-split relic; architect `plan` gate lights the wrong node in the wrong flow | Derive gated node id from the flow definition |
| G10 | `parallel golangci-lint is running` treated as terminal lint failure | Cost a full wasted dev-loop pass | Classify as transient → bounded backoff retry |

---

## 3. Phase 0 — Close out the betterado run (baseline, before any refinement)

1. **Reflection backlog:** 10 done initiatives have no `brain/cycles/_raw` archive (list in §9); run `forge-reflect` for each. **33 of 35 cycles have unanswered `user-questions.json`** — triage with a `reflection-triage` skill pass (batch-answerable from artifacts vs. genuinely-operator questions), answer, re-run reflectors.
2. **Queue tail:** review/merge the 3 `ready-for-review` PRs (core, gallery-extensionmanagement, pipelinesapproval). Hold the 3 `pending` (taskagent, workitemtrackingprocess, mux-free-cutover) until after Phase 1–3 — they become the validation cycle (Phase 6).
3. **Commit** the ~26 untracked brain themes + raw archives sitting in git status.

## 4. Phase 1 — Honest instruments (fix the window before changing the machine)

All grounded; none are mysteries. One PR-sized item each:

1. **Failure classifier windowing** — G5. Kills the universal wrong error message.
2. **Gate-node derivation** — G9. Kills architect false-blocks in the monitor.
3. **Flow-swap flicker unification** — three compounding defects in `forge-ui/app/flows/[id]/page.tsx` + `orchestrator/run-model.ts:224-280`: stale `runs` state not reset on route change; sticky-selection key scoped per-flow (misses on tab swap → snaps to top); `buildFlowNodeSets` silently degrading to empty map on any read error, collapsing lineage (why completed-architect runs vanish). Fix as one "run-list model" consolidation. *(Note: the "different initiative constantly selected" observation is this — `pickDefaultRun` re-firing after lineage collapse — not agent monitoring actions.)*
4. **Per-WI cost attribution** — events already carry `work_item_id`; bucket `cost_usd` by it in `run-model-derive.ts` (today WI cost doesn't exist and `PhaseDrawer.tsx:60-61` silently falls back to the aggregated dev-node meta — the observed bug).
5. **WI dependency DAG layout** — `monitor-layout.ts:123-169` stacks WIs vertically in one column; `dependsOn` is already populated but unused. Apply the existing `dep-layout.ts` topo pass to the WI sub-graph: dependency chains left→right, parallel-eligible WIs stacked top→bottom, edges drawn. This also becomes the visual for Phase 4 parallel execution.
6. **Roadmap page rework** —
   - Real titles: architect emits `title:` frontmatter per initiative manifest; fix the `^##?` regex (grabs the boilerplate `## Goal` heading) in `cli/bridge-studio.ts:819` **and** `orchestrator/run-model.ts:503-506`.
   - Dependency-ordered progress line: `topoLevels` is already computed then thrown away (`projects/[id]/page.tsx:524-541`); feed it to the serpentine ordering. Correct ordering beats drawing direction arrows.
   - Eligible-to-start highlighting: `canStartDevelopment` must check `dependsOnInitiatives` are done, not just `status === 'pending'`; highlight the eligible set → enables batched kickoff.
   - In-flight → active-flow link derived from manifest status, not same-session component state.
7. **fanOut truth** — G6.

## 5. Phase 2 — Engine honesty + simplification (orchestrator hot path)

1. Unifier restart cap + `uwi.gate-failed` structured event — G4 (two themes, both $8–16 wasted).
2. Crash-before-first-tool → no identical retry — G3.
3. Transient-lint-lock classification — G10.
4. Unifier fan-in staleness: always re-derive `git diff --stat`/version at startup; validate `demo.json` liveEvidence id against `.forge/live-evidence/` on **every** re-prep pass (two themes + one operator send-back).
5. Ralph commit discipline — G1, G2 (with the demo contract as the deterministic replacement).
6. PM turn economy — G8 + write-WIs-incrementally + Grep-not-Read-for-large-files folded into the decomposition skill (Phase 3); emit partial WI graph near exhaustion rather than 0.

## 6. Phase 3 — Design-phase consolidation (the big one; operator's "general idea")

**Update ADRs first** (touches the DEC-3 flow split and the architect/PM agent boundary).

1. **One design agent.** Collapse `architect` + `project-manager` into a single agent whose stages (interview → roadmap draft → completeness critique → per-initiative WI decomposition) are expressed via **instructions, skills, hooks, and tools** — not separate runtime agents. Retire the `project-manager` agent; cull the unwired `code-reviewer` from the roster (or wire it deliberately); fold `release-finalizer` invocation into flow topology or document why it stays outside.
2. **Plan-everything-before-kickoff.** Decomposition has no execution dependencies: a roadmap wave produces WI graphs for **all** initiatives up front. Operator (later: an agent/flow) reviews the complete initiative+WI state, then kicks off from the roadmap page — batched by dependency eligibility, with **zero further operator blocks** (G7: one roadmap-level PLAN gate total).
3. **The contract-compiler stage — highest-leverage single change in this plan.** Dev-loop agents correctly read no brain (ADR-010); the WI spec is the *only* legal knowledge carrier. The decomposition stage must therefore **compile** project profile + brain constraints into each WI body: explicit file-deletion lists (proven fix — graph-identity cycle deleted all 4,423 dead lines when specs named them; 7 cycles failed when they didn't), deregistration checklists, API-shape rules, fixture rules, sizing (≤4–5 resources per WI — the 13-resource batch cost $5.21 and 139 bash calls), and per-WI provider-registration serialization (the hidden-coupling rule).
4. **Completeness critic at FINALIZE** (from the 23-initiative judge review): coverage-closure diff over the full scope enumeration, pairwise-disjoint ownership, scope-ledger vs. interview answers, invariants as ACs not prose. A skill stage, not a runtime guardrail.
5. **Architect page redesign:** align to current UI patterns (the page still reflects pre-Studio layouts); add file/image upload as design inputs; interview stays but feeds one agent's staged context.

## 7. Phase 4 — Ralph conformance + parallel work items

Conformance audit vs. the researched standard (fresh-context-per-iteration ✅ via per-iteration agent invocation + `AGENT.md`/`fix_plan.md` disk state; independent gate re-execution ✅ via `stop-conditions.ts`):

| Standard | Forge today | Action |
|---|---|---|
| No commit on red gates (MUST) | ❌ `autoCommitWorktreeIfDirty` unconditional | G1 (Phase 2) |
| Precise gate-failure re-injection (SHOULD) | ⚠️ partial (live-gate-feedback fix exists) | Verify failure output (names + errors) reaches next iteration's prompt |
| Specs: single-topic, outcome ACs, explicit stop condition + file list (MUST) | ⚠️ inconsistent — see dead-files/scope-drop themes | `ralph-spec-lint` skill (Phase 5) run by the decomposition stage |
| Distinct agent git identity (SHOULD) | ❌ operator credentials | Cheap: dedicated git identity/service account |
| Sandbox for unattended runs (MUST NOT run bare) | ❌ bare host — the SEV-1 fixture-project destruction | Log as top item in `docs/known-gaps.md`; container/scoped-creds is its own workstream |
| Iteration cap as financial governor (MUST) | ✅ (per-WI USD deliberately ∞, C19) | Keep; revisit only if evidence demands |

**Parallel WI execution** (operator ask; grounded requirements): per-WI git worktrees (already the CLAUDE.md-preferred isolation) replacing the shared-worktree + scratch-wipe design; ready-layer scheduler (dispatch WIs whose deps are done, bounded pool) replacing the serial `for…of` in `developer-loop.ts:317`; concurrency-safe `wiOutcomes`; per-WI cost/event attribution (Phase 1.4 is the prerequisite). Sequenced *after* Phase 1–3 so the instruments and specs are trustworthy first.

## 8. Phase 5 — Platform-pillar gaps (the diagram) + skills to create

Diagram conformance: Flows pillar ✅ (gates progressable in UI; monitoring fixed by Phase 1). Agents pillar ✅ (builders/templates from M2). KB pillar mostly ✅ (lint/index/ingest/guidance); gap: **seed a project KB on new-project creation** so it grows with the project. Skills pillar has the real gap: no curated OOTB library sourced from community skill libraries — build the catalog surface (source, rate, pin) rather than hand-rolling content.

**Skills to create** (consolidated):

| Skill | Purpose | Phase |
|---|---|---|
| `reflection-triage` | Work the reflection-question backlog; batch-answer from artifacts, surface only operator-genuine questions | 0 |
| `wi-spec-compiler` | The contract-compiler: profile/brain constraints → WI bodies (deletion lists, checklists, sizing, coupling serialization) | 3 |
| `architect-completeness-critic` | Coverage-closure diff + disjoint-ownership + scope-ledger at FINALIZE | 3 |
| `ralph-spec-lint` | Validate every WI spec against the Ralph standard before dev kickoff (single topic, outcome ACs, stop condition, files enumerated, unfakeable gate cmd) | 4 |
| `project-scoped-review` | Reusable managed-project audit: delivered code vs. initiative intent vs. live API docs | 6 |
| `cost-autopsy` | Decompose a cycle's spend warranted-vs-waste from `events.jsonl`; feeds reflection | 5 |

## 9. Phase 6 — Validation

1. Run the 3 held pending initiatives (taskagent, workitemtrackingprocess, mux-free-cutover) as the **first post-refinement cycle** — direct A/B against this run's friction profile.
2. `project-scoped-review` of betterado: intent-vs-delivered per initiative + live ADO API doc check → shapes the follow-on cycle (operator's assumption: issues likely; maybe not).
3. Standing harnesses: `verify:cycle` (mdtoc routine tier) + `ui:journey` after each phase merge.

**Unreflected done initiatives (Phase 0.1 work list):** environment-templates-spike, release-definition-artifact-trigger-enhancements, release-definition-coverage-gaps, release-definition-permissions-coverage, release-folder-coverage, release-stages-array-refactor, task-group-coverage (betterado ×7); gitpulse-code-churn; new-api-pipelines-v2; new-api-test.

## 10. Sequencing

```
Phase 0 (close-out)        — now; no code changes
Phase 1 (instruments)      — 7 small PRs, independent, parallelizable
Phase 2 (engine honesty)   — after/alongside Phase 1; orchestrator hot path
Phase 3 (design consol.)   — ADR updates first; the big structural change
Phase 4 (ralph + parallel) — needs Phase 1.4 (per-WI cost) + Phase 3 specs
Phase 5 (pillars + skills) — skills land with their consuming phase; catalog independent
Phase 6 (validation)       — the 3 held initiatives + betterado scoped review
```

Ordering follows the refinement methodology: fix instruments before engine, simplify before restructuring, validate on real cycles (no synthetic benches).
