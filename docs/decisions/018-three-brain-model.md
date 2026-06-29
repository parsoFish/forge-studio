# ADR 018 — Three-brain structural model

**Status:** Accepted
**Date:** 2026-05-26

## Context

The original brain was a single Obsidian vault at `brain/` covering everything:
forge engineering knowledge, cycle-derived patterns, and per-project taste profiles.
This caused two problems:

1. **Signal mixing** — forge source knowledge, cycle-derived patterns, and
   project-specific taste profiles lived in the same directory tree, making
   `brain-lint` and `brain-query` scope filtering awkward and error-prone.

2. **Project brain portability** — project brains were nested inside the forge
   repo at `brain/projects/<name>/`. This coupled project knowledge to forge's
   commit history, made project-scoped knowledge graphs impossible, and complicated
   the workflow for projects that forge manages (each project's brain should travel
   with the project, not with the tool running it).

The Tier 4 audit (2026-05-26) confirmed five ghost project brains with no repo,
and three live project brains that needed migration.

## Decision

Split into three scoped brains:

### Brain 1 — forge-dev (`brain/forge-dev/`)

Forge TypeScript source knowledge, ADRs, engineering notes, and build-time
reference material. Read by the architect and PM when working on forge itself.

### Brain 2 — cycles (`brain/cycles/`)

Cycle-derived patterns, antipatterns, operations, architectural decisions, and
raw cycle archives. This is the primary brain for forge's operational knowledge —
what every planning phase reads.

Category indexes:
- `brain/cycles/patterns.md`
- `brain/cycles/antipatterns.md`
- `brain/cycles/operations.md`
- `brain/cycles/decisions.md`

### Brain 3 — per-project (`<project-repo>/brain/`)

> **Superseded on location by [ADR 035](./035-forge-owned-central-artifacts.md) (2026-06-20):** Brain 3 now lives **centrally in the forge repo** at `brain/projects/<name>/themes/`, not in the project repo. The three-brain *scoping* still stands; only the *location* described in this section is reversed.

Lives inside each managed project's own repo, not in the forge repo. Contains
taste profiles, project-specific patterns, and project cycle archives.

Accessed at `projects/<name>/brain/` when the project is checked out under
forge's `projects/` directory (gitignored; each project remains an independent
git repo).

## Rationale for Brain 3 location

- **Project portability** — the project brain travels with the project. If the
  project is managed by a different forge instance, the brain comes with it.
- **Commit isolation** — project brain writes don't pollute forge's commit history.
- **Per-project scope** — each project's brain is a self-contained wiki over its
  own code and themes.
- **Preflight check** — `forge preflight` (C4) verifies `<project-dir>/brain/profile.md`
  exists, failing fast when the project hasn't been onboarded.

## Impact on brain-first policy (ADR 010)

The brain-first policy (amended 2026-05-16) stays the same for Brains 1+2.
For Brain 3: dev-loop and reviewer MAY read the project's Brain 3 for
supplemental context, but this is advisory. The planner (PM) MUST include
all relevant project constraints in the work items regardless.

## Consequences

**Positive:**
- Clean scope separation for `brain-query` and `brain-lint`
- Project brains travel with projects
- Each brain is an independently-scoped wiki
- forge commit history is not polluted with project knowledge writes

**Negative / accepted trade-offs:**
- `forge brain lint` cannot lint project brain files (they're in separate repos)
- Cross-brain wikilinks (cycles theme referencing a project theme) require
  `../../projects/<name>/brain/themes/` relative paths — longer but explicit
- The brain index (`forge brain index --write`) must scan `projects/*/brain/` which
  only works when projects are checked out under `projects/`

## Migration

2026-05-26 migration committed:
- `brain/forge/{themes,patterns,antipatterns,operations}.md` → `brain/cycles/`
- `brain/forge/{decisions,reference}.md` → `brain/forge-dev/`
- `brain/log.md` → `brain/forge-dev/log.md`
- `brain/projects/mdtoc/` → `projects/mdtoc/brain/`
- `brain/projects/terraform-provider-betterado/` → `projects/terraform-provider-betterado/brain/`
- `brain/projects/trafficGame/` → `projects/trafficGame/brain/`
- `brain/projects/` removed from forge repo

Recovery tag: `brain-pre-restructure` at commit `86f936c`.

## References

- [ADR 004](./004-obsidian-wiki.md) — original brain structural decision
- [ADR 010](./010-brain-first.md) — brain-first research policy
- [`brain/cycles/themes/karpathy-three-layer-wiki.md`](../../brain/cycles/themes/karpathy-three-layer-wiki.md) — three-layer model
