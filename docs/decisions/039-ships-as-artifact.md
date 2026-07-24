# ADR 039 — Ships-as-artifact: every OOTB agent/flow is Scope-2 data on the runnable primitive

**Status:** Accepted
**Date:** 2026-07-24
**References:** [docs/roadmaps/R4-ootb-suite.md](../roadmaps/R4-ootb-suite.md)
(R4-01-F1 — the initiative this ADR is; the operator doctrine quoted below is
its header), [ADR 038](./038-north-star-platform-and-ootb.md) (the Scope
1/Scope 2 split this ADR inherits and does not originate), [ADR 024](./024-phases-as-subagents-invoking-skills.md)
(the artifact-migration remainder this ADR completes the design for),
[ADR 027](./027-studio-object-model.md) (the agent-definition fields this ADR
extends), [ADR 028](./028-flow-engine.md) (the flow-engine dispatch this ADR
changes), [ADR 036](./036-orchestrator-owned-gate-execution.md) (the
agents-judge/orchestrator-executes boundary this ADR preserves).

## Context

Forge's flow-engine dispatch today (`orchestrator/flow-runner.ts`,
`R2-01-F2`) is asymmetric in a way that quietly contradicts the Scope-1/Scope-2
split ADR 038 just made the north star. Four phase agents — project-manager,
developer-ralph, developer-unifier, reflector — declare a privileged
`executor:` frontmatter value (`'pm' | 'dev' | 'unifier' | 'reflect'`) that
`resolveNodeKind` recognises by name and routes to a phase-specific executor
function. Every *other* roster agent — anything an operator builds in Studio —
falls through to the generic `'agent'` kind (`execAgent` → `runAgent`, the
R2-01-F1 runnable primitive). The platform still special-cases four specific
agents by identity, not by shape: an operator-authored agent that needs a
Ralph loop, a cost cap, or a pre/post pipeline has no declared way to ask for
one — those behaviours exist, but only wired to the four hardcoded slugs.

This is exactly the gap ADR 024's 2026-07-17 reconciliation note named but
didn't design: the `PhaseAgentSpec` **spec** migration (every LLM phase
sourcing intent from `SKILL.md`) finished 2026-06-13, but the **artifact**
migration — phases as OOTB artifacts on the generic primitive, replacing
`orchestrator/*-invocation.ts` prose and the hardcoded slug table with
registry-driven dispatch — was deferred to this initiative, R4-01. Separately,
R4-11's adversarial review (2026-07-17, finding D6) surfaced a related
ambiguity while wiring the roadmap/attention surface: the initiative object
and its lifecycle are edited by Scope-2 work (this roadmap) but physically
live in Scope-1 machinery (`orchestrator/queue.ts`, the scheduler, `finalize-merged.ts`)
— with no recorded rule for which side owns what, a future contributor could
just as easily invent a parallel Scope-2 object store as extend the existing
one, re-growing the exact duplication ADR 027 was written to prevent.

## Decision

**1. Principle.** The roadmap's operator doctrine is promoted to a forge-wide
rule:

> "any agentic flow we ship in forge should be made available as an OOTB
> agent, rather than baking it into the platform itself, for consistency of
> implementation and extensibility"

Every agent or flow forge ships — the six-phase cycle included — is an OOTB
**artifact**: Scope-2 data (ADR 038) sitting on the Scope-1 `runAgent`
primitive (ADR 027's agent-definition format, R2-01's runnable spawn). The
platform bakes only **execution machinery** — executors, gates, budgets,
guards — never a specific agent's behaviour. A phase that is still special-cased
by name in `orchestrator/` is, by this rule, an artifact migration not yet
done, not a permanent exception.

**2. The dispatch seam this lands with (R4-01-F2 design).** Phase agents stop
being privileged `executor:` enum rows. Instead, the same declared fields
every other roster agent already has carry the behaviour the phase needs:

- **`runtime.loopStrategy`** (ADR 027 §1, already-shipped field) is the
  dispatch switch: `'one-shot'` is driven by the generic `runAgent` primitive
  as a single SDK stream call. *As-built note (2026-07-24): the one-shot path
  calls the pinned Claude query (`pinnedStreamQuery`) directly — byte-parity
  with what the phase pipelines always did — and does NOT yet route through
  `resolveSdkId`/the adapter registry; honouring a non-claude `runtime.sdk`
  on this path is R2-06 (runtime-adapter realization) work.* `'ralph'` is dispatched
  to the orchestrator's existing Ralph-loop machinery (`loops/ralph/`,
  ADR 002) and is **never** driven by the one-shot primitive — the two
  strategies stay two code paths, selected by declared data instead of by
  which of the four slugs the agent happens to be.
- **`budgets` gains `maxTurns`, `maxBudgetUsd`, `maxBudgetUsdShare`**
  alongside the existing `iterationFloor`/`iterationCap`/`maxTurnsPerIteration`/
  `wedgeKillMs` fields (ADR 027 §1). The cost ceiling resolves generically —
  `max(maxBudgetUsd, maxBudgetUsdShare × initiative cost budget)` — so a
  migrated phase's cost cap is a declared number, not a constant hand-coded
  per phase in `orchestrator/`.
- **`composition.hooks` gains band keys** — `wi-contract` selects the PM
  work-item contract pipeline, `reflection-close` selects the reflector close
  pipeline — read alongside the existing toggle-style hook names (event-log,
  cost-guard, stall-watchdog, merge-gate, scratch-strip). A band key doesn't
  toggle one behaviour; it selects an orchestrator-implemented pre/post band
  around the generic spawn.

**3. Honest caveat.** Hook band ids select orchestrator-**implemented**
bands — the PM contract pipeline and the reflector close pipeline remain
platform code, deliberately, per this ADR's own principle ("the platform
bakes only execution machinery"). What changes is *how* a phase reaches that
machinery: the key is compositional declared data on the agent definition,
not a privileged enum branch a hardcoded switch recognises by name, and the
thing that spawns the agent is the one generic `runAgent` primitive rather
than a bespoke per-phase invocation file. A purer future shape — where the
pipeline contract is attached to the artifact template an agent produces
(ADR 027's `ArtifactTemplate`, not the agent definition) rather than named by
a hook key on the agent — is a plausible next step, but it is **not built
here**: there is exactly one consumer of each band today, and building a
templates-as-contracts indirection ahead of a second consumer would itself be
the unjustified complexity CLAUDE.md's "simplest thing that could work" rule
rejects.

**4. Platform-owned vs suite-owned object split.** Per R4-11's scope-ownership
finding (adversarial review 2026-07-17, D6): the **initiative object and its
lifecycle are SWE-suite domain, hosted in Scope-1 machinery**
(`orchestrator/queue.ts`'s directory-rename state machine, the scheduler,
`finalize-merged.ts`). Suite-side work (R4-11 and its successors) is licensed
to edit those Scope-1 paths on the suite's behalf — that is not a Scope-1
change requiring the Scope-1 generality bar, it is Scope-2 content that
happens to be physically hosted there. The corollary rule this ADR records:
the initiative state vocabulary extends through **one data table** (the
`status-colors.ts` pattern — `QUEUE_STATE_TO_RUN_STATUS` and its UI-side
counterpart), never through scattered string literals re-deriving the state
name at each call site. A future suite-domain object that needs Scope-1
hosting follows the same rule: host it in Scope-1 machinery, own its
semantics from Scope-2, extend its vocabulary through one table.

**5. Scope boundary.** This ADR's dispatch-seam design does not retire
anything yet:

- **`developer-unifier` keeps its declared `executor: 'unifier'` row** and its
  dual-boundary close-contract gate (ADR 026, ADR 036) until R4-01-F4 retires
  it — and F4 cannot start before R4-10-F2 relocates the gate the unifier
  currently owns. Until then, the unifier is the one deliberate, documented
  exception to item 2's generic dispatch — not a silent one.
- **The architect's interactive runner is unchanged.** It is already
  `SKILL.md`-sourced per ADR 024 (`architectAgentSpec = deriveAgentSpec(...)`,
  landed 2026-06-13); its file-checkpointed, multi-turn UI surface is a
  different execution shape than a one-shot or Ralph spawn and is out of this
  ADR's scope.

## Consequences

- **Positive:** an operator-authored agent and a shipped phase agent are the
  same kind of thing to the dispatcher — the difference is which declared
  fields it sets, not which of four names it happens to have. Adding a new
  OOTB agent that needs a cost cap or a pre/post pipeline requires no
  `orchestrator/` change, only declared data (defends the capped-surface
  rule the same way ADR 024 and ADR 028 already do).
- **Positive:** the platform/content boundary (ADR 038) gets a concrete,
  checkable instance — `PHASE_EXECUTOR_KINDS` narrowing to a single slug
  (`developer-unifier`, until R4-01-F4) is the measurable signal that the
  artifact migration is progressing, not just a restated intention.
- **Negative / accepted:** the hook-band caveat in item 3 is a real
  limitation, not resolved here — `wi-contract` and `reflection-close` still
  name platform pipelines an operator cannot redefine from Studio. Accepted
  under the "simplest thing that could work" rule; revisited only if a
  second consumer of either band actually appears.
- **Deferred, not decided here:** the templates-as-contracts purer shape
  (item 3); the R4-01-F2 migration itself (PM, developer-ralph, reflector
  moving off `orchestrator/*-invocation.ts`); the R4-01-F4 unifier retirement
  (gated on R4-10-F2). This ADR is the design and the principle; R4-01's
  remaining features are the implementation.
- **No code change in this commit.** This ADR is the accepted design for
  R4-01-F2/F4's implementation; `orchestrator/flow-runner.ts`,
  `orchestrator/studio/types.ts`, and the `*-invocation.ts` files are touched
  by those features, not by this one.

## Rejected alternatives

- **Attach the pre/post pipeline contract to the artifact template instead of
  the agent definition, now.** Rejected for this ADR — see item 3: exactly
  one consumer exists per band today; building the indirection ahead of a
  second real consumer is speculative generality, the opposite of forge's
  "is this the simplest thing that could work" judgment.
- **Retire `developer-unifier`'s privileged executor in the same initiative
  as the dispatch-seam design.** Rejected — R4-10-F2 owns building and
  proving the relocated close-contract gate; retiring the slug before its
  replacement is live and green would strand the one gate the 2026-07
  betterado run's fabrication-arms-race lesson (ADR 036) depends on.
  Sequencing, not scope, is the reason F4 waits.
- **Treat the R4-11 initiative-object split as a Scope-1 change requiring the
  full Scope-1 generality bar.** Rejected — the initiative object is
  SWE-suite domain (item 4); demanding Scope-1-generic design for a
  suite-specific object would block ordinary roadmap-surface work on a bar
  that doesn't apply to it. The lighter rule (one data table for the
  vocabulary) is the proportionate guard.
- **Invent a new Scope-2 object store instead of hosting suite objects in
  Scope-1 machinery.** Rejected — this is precisely the second-source-of-truth
  risk ADR 027 already ruled out for Studio objects; the initiative object
  stays where it already lives, only its ownership is now recorded.

## References

- [docs/roadmaps/R4-ootb-suite.md](../roadmaps/R4-ootb-suite.md) — R4-01
  ("Platform→artifact migration", the initiative this ADR is F1 of) and the
  R4-11 scope-ownership note (finding D6) this ADR's item 4 records.
- [ADR 038](./038-north-star-platform-and-ootb.md) — origin of the Scope
  1/Scope 2 split; this ADR inherits it and does not re-decide it.
- [ADR 024](./024-phases-as-subagents-invoking-skills.md) — the spec
  migration this ADR's dispatch-seam design completes the artifact-migration
  remainder of.
- [ADR 027](./027-studio-object-model.md) — the agent-definition format
  (`runtime`, `budgets`, `composition.hooks`) this ADR extends.
- [ADR 028](./028-flow-engine.md) — the flow-engine node dispatch this ADR
  changes (`executor:` enum narrowing, generic-agent path becoming the
  default).
- [ADR 036](./036-orchestrator-owned-gate-execution.md) — the
  agents-judge/orchestrator-executes boundary this ADR's hook bands and
  `runAgent` spawn both preserve (`runAgent` imports no gate/CI/capture
  machinery).
