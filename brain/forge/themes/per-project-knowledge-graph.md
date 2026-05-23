---
title: Per-project knowledge graph (graphify) alongside the forge brain graph
description: >-
  Each managed project gets its own graphify graph in its own repo. Dev-loop /
  unifier consult it for code questions without traversing forge's brain. Forge
  brain stays scoped to forge; project graphs stay scoped to project code.
category: pattern
keywords:
  - graphify
  - per-project
  - knowledge-graph
  - dev-loop
  - unifier
  - scope-isolation
  - onboarding
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes:
  - forge-project-onboarding-contract
  - forge-never-self-modifies
  - karpathy-three-layer-wiki
---

# Per-project knowledge graph (graphify) alongside the forge brain graph

## Pattern

Each managed project has its own `<project-root>/graphify-out/graph.json`,
built via `cd <project-root> && graphify update . && graphify hook install`.
The forge brain graph at `brain/graphify-out/` (C20-C22 + C21a) stays scoped
to forge knowledge; project graphs stay scoped to project code. They do not
share corpus.

## Why two graphs, not one

A prior attempt mixed them and ripped it out: forge's brain had to know
project code shape, the dev-loop loaded forge-brain context for project-local
questions, and the largest project dominated community structure. The split
keeps consumers focused — dev-loop / unifier query the project graph,
architect / PM / reflector query the forge brain graph.

## When the dev-loop consults the project graph

A project graph is in scope iff `<project-root>/graphify-out/graph.json`
exists. The agent prefers it over grep for structural questions about that
project's own code: `graphify query/path/explain` for forward traversal,
`graphify affected` for reverse. Absent graph → grep fallback, no skill
change forced.

## Onboarding (operator runbook)

```bash
cd /home/parso/forge/projects/<name>
graphify update .            # initial build, no API key needed
graphify hook install        # post-commit + post-checkout auto-rebuild
```

Add a `.graphifyignore` if `.gitignore` is too permissive (vendored deps,
generated docs). See `projects/terraform-provider-betterado/.graphifyignore`
for a worked example (excludes `vendor/`, `website/`, `docs/`).

The project's `graphify-out/` is per-clone by default; the operator decides
per-project whether to commit `graph.json` (mirrors forge's C21 choice).

## Trust graphify's own confidence tiers

Edges carry `EXTRACTED` / `INFERRED` / `AMBIGUOUS` tiers. Consume as-is — do
NOT build parallel filters; graphify owns the confidence model.

## Sources

- `projects/trafficGame/graphify-out/graph.json` — first per-project install (2026-05-23, 225 files / 2524 nodes / 4001 edges).
- `projects/terraform-provider-betterado/graphify-out/graph.json` — second install (569 files / 5934 nodes / 12230 edges; vendor/website/docs excluded).
- `docs/planning/2026-05-20-refinement/CONTRACTS.md` C20-C22 (forge brain graph) + C21a (corpus scope).

## See also

- [[forge-project-onboarding-contract]] — the forge↔project contract — six clauses a project must meet for unattended progress.
- [[forge-never-self-modifies]] — forge never self-modifies while running.
- [[karpathy-three-layer-wiki]] — karpathy three-layer llm wiki.
