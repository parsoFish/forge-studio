# Brain — Meta-Index

> The brain is forge's persistent memory. This is the navigation hub: from here, drill into a category index → a theme page → the raw sources behind it.

**Status:** Pass A + Pass B complete. The brain holds **48 forge-level theme pages**, **15 project-level theme pages** (across 5 sub-wikis), **37 raw sources** (`_raw/docs/`, `_raw/web/`, `_raw/v1-wiki/`), and a benchmark question set. See [`docs/seeding-plan.md`](../docs/seeding-plan.md) and [`log.md`](./log.md).

## How to use this wiki

1. Start here. Pick a category or project below.
2. Open the category index — it lists theme pages with one-line descriptions.
3. Open a theme page — it summarises the topic in 15-40 lines and links to raw sources.
4. Follow raw links into [`_raw/`](./_raw/) when the theme page isn't enough.
5. For keyword search across raw: `grep -r '<term>' brain/_raw/`.

## Forge-system knowledge

- [Patterns](./forge/patterns.md) — proven approaches that work.
- [Antipatterns](./forge/antipatterns.md) — proven approaches that don't.
- [Decisions](./forge/decisions.md) — ADRs and the reasoning behind durable choices.
- [Operations](./forge/operations.md) — how to run / monitor / recover the system.
- [Reference](./forge/reference.md) — system overviews, profiles, comparisons, glossaries.

## Per-project sub-wikis

Each project has a `profile.md` (who / what / taste / hard-constraints) and a `themes/` directory with project-specific patterns, antipatterns, and decisions.

- [trafficGame](./projects/trafficGame/profile.md) — TypeScript/Vite traffic-simulation game with campaign mode.
- [env-optimiser](./projects/env-optimiser/profile.md) — WSL2 dev-environment optimiser; local-first, constitutional principles.
- [simplarr](./projects/simplarr/profile.md) — Plex/*arr media-stack setup tooling (Bash + PowerShell parity).
- [GitWeave](./projects/GitWeave/profile.md) — GitHub-org control repo / platform-as-code (Terraform + Actions).
- [healarr](./projects/healarr/profile.md) — self-healing agent for Plex/*arr stacks (deterministic triage + tier-coded agent).

## Conventions

- **Three layers**: `_raw/` (immutable raw sources) → `forge/themes/` and `projects/<name>/themes/` (15-40-line theme pages indexing the raw layer) → category index pages and this INDEX (pure navigation).
- **No long summaries** — many small theme pages > few large summaries (Karpathy).
- **Theme page format** — see [`forge/themes/README.md`](./forge/themes/README.md).
- **Lint rules** — see [`LINT.md`](./LINT.md).
- **Operations log** — append significant operations to [`log.md`](./log.md).

## Maintenance

- `forge brain query "<question>"` — query the brain.
- `brain-lint` skill — runs structural integrity checks; flags orphans, malformed frontmatter, conflicts.
- `brain-ingest` skill — appends raw sources, creates new theme pages, never modifies raw.
