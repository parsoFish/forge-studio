# ADR 014 — Project roadmap.md schema

**Status:** Accepted
**Date:** 2026-05-08

> **Status: Superseded (2026-06-03)** — the architect no longer writes
> `roadmap.md`; the roadmap is a derived view of the `_queue/` manifests
> + their `depends_on_initiatives` chain (see
> [`docs/architecture/refocus-architecture/README.md`](../architecture/refocus-architecture/README.md)
> + [`docs/phases/architect.md`](../phases/architect.md)). The body
> below is kept as prior art.

## Context

The architect phase reads and updates a per-project roadmap at `projects/<name>/roadmap.md` (per [`docs/phases/architect.md`](../phases/architect.md) and [ADR 007](./007-markdown-artifact-flow.md)). The format was left undefined in the scaffold, blocking the architect bench from asserting anything about roadmap edits and forcing each session to invent a new shape.

A roadmap.md must serve three readers: the human (scanning current state at a glance), the architect agent (deciding where a new initiative slots in), and the project-manager / scheduler downstream (tracing initiative IDs back to their stated phase rationale). It must not duplicate manifest content; manifests in `_queue/` are the source of truth for feature-level detail.

External research surveyed solo-dev markdown task formats (Pankaj Pipada P-0..P-X), the emerging [AGENTS.md standard](https://agents.md/), and Aider/Cursor "agent-readable plan" conventions. Brain themes [`markdown-artifact-flow`](../../brain/forge/themes/markdown-artifact-flow.md), [`spec-driven-work-items`](../../brain/forge/themes/spec-driven-work-items.md), [`roadmap-simplification-convergence`](../../brain/forge/themes/roadmap-simplification-convergence.md), and [`karpathy-three-layer-wiki`](../../brain/forge/themes/karpathy-three-layer-wiki.md) supplied internal constraints.

## Decision

`projects/<name>/roadmap.md` is markdown with YAML frontmatter and three required sections, in this order:

```markdown
---
project: <project-name>
updated_at: <ISO-8601>
---

# <Project> Roadmap

## Current phase

**Theme:** <one-line theme>
**Status:** active | blocked | converged
**Rationale:** <2–3 sentences — why this phase before the next>

## Initiatives

| ID | Title | Status | Manifest | Depends on |
|----|-------|--------|----------|------------|
| INIT-2026-05-08-oauth | Add OAuth login | active | [link](../../_queue/in-flight/INIT-2026-05-08-oauth.md) | — |

## Backlog

- **Phase N — <theme>:** <one-line idea>, <one-line idea>
```

**Rules:**

- **Status keys** for the initiatives table are exactly: `pending` (manifest in `_queue/pending/`), `active` (manifest in `_queue/in-flight/`), `blocked` (waiting on a dependency or a design decision), `done` (manifest in `_queue/done/`). The status key must agree with the manifest's actual location.
- **Manifest column** is a relative link to the manifest file in `_queue/`. The architect writes the link; the scheduler does not move it (the scheduler moves the file; the next architect or PM pass updates the link if it has gone stale).
- **Depends on** column lists initiative IDs only — feature-level edges live in the manifest.
- **No inlining.** Acceptance criteria, feature breakdowns, and design notes live in the manifest, not the roadmap. The roadmap is the scanner's index, not the spec.
- **Backlog entries are one line each.** They become initiatives (with manifests) only when the architect picks them up; until then they are deliberately under-specified.
- **The architect appends and updates rows; it does not rewrite the file.** Each ideation session updates `updated_at`, mutates the relevant table rows, and may add backlog lines. Rewrites of the Current Phase section happen when phase status changes (phase-converged → next phase).

## Consequences

**Positive:**
- The architect bench can deterministically assert roadmap-edit correctness (table row added, status keys valid, manifest link present).
- Greppable phase boundary: `grep -r 'INIT-2026-05-08-oauth' projects/` finds the roadmap entry; the manifest at `_queue/*/INIT-2026-05-08-oauth.md` finds the spec.
- The downstream PM phase has a single canonical place to reconcile initiative status against `_queue/` directory state.

**Negative / accepted trade-offs:**
- Status duplicated between roadmap row and `_queue/` directory. Accepted — the roadmap is the human-scannable view; reconciliation is mechanical (the PM phase or `forge status` can flag drift).
- Markdown tables get awkward past ~20 active initiatives. Accepted — by then the project has a phase problem, not a format problem.

## Alternatives considered

- **No table; one heading per initiative.** Heavier; harder for the architect to add/remove rows mechanically; loses the `grep | column` scannability.
- **Frontmatter-driven with a generated table.** Adds a build step; violates ADR 007's "documentation = data" property.
- **Mirror the manifest schema in the roadmap.** Duplication that drifts; rejected.
- **Defer the format entirely until the first real project.** Considered, but the architect bench needs *some* canonical shape to score against, and v0 here is small enough that locking it now is cheaper than re-litigating per-fixture.

## References

- [ADR 007](./007-markdown-artifact-flow.md) — markdown-as-spec discipline this ADR specialises.
- [`docs/phases/architect.md`](../phases/architect.md) — phase doc that consumes this format.
- [`skills/architect/SKILL.md`](../../skills/architect/SKILL.md) — interactive skill that edits the roadmap.
- [`orchestrator/manifest.ts`](../../orchestrator/manifest.ts) — manifest schema referenced by the table's `Manifest` column.
- Brain themes: `markdown-artifact-flow`, `spec-driven-work-items`, `roadmap-simplification-convergence`.
- External: [AGENTS.md](https://agents.md/), [Pankaj Pipada — markdown task management for solo developers](https://pankajpipada.com/posts/2024-08-13-taskmgmt-2/).
