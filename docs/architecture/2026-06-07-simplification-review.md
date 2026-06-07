# Forge simplification review — 2026-06-07

> Operator-driven review phase: research interview-driven refinement best practice,
> ground in recent forge+betterADO cycles, then refine forge's design/architecture to
> its **simplest irreducible** form without losing function. Full execution (not review-only).
> This doc is the running design target + decision record + backlog. Decisions use the
> Y-statement form ("in the context of X, facing Y, decided Z to achieve G, accepting T").

## Success criteria & stopping rule (condensed)

- **A — Discovery complete:** every capability, the runtime/operation model, how the UI
  plugs in, every UI screen, operator intent, and every orchestrator module are mapped;
  a preservation inventory exists; a completeness critic finds no gap. **(met — WF2)**
- **B — Irreducibility:** every remaining component has a one-line boundary + explicit I/O,
  re-invents nothing battle-tested, passes the three north-star questions (unattended?
  battle-tested? simplest?), and reduces net surface (esp. the capped orchestrator) with
  intent in exactly one place. Stop when the next cut would lose a preservation-inventory
  function or is merely cosmetic.
- **C — Preservation:** every preservation item maps to where it survives; every
  load-bearing ADR is honored or amended-first; both harnesses (`ui:journey`,
  `verify:cycle`) stay the acceptance gate; the 13-step journey stays expressible.
- **D — Directions:** skills-as-plugins, harness-overlay, daemon-optional flow each reach
  a decision (below).
- **E — Method:** the researched interview practice drives the refinement; decisions are
  logged here as we go; convergence = no unresolved high-value decision remains.

**One-line stop:** every remaining component is justified by a preservation-inventory
function and the three north-star questions; the next cut would lose a function or is
cosmetic; discovery has no gaps; each direction has an operator decision.

## Locked decisions

- **D1 — Harness-overlay = PARK.** In the context of simplifying forge, facing whether to
  build an overlay agent backend, decided to **keep the `run(input, agent)` injection seam
  clean + documented but not build overlay**, to avoid surface for a not-yet-needed mode,
  accepting that operator-driven overlay stays future work.
- **D2 — Skill model = CORE.** Facing ~983 LOC of prompt-as-TypeScript split across
  `orchestrator/*-invocation.ts`, decided to make **all five agent phases real agent
  definitions (`PhaseAgentSpec`) sourcing intent from `SKILL.md`**, plus an `allowedSkills`
  list (skills-as-plugins; data model admits a future drag-drop UI — not built), to achieve
  one home for intent + an extensible capability surface, accepting a sizable
  behavior-preserving migration. Enforcement (PM brain-skip abort, `validateWorkItem`,
  `detectHiddenCoupling`) stays orchestrator-side — the migration moves **intent, not
  enforcement**.
- **D3 — One operating model.** Decided to keep the **single daemon model** and let
  operator-directed step-through fall out of the already-isolated phase functions, rather
  than fork a second model.
- **D4 — Full execution**, harness-gated, conventional commits, one concern per PR.
- **D5 — Observability.** Cost is **not** in Claude hooks (open issue #11008); the
  mid-phase-cost gap is **dormant forge code**: `cli/cost-tick.ts`'s `createCostTickConsumer`
  is implemented but unwired ([cycle.ts:67]), and [claude-agent.ts:281] reads cost only from
  the `result` message. Decided: (a) **fix cost on the SDK stream** (wire cost-tick +
  `onUsageDelta` from per-turn `message.usage`); (b) **build the hooks lifecycle channel**
  (ADR 025) — in-process SDK `options.hooks` for spawned phases (replacing bespoke
  tool-event extraction) + `POST /hook-events` for interactive sessions — **without** routing
  the source-of-truth JSONL log through best-effort HTTP; (c) **no operating-model change**.
- **D6 — Interview tooling = ADAPT, not install.** Forge's architect is already
  higher-fidelity than off-the-shelf interview skills; decided to **port specific patterns**
  (VoI ask-vs-assume gate, pre-analysis, coverage-map tracking, hypothesis-first options with
  recommended+rationale, security hard-block, Y-statement decision log, EARS ACs, explicit
  NOT-DOING, 5-round cap with annotated defaults) into `skills/architect/SKILL.md`, and adopt
  `agent-decision-record`'s `/decide` Y-statement template for the architect decision log.

## Target architecture (simplest forge)

Unchanged and validated: **3 seams + 1 protocol** — `orchestrator` (coordination only:
scheduler · queue · worktrees · crash recovery) → `phase agent` (`PhaseAgentSpec`: skill +
model tier + tool/skill allow-list, spawned clean) → `skills` (composable capabilities) →
`markdown artifacts + JSONL event log`. The simplification *finishes* this seam (all phases
sourced from `SKILL.md`), adds `allowedSkills`, unifies live observability on the hook
vocabulary, and removes duplication — it does not re-architect.

## Backlog (execution order; each harness-gated, one PR per concern)

1. **Live-cost fix + telemetry dedup** — wire `cost-tick` in `cycle.ts`; add `onUsageDelta`
   in `claude-agent.ts` + dev-loop/unifier; extract `makeAgentWithTelemetry`. *(in progress)*
2. **ADR-024 migration** — PM → reflector → dev-loop → finish unifier prose move.
3. **Hooks eventing unification + ADR 025** — SDK `options.hooks` for spawned phases;
   `POST /hook-events` for interactive; retire bespoke extraction.
4. **`allowedSkills` seam** on `PhaseAgentSpec`.
5. **Architect-interview upgrade** (D6 patterns).
6. **Tactical irreducible cuts** — demo-render `--dir`, live-acc lint gate, cycle-report
   diff/gate-cmd, `/plan`+`/demo`→`/artifact`, topo-sort lib.
7. **Close-out** — overlay-seam doc, ADR/ARCHITECTURE updates, this decision record, both
   harnesses green.

Discovery synthesis (full architecture map + preservation inventory + candidate
simplifications) is archived in the session workflow outputs (`forge-internal-discovery`).

## Knowledge-layer reconciliation (added 2026-06-07 per operator)

Forge must be defined **as-is, not as the history of all work done**. Simplification
therefore extends to the knowledge layer, and every code change carries a knowledge DoD.

- **Success criterion F — Knowledge reconciled to current state.** No ADR, doc, or brain
  theme contradicts the current implementation or the simplified intent; conflicting ADRs are
  amended (clause-level) or superseded; docs reflect as-built; brain themes describe how forge
  *is* (historical iteration-narrative consolidated into current patterns or left to `_raw`,
  not carried as live themes). **Stop** when a fresh reader of ADRs + docs + brain would form
  an accurate picture of the *current* system with no historical contradictions.
- **D7 — Knowledge is part of the simplification.** Decided to treat ADRs/docs/brain as
  in-scope artifacts (not frozen history): reconcile conflicts, update to as-built, clean the
  brain to current-state — accepting that brain *deletion* is operator-gated (irreversible).
- **Definition-of-done (every concern):** each code change also updates the ADR(s) it touches,
  the affected docs, and any brain theme it makes stale — in the same PR. A change that leaves
  a contradicting ADR/doc/brain is not done.

**Reconciliation workstream** (audit-driven — `forge-knowledge-reconciliation-audit`):
- **R-A — ADR reconciliation:** amend/supersede conflicting ADRs (confirm 003↔024, the UI
  ADRs, the feature-layer-era 014/015) and author ADR 025 (hooks).
- **R-B — docs-to-as-built sweep:** ARCHITECTURE / PRINCIPLES / CLAUDE / phases / operator-journey / contract.
- **R-C — brain cleaning:** consolidate duplicates, archive baked-in history, fix stale themes.
  **Operator-gated** — conservative default is archive-not-delete; the cull list comes to the operator first.

## Close-out (2026-06-07) — final state

**Backlog disposition** (the plan-of-record, items 1-7):

| # | Item | State |
|---|---|---|
| 1 | Live-cost fix + telemetry dedup | **done** — `cost-tick` wired in `cycle.ts`; `onUsageDelta` per-turn; `makeAgentWithTelemetry` dedup; UI committed-vs-in-flight reconciliation (no pricing table, no double-count). |
| 2 | ADR-024 migration (all 5 phases) | **done** — PM, reflector, dev-loop, unifier are `PhaseAgentSpec`s sourcing intent from `SKILL.md`; enforcement stayed orchestrator-side. |
| 3 | Hooks eventing + ADR 025 | **partial by decision** — ADR 025 written; cost/tokens on the SDK stream shipped. Hook **emission-unification** + `POST /hook-events` **deferred** (the stream parsing they'd replace is load-bearing + only-real-cycle-validatable; live feel already delivered). |
| 4 | `allowedSkills` seam | **deferred** (operator) — the skills-as-plugins data model is admitted; the seam itself is future work. |
| 5 | Architect-interview upgrade (D6) | **done** — VoI gate, hypothesis-first options, coverage map, 5-round cap, security hard-block, Y-statement log, EARS/GWT ACs, NOT-DOING block — all in `skills/architect/SKILL.md`, surviving the conciseness pass. |
| 6 | Tactical cuts | demo-render `--dir` **done**; cycle-report per-WI gate-cmd **done**; `/artifact` (bridge-served) **done**. live-acc lint gate + topo-sort→lib **deferred** (each needs a runtime sub-check / dep approval). |
| 7 | Close-out | **this section** + [harness-overlay-seam.md](./harness-overlay-seam.md) + ADR/ARCHITECTURE/contract updates; all gates green. |

**Knowledge reconciliation (R-A/B/C, criterion F):** ADRs reconciled + ADR 025 authored (R-A); docs swept to as-built incl. the generalised `forge-project-contract.md` (R-B); brain culled to as-is — **6 themes archived + 3 consolidated**, lint clean, `INDEX.md` regenerated (R-C, operator-approved). A fresh reader of ADRs+docs+brain now sees the *current* system without historical contradictions.

**Gates (all green at close-out):** `npm run build` ✓ · `npm test` 626/626 ✓ · `npm run test:ui` 35/35 ✓ · `npm run ui:journey` ✓ (29-frame video; every DOM-as-metrics assertion incl. the Note-1 proof "unifier hex lit its own status, not folded into dev-loop") · `forge brain lint` 0 errors.

**Net-LOC accounting** (baseline `1f61e98` → HEAD, excluding generated graphs + the `.demo-shots` video/frame assets):

| Area | net | reading |
|---|---|---|
| **Production code** | **−75** | simplification intent met (Note 2). |
| ↳ orchestrator/ (the *capped* surface) | **−129** | shrank — ADR-024 moved prose to `SKILL.md`; new cost/spec wiring < relocated prose. |
| ↳ skills/ (`SKILL.md`) | −33 | absorbed orchestrator prose then trimmed −320 (Note 3 conciseness) → still net down. |
| ↳ loops / cli / forge-ui code | +54 / +1 / +22 | small — live-cost + hardening. |
| Tests | **+~1000** | see finding below. |
| Docs | +543 | intentional — 5 ADRs, this doc, generalised contract (knowledge reconciliation). |
| Brain (active themes) | **−723** | the as-is cull. |

**Finding — test count rose, against the operator's hunch that it would fall.** node `--test` cases **567 → 626** (+59); forge-ui vitest **0 → 35** (net-new). One consolidation *did* cut redundant cases (−150 LOC, table-driven invocation tests), but it is outweighed by **net-new coverage**: standing up the forge-ui vitest gate (a previously-untested surface) + tests for the live-cost feature, the ADR-024 migration, and the per-WI testing contract. Production code shrank; tests grew because coverage widened. I did **not** cut tests to hit a count target (that trades real safety for a number). *Open offer:* a dedicated redundancy-consolidation pass over the orchestrator test suite (+839 LOC) could lower the count without losing coverage — operator's call.

**Directions, final:** D1 overlay = **parked** ([harness-overlay-seam.md](./harness-overlay-seam.md) documents the clean `?? sdkQuery` injection seam). D2 skill model = **core, shipped** (all 5 phases). D3 single daemon = **held**. D5/ADR 025 observability = **shipped** (SDK stream; hooks parked with the overlay). D6 interview = **shipped**. D7 knowledge-as-scope = **done**.

**Stopping rule met:** every remaining component is justified by a preservation-inventory function; the next cut would lose a function or is cosmetic; discovery has no gaps; each direction has an operator decision. **Remaining gate before pointing forge at a real project:** `npm run verify:cycle` (real-cycle harness) — operator-gated, deliberately last.
