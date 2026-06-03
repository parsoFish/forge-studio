# Reflection

> **Intent.** Close the learning loop after a merged cycle: analyse the run (event log,
> retries, wedges, intent-vs-outcome), interview the operator (generic + project-grounded
> questions), and write durable lessons to the **right brain scope** — running lint on
> ingest so new knowledge is reconciled against the existing base.
>
> **Type:** assisted human-moment, then unattended ingest. **Realized via:** one SDK
> invocation ([orchestrator/phases/reflector.ts](orchestrator/phases/reflector.ts) +
> [orchestrator/reflector-invocation.ts](orchestrator/reflector-invocation.ts)) composing
> [skills/reflector/SKILL.md](skills/reflector/SKILL.md), fired only on a confirmed merge.

## Responsibilities

1. **Self-reflection** — read the cycle's `events.jsonl` + merged tree; extract concrete
   patterns/antipatterns, classified by type (strategy / recovery / optimization) and
   grounded in a citable source path (no vague, evidence-free themes).
2. **Operator interview** — file-based handoff (questions out, feedback in) surfaced on the
   UI `/reflect/<id>` screen. Always asks a standing battery (work-sizing, design-vs-
   implementation match, intent-alignment) plus project-grounded questions; capped at 4.
3. **Dual-scope write routing** — project lessons → the project's **Brain 3**; forge-
   machinery lessons → **Brain 2** (cycle); the full cycle archive → `brain/cycles/_raw/`.
   Litmus: *"would this be true for a different project?"*
4. **Ingest hygiene** — run lint over cycle-touched themes; on ingest, **reconcile against
   existing knowledge** (dedup near-duplicates, flag contradictions, tag staleness) rather
   than silently appending. Regenerate the brain index after writes.
5. Stay **log-and-continue** — the merge already happened; never un-merge, never gate the
   cycle outcome. Skip durable accretion entirely for disposable/verification cycles.

## Inputs → Outputs

**Consumes:** `events.jsonl`, the closed manifest, the merged tree, operator feedback,
the brain (Brain 2 + 3). **Produces:** `retro.md`, `user-questions.{md,json}`, theme files
(Brain 2 + 3), the cycle archive (with retention + cited_by), a recap; reflector events.

## Relationships

- **Upstream:** [Closure](docs/architecture/refocus-architecture/Review-Loop.md) (fires only on gh-confirmed merge), the operator (via UI).
- **Downstream:** the **brains** — the only durable writer. **Reads:** all three brains.
  **Composes skills:** `reflector` (and, per the north star, should compose `brain-query` /
  `brain-ingest` / `brain-lint` rather than hand-rolling them).

## Boundaries (what this is NOT)

- Not a gate — failure is log-and-continue.
- Not turn-by-turn dialogue today — async file handoff; a UI rerun re-runs the pass against
  the now-present feedback. (Whether to make it truly interactive is an open question.)

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[REF-1 · high]** The interview is effectively **non-functional in production**: the UI
  reads `user-questions.json` but the live prompt only ever writes `user-questions.md` (only
  the e2e emulator seeds the `.json`). Emit the `.json` (or derive it post-exit).
- **[REF-2 · high]** Delete the **dead bench-candidate pipeline** (`emitBenchCandidates` +
  helpers ≈210 lines + `forge brain bench:promote`) — its target `benchmarks/brain/` was
  removed; this also drops `reflector.ts` under the 800-line cap.
- **[REF-3 · med]** Make the standing question battery (sizing / design-vs-impl / intent-
  alignment) a **guaranteed seed set**, not agent-discretionary with a skip-everything escape.
- **[REF-4 · med]** "Index + lint on ingest" is half-met: lint runs (non-gating) but **no
  index regeneration** runs at ingest, and no NLI-style contradiction check. Add index
  regen + a dedup/contradiction pass; add staleness frontmatter (`last_validated_cycle`,
  `derived_from_cycles`). *(Stale high-confidence themes — "zombie memories" — are the
  primary unsolved memory failure mode; forge already hit "stale brain.")*
- **[REF-5 · med]** Not on the `PhaseAgentSpec` seam; hand-rolls brain-nav injection +
  tokeniser + frontmatter parsing + direct theme writes instead of composing the brain
  skills. See [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md).
- **[REF-6 · low]** Strip dead bench scaffolding from the three contract docs; either wire
  or drop the `brain/forge-dev/log.md` append claim (SKILL says forge-dev/log.md, phase doc
  says brain/log.md — neither happens).
