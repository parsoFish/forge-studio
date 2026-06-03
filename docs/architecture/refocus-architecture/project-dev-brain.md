# Brain 3 — project-dev

> **Intent.** The LLM-wiki of **per-project knowledge** — project-specific learnings that
> surface during the review/reflection phases, plus the project's own code map. Scope is
> project-specific and **readable by all phases**. Lives **inside each managed project's
> own repo** (`projects/<name>/brain/`).
>
> **Type:** knowledge store (per project). **Realized via:** Karpathy three-layer markdown
> wiki + a graphify code graph of the whole project.

## Responsibilities

- Hold the project's accumulated lessons (recurring bugs, conventions, gate/CI quirks,
  demo-ability notes) and `profile.md` (project taste) — written by the
  [Reflection](docs/architecture/refocus-architecture/Reflection.md) phase.
- Serve **structural code questions** about the project via **graphify** (earns its keep —
  real per-project import/call edges) for any phase that needs them (notably the dev-loop,
  advisory).
- Carry per-project taste so that **skills stay shared** — there is no per-project agent
  personality; project-specific intent lives here.

## Inputs → Outputs

**Consumes:** the project source (graphify corpus) + reflection lessons.
**Produces:** project theme pages + `profile.md`; the project's `graphify-out/graph.json`.

## Relationships

- **Written by:** the [Reflection](docs/architecture/refocus-architecture/Reflection.md) phase (project-scoped lessons).
- **Read by:** all phases — the planners mandatorily, the dev-loop/reviewer advisorily
  (it is *their* project's brain, distinct from the forge brain they must not read).

## Boundaries (what this is NOT)

- Not in the forge repo (lives in the project's repo; gitignored from forge's tree).
- Not forge-machinery knowledge — a lesson that would hold for a *different* project belongs
  in [Brain 2](docs/architecture/refocus-architecture/forge-cycle-brain.md), not here (the dual-scope litmus).

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[BRN-7 · low]** Keep graphify for the **code** half; ensure the **lessons** half is a
  proper markdown wiki layer (the two communicate; lessons reference code-graph anchors).
  Same scope-bleed litmus enforcement as Brain 2 ([BRN-4](docs/architecture/refocus-architecture/forge-cycle-brain.md)).
