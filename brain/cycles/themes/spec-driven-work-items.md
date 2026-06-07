---
title: Spec-driven work items
description: >-
  Atomic (≤3 files), Given-When-Then acceptance criteria, declared dependencies,
  designed for iteration not one-shotting. PM phase output.
category: pattern
keywords:
  - work-item
  - spec
  - given-when-then
  - acceptance-criteria
  - atomic
  - dependencies
  - parallelism
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - markdown-artifact-flow
  - ralph-loop-pattern
  - dependency-ordered-work
---

# Spec-driven work items

The Project Manager phase decomposes initiative features into work items. Each work item is a markdown file (`<worktree>/.forge/work-items/<work-item-id>.md`) with frontmatter:

```yaml
work_item_id: WI-<n>
initiative_id: INIT-<...>
status: pending
depends_on: [WI-1, WI-3]
acceptance_criteria:
  - given: ...
    when: ...
    then: ...
files_in_scope:
  - src/...
estimated_iterations: 3
```

> Note (2026-06-04): `feature_id: FEAT-<n>` was removed from the schema. WIs now key on `initiative_id` only. See [ADR 015 Amendment 2026-06-04](../../docs/decisions/015-work-item-format.md).

Discipline:

- **Atomic** — each work item touches ≤3 files (target).
- **Verifiable** — at least one Given-When-Then acceptance criterion.
- **Parallelisable** — declared `depends_on` edges; ≥30% of work items should run in parallel.
- **Self-sufficient** — the developer loop never has to come back to PM for clarification.
- **Designed for iteration** — Ralph will loop on this until quality gates pass; not for one-shotting.

A `_graph.md` (mermaid) sibling shows the dependency graph for human review.

## Sources

- [`forge-v2-phase-project-manager.docs.md`](../../_raw/docs/forge-v2-phase-project-manager.docs.md) — primary source.

## See also

- [[markdown-artifact-flow]] — the artifact format.
- [[ralph-loop-pattern]] — what consumes the work items.
- [[dependency-ordered-work]] — broader principle.
