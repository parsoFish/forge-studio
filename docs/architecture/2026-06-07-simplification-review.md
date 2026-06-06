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
