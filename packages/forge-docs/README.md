# @forge/forge-docs

The second factory: a docs-class pipeline built from data only. It has no
code, no `index.ts` and no `package.json`. The whole factory is one flow
definition and three agents, found through the platform's package-owned
discovery roots (`packages/kernel/discovery-roots.ts`) with no registration
code. Deleting this directory removes the flow and its agents and nothing else
changes; `scripts/factory-deletable.mjs` proves that in CI.

## API (0 values)

None. The surface is data:

| item | what it is |
|---|---|
| `flows/forge-docs/flow.yaml` | the flow: `build` (docs-writer) → `integrate` (docs-integrate, resumable) → `review` (docs-review) → `verdict` (a gate). Class `docs`, `costCeilingUsd: 12`, no reflect. |
| `skills/docs-writer/SKILL.md` | runs the Ralph loop on one docs work item until the docs gate passes or its budget ends |
| `skills/docs-integrate/SKILL.md` | the declaration for the platform's integrate band; no model is spawned |
| `skills/docs-review/SKILL.md` | the one read-only review agent, under a single accuracy-against-source lens; it judges and never edits |

Every station dispatches through the platform's existing executors in
`@forge/stations`; this package adds no station of its own.

## Crash and recovery

This package holds no state and performs no I/O. A run of this flow keeps its
durable state where every flow does: the queue, cycle logs and resume points
of `@forge/flows`, and the band executors of `@forge/stations`. Their READMEs
say what a crash leaves behind and how it resumes.
