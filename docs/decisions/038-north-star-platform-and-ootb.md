# ADR 038 — North-star reframe: modular platform (Scope 1) vs. shipped ideas machine (Scope 2 OOTB)

**Status:** Accepted (operator decision 2026-07-17 — [roadmap README §8, decision 4](../roadmaps/README.md#adversarial-review-decisions-2026-07-17-same-day-second-session)).
**Date:** 2026-07-17
**References:** [docs/repo-map.md](../repo-map.md) (the three-scope contributor map this
ADR's split rides on), [docs/product/minimum-viable-user-story.md](../product/minimum-viable-user-story.md)
(MVUS, re-scoped to Scope 2 by this ADR), [docs/roadmaps/R5-hardening-operability.md](../roadmaps/R5-hardening-operability.md)
initiative R5-07, feature F8 (the strike-list this ADR closes).

## Context

Forge's own instruction layer and orientation docs taught a single-level vision:
CLAUDE.md's opening line framed forge as "Idea machine for one human across many side
projects," and ARCHITECTURE.md's phase-by-phase narrative describes the six-phase cycle
as if it were forge's entire ambition. That framing is true of what forge *ships*, but it
undersells and mis-scopes what forge *is*: `orchestrator/`, the flow engine
([ADR 028](./028-flow-engine.md)), the runtime-adapter seam ([ADR 029](./029-runtime-adapters.md)),
Studio's definitions-as-data object model ([ADR 027](./027-studio-object-model.md)), and
the `PhaseAgentSpec` harness-overlay injection seam are all built generic — nothing in
that layer special-cases "the ideas machine." The forge-dev roadmap set's adversarial
review (2026-07-17) flagged this as findings D1/D2/E9: the instruction layer biases every
session against Scope-1 generality by presenting the OOTB content (the six-phase cycle,
the brain-tuned ideas machine) as if it were the whole product.

The roadmap set (`docs/roadmaps/README.md` §1) already separates three scopes for
contribution purposes (framework/seams, OOTB content, managed projects — mirroring
`docs/repo-map.md`). This ADR promotes that separation from a contributor map to the
**north star** — the thing every "is this in scope" and "is this the simplest thing that
could work" judgment is measured against — and records the operator's approval of the
two-level mission (roadmap README §8, decision 4, 2026-07-17).

## Decision

Forge's mission is **two-level**, not one:

- **Scope 1 — the platform.** `orchestrator/`, `cli/`, `loops/`, `forge-ui/`, the Studio
  object model, and every seam (runtime adapter, KB backend, the `PhaseAgentSpec`
  harness-overlay injection point) are **a modular platform for building the ideas
  machine — or any other agentic flow**. It is **SWE-focused for now by explicit
  operator choice**, not by architectural limitation: nothing here special-cases the
  ideas machine, but connectors to non-SWE systems (non-code domains, non-GitHub
  delivery targets, etc.) are deliberately **not built in advance**. Building them
  speculatively, before a second concrete need exists, would itself be the kind of
  unjustified complexity forge's own "is this the simplest thing that could work?"
  judgment (CLAUDE.md's North star) rules out.
- **Scope 2 OOTB — the shipped content.** The six-phase cycle (architect → plan/decompose
  → developer loop → demo/review → reflect), the brain-tuning loop, and everything
  `docs/product/minimum-viable-user-story.md` (MVUS) describes are the **ideas machine**
  — the concrete, opinionated agentic flow forge ships out of the box, running *on*
  Scope 1's platform rather than *being* it. MVUS is re-scoped by this ADR to describe
  Scope 2 only (see the strike-list below).

**Relationship to R4-01-F1.** A later initiative (R4-01-F1, "ships-as-artifact") will
mint its own ADR describing how Scope 2 content ships/distributes as an artifact. That
ADR **cross-references this one** for the platform/content split — it does not originate
the split. This ADR is the sole origin of the two-scope mission.

### Strike-list — orientation docs amended (dated 2026-07-17)

- `CLAUDE.md` — line 3 tagline + the "North star" section rewritten to state the
  two-level mission; the instruction layer stops presenting the OOTB ideas machine as
  forge's entire ambition.
- `README.md` — line 5 gains one sentence distinguishing the platform from the shipped
  content.
- `ARCHITECTURE.md` — header note only: the six phases described in the body are the
  Scope-2 OOTB suite riding Scope 1's engine/seams. A full rewrite of the document to
  lead with the platform view is deliberately deferred to R4-01.
- `docs/product/minimum-viable-user-story.md` — re-scoped in place: preamble retitled as
  the canonical vision for the shipped OOTB suite (Scope 2); the keep/cull rule bounded
  to Scope-2 content (Scope-1 componentry is judged by the roadmap set, not by MVUS);
  §3's unifier text replaced with the Q3-B successors (demo agent + adversarial review
  agent + orchestrator-owned merge-boundary gate) — the merge-boundary-gate relocation
  carries the operator's ⚑ review marker, per decision 4's Q3-B record.
- `docs/forge-studio-market-and-differentiation.md` — dated amendment at §2: the
  reframe is forge's *internal* engineering north star; *external* positioning is
  unchanged — the §3.4 four qualifiers stay until non-SWE connectors actually exist to
  market.
- `docs/repo-map.md` — the Scope 1 line names its target as "any agentic flow," not just
  forge's own cycle.
- `docs/roadmaps/README.md` — §1 and §8 updated to cite this ADR as where the reframe
  lands.

## Consequences

- **Positive:** the instruction layer (CLAUDE.md) and every orientation doc stop
  implicitly discouraging Scope-1-generic changes ("why would the engine need to support
  anything but the ideas machine" was a live bias before this ADR). Contributors judging
  "is this the simplest thing that could work" now have the correct frame: Scope 1
  changes are judged against "does this serve any agentic flow," Scope 2 changes against
  "does this serve the shipped ideas machine journey (MVUS)."
- **Negative / accepted:** two north-star statements to keep in sync instead of one.
  Mitigated by making Scope 2's canonical statement (MVUS) explicitly subordinate to this
  ADR rather than a second independent source of truth.
- **Deferred, not decided here:** connectors to non-SWE systems (the concrete shape of
  "any other agentic flow" beyond forge's own cycle) — explicitly future work, not
  scoped or designed by this ADR. R4-01-F1's ships-as-artifact ADR inherits the split
  but not this deferral's resolution.
- **No code change.** This ADR is pure reframing of existing, already-generic Scope-1
  architecture (ADR 027/028/029) and already-scoped Scope-2 content (MVUS); nothing in
  `orchestrator/`, `cli/`, `loops/`, or `forge-ui/` changes as a result.

## Rejected alternatives

- **Leave the single-level framing and rely on `docs/repo-map.md`'s three-scope table
  alone.** Rejected — repo-map.md is a contributor's *where does this file go* map, not
  a north star; it doesn't reach CLAUDE.md's opening framing, which is what every session
  actually reads first and judges decisions against (the adversarial review's D1/D2/E9
  findings were specifically about the instruction layer, not the contributor map).
- **Fold this reframe into R4-01-F1's ships-as-artifact ADR instead of minting a new
  one.** Rejected — R4-01-F1 is about *how* Scope 2 content ships as a distributable
  artifact, a narrower and later question; conflating it with the platform/content split
  would make R4-01-F1 responsible for a decision the roadmap's wave-0 hygiene pass
  (R5-07) needs to land now, cheaply, ahead of any Scope-1 componentry work in R1/R2/R3.

## References

- [Roadmap README §8 — Adversarial-review decisions, decision 4](../roadmaps/README.md#adversarial-review-decisions-2026-07-17-same-day-second-session)
  — the operator approval this ADR records.
- [docs/roadmaps/R5-hardening-operability.md](../roadmaps/R5-hardening-operability.md) —
  initiative R5-07, feature F8 — the strike-list this ADR closes.
- [docs/repo-map.md](../repo-map.md) — the three-scope contributor map this reframe
  promotes to north-star status.
- [docs/product/minimum-viable-user-story.md](../product/minimum-viable-user-story.md) —
  MVUS, re-scoped to Scope 2 by this ADR.
- [ADR 027](./027-studio-object-model.md), [ADR 028](./028-flow-engine.md),
  [ADR 029](./029-runtime-adapters.md) — the already-generic Scope-1 seams this ADR's
  platform framing describes (no code change).
