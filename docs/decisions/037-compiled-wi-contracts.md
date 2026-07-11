# ADR 037 — Compiled work-item contracts (wi-spec-compiler)

**Status:** Proposed
**Date:** 2026-07-11
**Amends:** [ADR 010](./010-brain-first.md)'s enforcement mechanism (not its
allocation of who reads the brain). **References:** [ADR 036](./036-orchestrator-owned-gate-execution.md)
(the sibling structural fix, opposite end of the pipeline), [ADR 024](./024-phases-as-subagents-invoking-skills.md)
(the skill-composition seam this adds to). Codifies REFINEMENT-PLAN.md
Phase 3, item 3.1.

## Context

ADR 010 makes the project-manager the **sole encoding point** for brain
knowledge: the dev-loop and reviewer deliberately do not read the brain
because "the planner already encoded every relevant convention/antipattern
into the work items." That contract holds only if the PM reliably gets brain
content *into* WI bodies. It doesn't:

- `brain/projects/terraform-provider-betterado/themes/2026-07-05-framework-migration-checklist-not-in-wi-specs.md`
  — **three consecutive cycles** (2026-06-20, 07-01, 07-05) hit the identical
  failure: the PM read the brain (9–15 reads, brain-first mandate satisfied)
  and embedded the framework-migration checklist (deregister-from-SDKv2 +
  delete-old-files + wire-real-client) into WI-1, then **dropped it from
  WI-3 through WI-5** in the same decomposition turn. Result: `Invalid
  resource type` and `nil *client.AggregatedClient` gate failures across 5
  WIs — the same documented gotcha, re-derived from scratch each time by
  cost instead of being carried forward as data.
- `brain/cycles/themes/2026-07-11-pm-gate-vacuous-pass-new-function-name.md`
  — the PM named a gate against a test function (`TestResolveFrameworkAuth`)
  that didn't exist yet; `go test -run <pattern>` with no match exits 0
  ("`[no tests to run]`"), the gate read exit-0 as PASS, and 0 commits shipped
  before the cycle was classified terminal (`INIT-2026-07-10-framework-auth-parity`).
  `ba073ce` fixed the **runtime** symptom (`gateRequiredPaths`: `creates` →
  `verification_artifact` → `files_in_scope`, so an empty `creates:` no
  longer yields an empty diff-requirement) — but `creates:` is still
  optional at the PM's prompt level. Nothing stops the next decomposition
  from omitting it again; the runtime fallback only limits the blast radius
  after the cost is spent.
- The 2026-07-10 auth-parity cycle surfaced three separate defects, all
  traceable to the same root: a constraint that existed in the brain or the
  project contract but didn't survive PM prose into the WI body verbatim.

Forge already has a working precedent for the fix, one seam over:
`orchestrator/phases/project-manager.ts:340–460` runs a **deterministic
pipeline after the PM agent returns** — `readWorkItemsFromDir` →
`appendStandingAcs` → `validateWorkItemSet` → `detectHiddenCoupling` →
`writeDecompositionDoc`. `appendStandingAcs` (2026-06-06) already compiles a
project's `standing_work_item_acs` into **every** WI body by code, not PM
recall — "the per-WI PM judgment that kept varying" was removed by making it
not a judgment call. `detectHiddenCoupling` (F-05) exists too, but only in
**reject** mode: two WIs whose `files_in_scope` overlap without a
`depends_on` edge fail the whole PM pass (`couplingViolations.length > 0` is
one of the `failed` conditions) rather than being resolved.

The diagnosis is structural, and it rhymes with [ADR 036](./036-orchestrator-owned-gate-execution.md):
036 found that **results an agent produces under pressure are results an
agent can fake** (evidence fabrication), and fixed it by moving execution
from the agent to the orchestrator. The evidence here shows the mirror
failure on the other end of the pipeline: **constraints a PM must remember
across N WIs in one turn are constraints a PM will drop.** Asking an LLM to
reproduce fixed text verbatim, repeatedly, in the same turn that also does
real decomposition judgment, is a copy-paste task wearing a reasoning task's
clothes — three consecutive cycles proved it fails the same way.

## Decision

A **deterministic-first hybrid compiler stage** at the PM seam, extending
the existing post-PM pipeline (`appendStandingAcs` is the direct precedent).

1. **Structured constraint blocks.** `profile.md` and brain themes carry
   machine-readable clauses: tagged sections with a **mandatory `id:`**
   (stable clause identity — injection is keyed on it, so editing a clause
   *replaces* the compiled section instead of duplicating it) and an
   `applies_to:` selector keyed on WI kind / initiative type
   (e.g. `<!-- forge:constraint id: dereg-checklist applies_to: wi.kind=framework-migrate -->`).
   Convention only — greppable, markdown-native, no new storage engine.
   *(As-built note, 2026-07-11: selector fields match any parsed WI/manifest
   frontmatter field generically; until the PM populates a dedicated domain
   field, clauses target `manifest.<field>` globs — e.g. `initiative_id` —
   or `all`.)*

2. **Deterministic injector (code, not LLM)**, sequenced alongside
   `appendStandingAcs` before `validateWorkItemSet`:
   - Every clause whose selector matches a WI is compiled **verbatim** into
     that WI's body — ACs, checklists, file-deletion lists, deregistration
     steps. This is exactly the content class the terraform-provider-betterado
     theme shows the PM drops after WI-1.
   - `creates:` frontmatter becomes **mandatory** and is enforced at this
     stage — the `ba073ce` runtime backstop (`gateRequiredPaths` falling
     back `creates` → `verification_artifact` → `files_in_scope`) gets a
     **planner-side twin**: a from-scratch WI missing `creates:` is a
     compiler-stage validation failure, not a silently-widened runtime
     fallback discovered after a dev-loop iteration is spent.
   - Sizing bound enforced: **≤4–5 resources per WI** (the evidence base for
     the bound is the same migration-checklist cycles' oversized WIs).
   - `detectHiddenCoupling` upgraded from **reject → compile**: a resolvable
     shared-file overlap is compiled into an explicit `depends_on` edge
     instead of failing the whole PM pass. Reject remains the fallback for
     overlaps the compiler can't resolve unambiguously.

3. **LLM assist pass** — new single-file skill `skills/wi-spec-compiler/SKILL.md`
   (runtime **sonnet**) — used **only** where selector matching needs
   judgment the deterministic pass can't supply: ambiguous `applies_to`
   applicability, and port-fidelity checklist generation for porting
   initiatives (the checklist's *content* needs judgment to construct even
   though its *injection* is mechanical). The LLM pass runs **after** the
   deterministic pass and its output **re-enters validation**
   (`validateWorkItemSet` / `detectHiddenCoupling` run again over its
   output). It may **add** compiled constraints; it may never remove or
   override one the deterministic pass already injected.

4. **Sibling, not decided here:** Phase 4 ships `ralph-spec-lint` — a static
   validator asserting every quality gate is provably non-vacuous at
   decomposition time (a named test exists on the clean tree, or the gate is
   declared expected-fail-at-iteration-0 via the `gateRequiredPaths`
   mechanism). Named as a consequence/complement; its own ADR-less plan item.

## What this replaces / amends

Nothing existing is replaced. This **amends ADR 010's enforcement
mechanism**, not its allocation of who reads the brain: architect/PM still
read the brain, dev-loop/reviewer still don't. What changes is *how* a PM's
brain read becomes WI content — previously "the PM writes it into WI prose
from memory, once, hopefully every applicable time"; now "code compiles the
matched clause into every applicable WI body; the PM's job is producing WIs
with an accurate `kind`/type for selector matching, plus judgment the
selector can't do." The single-source-of-intent property WI-as-contract
depends on (ADR 010) is **strengthened**, not changed: compiled content is
guaranteed present instead of probabilistically present.

References [ADR 036](./036-orchestrator-owned-gate-execution.md) as the
paired structural fix, same shape applied to the opposite end of the
pipeline: *results an agent produces are results an agent can fake → gates
the orchestrator runs.* Here: *constraints a PM must remember are
constraints a PM will drop → constraints the compiler injects.* References
[ADR 024](./024-phases-as-subagents-invoking-skills.md) — `wi-spec-compiler`
is a new skill in that roster; whether it's composed by the PM's
`PhaseAgentSpec` directly or invoked as a discrete stage between the PM
agent's return and `validateWorkItemSet` is an implementation choice, not an
ADR-024 seam change.

## Consequences

- **`profile.md`'s authoring convention becomes load-bearing.** A clause
  without a valid `applies_to:` selector is invisible to the injector and
  silently reverts to "PM must remember it in prose" — today's failure mode.
  Correct tagging becomes part of project onboarding
  (`forge-onboard-project`), not optional documentation polish.
- **Hidden-coupling behavior changes** from hard-reject to
  compile-when-resolvable: fewer legitimate PM-pass failures on shared-file
  WIs, but a wrongly auto-inserted `depends_on` edge is a *quieter* failure
  (a silent merge-time surprise) than today's loud reject — this needs test
  coverage sized to that risk, not less.
- **Mandatory `creates:` will reject some WI shapes the PM gets away with
  today** — pure-modification WIs with no new files need an explicit
  escape (verification_artifact stands in), not a blanket mandate, or the
  compiler false-positives on legitimate small WIs.
- **One more skill in the roster** (`skills/wi-spec-compiler/SKILL.md`) —
  one more surface for `forge studio lint`, one more line for the
  `ui:journey` / `verify:cycle` harnesses to exercise.
- **Cost**: a cheap deterministic pass plus a bounded, selector-scoped
  sonnet assist pass added to every PM turn — smaller than the cost of a
  repeat cycle caused by one dropped checklist clause (three consecutive
  cycles' worth of evidence above).
- The fix targets the **failure mode** (constraint present in the brain,
  absent from the WI) — it does not remove PM judgment over what WIs exist,
  their scope, or their ordering. It removes the PM's role as a copy-paste
  engine for fixed text, which is exactly the part a deterministic pipeline
  does reliably and an LLM turn under load does not.

## Rejected alternatives

- **Pure-LLM compiler skill** (an LLM re-reads the brain and rewrites each
  WI to fold in relevant clauses, no deterministic injector). Rejected —
  same failure class as the problem being fixed: an LLM pass asked to
  reproduce fixed text verbatim across N outputs is the exact task that
  failed three cycles running. If the PM's original turn can't keep a
  clause from WI-1 to WI-5, a second LLM pass over the same material has no
  structural reason to succeed. Judgment tasks (selector ambiguity,
  novel-port checklist synthesis) belong on the LLM layer; verbatim
  reproduction does not.
- **Runtime-only backstops** (extend the `ba073ce` pattern further into the
  dev-loop/unifier instead of compiling at decomposition time). Rejected as
  the *primary* fix, kept as defense-in-depth where it already exists — a
  runtime backstop only catches the omission after a full PM pass **and**
  at least one dev-loop iteration have already spent cost chasing the
  missing constraint. Compiling the constraint in at decomposition time is
  strictly cheaper: the WI never ships without it, so there's nothing left
  for the runtime to backstop.
- **PM prompt enlargement** (more explicit instructions/examples in
  `skills/project-manager/SKILL.md` telling the PM to repeat checklist
  clauses in every WI). Rejected — this *is* the status quo mechanism, and
  the evidence — three consecutive cycles, same clause, same omission
  pattern, despite the brain-first mandate being satisfied — says prompt
  clauses decay under PM cognitive load once the same content must repeat
  across N WIs in one turn. A longer prompt trades one degree of
  unreliability for a longer one; it does not touch the structural cause.

## References

- [ADR 010 — Brain-first research](./010-brain-first.md) — the
  planner-sole-encoding-point policy this ADR gives a structural
  enforcement mechanism.
- [ADR 036 — Orchestrator-owned gate execution](./036-orchestrator-owned-gate-execution.md)
  — the sibling fix (evidence integrity); this ADR mirrors its shape for
  constraint integrity.
- [ADR 024 — Phases are agents that compose skills](./024-phases-as-subagents-invoking-skills.md)
  — the skill-composition seam `wi-spec-compiler` joins.
- `brain/projects/terraform-provider-betterado/themes/2026-07-05-framework-migration-checklist-not-in-wi-specs.md`
  — three-consecutive-cycle evidence of prose-checklist decay across WIs.
- `brain/cycles/themes/2026-07-11-pm-gate-vacuous-pass-new-function-name.md`
  — the vacuous-gate defect this ADR's mandatory-`creates:` clause closes at
  the planner side (the runtime side is `ba073ce`).
- `orchestrator/phases/project-manager.ts:340–460` — the existing post-PM
  deterministic pipeline (`appendStandingAcs`, `validateWorkItemSet`,
  `detectHiddenCoupling`, `writeDecompositionDoc`) this ADR's compiler stage
  extends.
- `REFINEMENT-PLAN.md` §6 (Phase 3, item 3.1) — the plan item this ADR
  codifies.
