# Brain — Meta-Index

> The brain is forge's persistent memory. This is the navigation hub: from here, drill into a category index → a theme page → the raw sources behind it.

**Status:** empty (scaffold). Seeding happens in two passes per [`docs/seeding-plan.md`](../docs/seeding-plan.md).

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

## Per-project sub-wikis

> Empty until Pass B seeds them and cycles populate them. Each project gets its own folder under `projects/<name>/` with a `profile.md` (who/what/taste) and `themes/`.

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
