# Brain — Lint Rules

> Structural integrity rules enforced by the `brain-lint` skill. These are *tooling*, not content — they apply regardless of what the brain holds.

## Rules

### Theme pages

1. **Frontmatter present and valid.**
   - Required fields: `title`, `description`, `category`, `created_at`, `updated_at`.
   - `category` must be one of: `pattern`, `antipattern`, `decision`, `operation`, `reference`.
2. **Indexed in exactly one category index.** Each category lives in its owning sub-wiki (three-brain model, ADR 018): `pattern`/`antipattern`/`operation` themes live in `cycles/` and index into `cycles/{patterns,antipatterns,operations}.md`; `decision`/`reference` themes live in `forge-dev/` and index into `forge-dev/{decisions,reference}.md`. A theme must appear once on its category index and not on any other.
3. **Body length ≤ 60 lines.** Soft cap; warn at 60, error at 100. Counts **body lines only** (post-frontmatter) — YAML frontmatter is structured metadata and doesn't count against the prose cap. (`description` participates in brain-query relevance via the one-liner on the category index; `keywords` is read by the contradiction lint and is a search-term aid for the human/agent reading a theme — it is not yet wired into brain-query retrieval.) Long pages should be split.
4. **No source link broken.** Every link target must exist (`checkSourceLinks`).
5. **No orphan.** Every theme page must be reachable from `INDEX.md` via category indexes.
6. **Stale citations flagged.** Backtick-wrapped forge-internal paths (`orchestrator/`, `skills/`, `docs/`, `loops/`) that no longer exist in the repo are flagged as stale (`checkStaleness`).
7. **Near-duplicate themes flagged.** A normalized-title collision, or a keyword Jaccard overlap above the threshold, flags the pair for a merge decision (`checkDuplicateThemes`). Flag severity — merging needs the fuller content of both files, so it never gates.
   - **`recurrence: <series>`** (optional) declares that a theme is one record of a named recurrence series — the same failure captured once per cycle it recurred in, where the count is the evidence. Two themes declaring the *same* series are not duplicates of each other; every other pairing, including against an undeclared near-duplicate, still flags. Declare it on **every** member of the series. It is a statement about the brain's content, not a lint suppression: use it only where merging the pages would destroy an argument that rests on the number of occurrences (gitpulse's `gitignored-scratch-files` series is the worked example — its sixth record is the evidence cited for a decomposition-time fix).

### Raw sources

> Raw-source lint is not enforced by the automated `brain-lint` tool — these are conventions enforced by the `brain-ingest` skill at write time.

1. **Frontmatter present.** `source_type`, `source_url` (if applicable), `source_title`, `ingested_at`, `ingested_by`.
2. **Filename matches frontmatter.** `<slug>.<source_type>.md`.
3. **Append-only.** Never edit a raw file after creation; corrections are new raw sources with a supersession note in the theme page.

### Category indexes

1. **Index entries match theme pages.** Every theme page in the corresponding category appears as a line in the index; no extra lines pointing at non-existent pages.
2. **One-line entries.** Each entry: `- [\`<slug>\`](./themes/<slug>.md) — <description>`. Multi-line entries reject.

### Per-project brains (Brain 3)

Project brains are **forge-owned and central**, at `brain/projects/<name>/`
([ADR 035](../docs/decisions/035-forge-owned-central-artifacts.md), which
reversed ADR 018's in-repo location so the reflector can write one post-merge
without an open project worktree). They are part of this repo and are linted
by `forge brain lint` like any other brain. Each carries its own category
indexes + `themes/` and follows the same theme-page discipline, with two
deliberate exemptions: the category→sub-wiki routing rule (`pattern`→`cycles`,
`decision`→`forge-dev`) governs the two forge sub-wikis only, and a project
brain's category-index sync is checked by `checkProjectBrainIndexes` against
its OWN indexes rather than by `checkIndexSync` against the forge ones.

A relative link into `projects/<name>/` — the managed project's **ground
clone** — is not checked. Those clones are gitignored working copies of other
repositories, present locally and absent in CI, so a link into one would
resolve or break according to the environment rather than the brain.

### INDEX.md

1. **Lists all categories** across the two forge sub-wikis: `cycles/{patterns,antipatterns,operations}.md` (Brain 2) and `forge-dev/{decisions,reference}.md` (Brain 1).
2. **Reports per-brain counts** (themes, raw sources) with one-line descriptions.

### Conflicts

1. **No two theme pages with identical `title`.** Reject.
2. **Conflicting claims** — `brain-lint` cannot detect these structurally; raises ambiguous content for human review when its confidence is low (per the architect's design note in the diagram).

## Failure handling

- **Auto-fix** for safe cases (move a misindexed entry to the correct category index, normalise frontmatter ordering, fix broken filenames).
- **Surface** for ambiguous cases (conflicting claims, content drift, possible duplicates).
- **Never silently delete content.** Lint may move; it never deletes. Deletion is a `brain-ingest` operation with explicit input.

## Scope

- `brain-lint` is invoked at the end of every cycle (gating retro completion) and on demand.
- It writes a report to `_logs/<cycle-id>/brain-lint.md` with categories: `auto-fixed`, `flagged`, `errors`.
