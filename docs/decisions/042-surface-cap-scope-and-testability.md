# ADR 042 — Scope of the `orchestrator/` surface cap, and export-for-testability

- **Status:** superseded by [ADR 046](./046-package-layout-and-boundary-lint.md) — the `orchestrator/` surface cap is replaced by per-package LOC caps, the 800-line file cap and one-owner-per-file; rulings 2 and 3 below survive unchanged as standing rules for every package, ruling 1 does not (accepted 2026-08-08, batch-C ratification, operator-ruled)
- **Amends:** [CLAUDE.md](../../CLAUDE.md) "Ask first" — the bullet *"Anything that increases the surface area of `orchestrator/`"* is scoped by the three boundaries below.
- **Relates to:** [ADR 041](./041-trigger-kind-registry.md) (R2-08 shipped several of the ratified items); the wave-5 batch-C ratification dossier (`_wave5/ratification-dossier.md`) and record (`_wave5/ratification-record.md`) — the item-by-item evidence and disposition.

## Context

CLAUDE.md caps growth in `orchestrator/` surface area with an ask-first rule. During the wave-5
campaign that rule was read three different ways at three different call sites, and batch C turned
it into a defer-to-exit queue of 13 disclosed items that was never drained. The recurring question
was not *whether* a given change was justified (each was measurement-forced) but *whether it counted
as capped surface at all*. Three boundary cases recurred and were adjudicated ad hoc every time:

1. A new `cli/` route or query param — is the `orchestrator/` cap in force there?
2. An additive optional field on an already-exported `orchestrator/` type — new surface, or not?
3. A pure function exported **solely** so a unit test can drive it, whose only production caller is
   in the same module — legitimate, or the "production surface growth driven by a test" the cap
   exists to stop?

Re-adjudicating these each batch is itself a cost, and leaving them unresolved let a real backlog
accrete on `main`. This ADR fixes the boundaries so the cap means one thing.

## Decision

1. **The cap governs `orchestrator/` only.** New or changed `cli/` route surface (routes, query
   params) is **disclose-not-park**: name it in the PR body, do not treat it as ask-first. `cli/` is
   the operator/bridge edge, not the capped core. (Ratifies dossier B3, the phase-log `raw=1` param.)

2. **An additive optional field on an already-exported type is disclose-not-park**, not new-surface
   ask-first — provided it is honest-absent (present only when a real value exists) and its
   reachability is swept. Adding a field is not adding surface in the sense the cap protects.
   (Ratifies dossier B1/B2, `RunPhaseMeta.lastEventAt` and `.findings`.)

3. **Export-for-testability is permitted.** A **pure** function carrying an **explicit error
   contract** (typed results / discriminated errno, no bare `catch {}`) may be exported from
   `orchestrator/` solely to be driven by direct unit tests, even when its only production caller is
   in the same module. The testability of an error contract is a first-class reason; the alternative
   — testing errno discrimination only through a public caller — under-tests the contract.
   (Ratifies dossier A5, and the two prior instances `buildStandaloneRunPrompt`,
   `resolveOneShotBudgetUsd`.)

These are boundaries on **what the cap covers**, not a relaxation of it. A genuinely new
`orchestrator/` export with production callers (dossier A1–A4: `defaultConfigPath`,
`normalizeProjectId`, `fireAgentCompleteTriggers`, `resolveProjectIdForRepo`) remains ask-first and
was ratified item-by-item in the record, not by this ADR.

## Consequences

- The ratification dossier's 13 items are dispositioned in `_wave5/ratification-record.md`; this ADR
  is the durable home for the three general rules that came out of it, so they are operator-owned
  and not re-derived per batch.
- A T2 that hits one of these three shapes discloses it in the PR body and proceeds; it does not park
  for ratification. Only a new capped-surface `orchestrator/` export parks.
- The boundary is testable in review: "is this `cli/`?", "is this an additive optional field on an
  already-exported type?", "is this a pure function with an explicit error contract?" — each is a
  yes/no a reviewer can settle without a judgement call.
