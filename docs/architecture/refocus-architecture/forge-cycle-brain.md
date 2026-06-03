# Brain 2 — forge-cycle

> **Intent.** The LLM-wiki of **cross-cycle learnings** — patterns and antipatterns
> distilled from cycle logs, reflection, and operator input. Scope is the **architect, PM,
> and reflect** phases (the planners + the learner). It is **temporal/experiential** memory:
> "what was *done* and learned over time," not "what the code *is*."
>
> **Type:** knowledge store. **Realized via:** `brain/cycles/` (`_raw/` archives →
> `themes/` → category indexes). **No graphify** (see below).

## Responsibilities

- Accrue cycle archives (`_raw/`, immutable episodic ledger) and distilled theme pages,
  written by the [Reflection](docs/architecture/refocus-architecture/Reflection.md) phase.
- Serve the **planners** (architect / PM) and the reflector a scope-correct,
  keyword-searchable knowledge base over ~60 small markdown themes (mandatory brain-first).
- Reconcile new knowledge on ingest: dedup, contradiction-flag, staleness-tag — so the
  wiki accumulates *cumulatively*, not episodically (forge's v1 failure was 5 duplicate
  theme files in a day from truncated context).

## Inputs → Outputs

**Consumes:** cycle event logs + the reflector's distilled lessons + operator feedback.
**Produces:** theme pages, category indexes, the regenerated `INDEX.md`, cycle archives
with retention metadata.

## Relationships

- **Written by:** the [Reflection](docs/architecture/refocus-architecture/Reflection.md) phase (the de-facto only writer).
- **Read by:** [Architect](docs/architecture/refocus-architecture/Architect.md) + [Project Manager](docs/architecture/refocus-architecture/Project-Manager.md) (planner brain-first) +
  the reflector. **Not** read by the dev-loop/reviewer.

## Boundaries (what this is NOT)

- **Not a code graph.** graphify is the wrong substrate here and is **dropped** for this
  brain — empirically its cycle graph is 100% intra-file heading edges (0 relational value);
  a code-structure tool cannot express temporal/causal facts.
- Not forge-engineering knowledge (Brain 1) and not project knowledge (Brain 3).

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[BRN-3 · high]** **Drop graphify for this brain** (locked direction): delete
  `brain/cycles/graphify-out/`, its merge-driver line, and the cycles arm of
  `scripts/brain-graphify-all.sh`; `brain-query` over Brain 2 becomes a plain
  INDEX/category → theme keyword scan. The regenerated `INDEX.md` is sufficient as the
  brain index (no need for graphify-as-index).
- **[BRN-4 · med]** Add lightweight **temporal provenance** instead of a heavy KG:
  `derived_from_cycles` + `last_validated_cycle` frontmatter on themes; lint flags stale
  high-confidence themes. (Simplest intent-preserving answer to the "zombie memory" risk.)
- **[BRN-5 · med]** `brain-ingest` SKILL declares itself "the only writer" but the reflector
  direct-writes — retire or make-real the ingest skill (one or the other, not orphaned).
- **[BRN-6 · low]** Slim `brain-query` SKILL (167 lines, graph-first strict protocol) to the
  essential contract now that Brain 2 has no graph; auto-regenerate `INDEX.md` on reflector
  ingest (kills count-drift); delete dead lint checks (`checkContamination` scans a removed
  path; `checkGraphFreshness` referenced but never implemented; benchmarks/ residue).
