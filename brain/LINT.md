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

### Raw sources

> Raw-source lint is not enforced by the automated `brain-lint` tool — these are conventions enforced by the `brain-ingest` skill at write time.

1. **Frontmatter present.** `source_type`, `source_url` (if applicable), `source_title`, `ingested_at`, `ingested_by`.
2. **Filename matches frontmatter.** `<slug>.<source_type>.md`.
3. **Append-only.** Never edit a raw file after creation; corrections are new raw sources with a supersession note in the theme page.

### Category indexes

1. **Index entries match theme pages.** Every theme page in the corresponding category appears as a line in the index; no extra lines pointing at non-existent pages.
2. **One-line entries.** Each entry: `- [\`<slug>\`](./themes/<slug>.md) — <description>`. Multi-line entries reject.

### Per-project brains (Brain 3)

Project brains now live in each project's **own repo** at `projects/<name>/brain/`
(three-brain model, ADR 018) — they are not part of the forge repo and are linted
inside the project repo, not forge-side. Each carries its own `profile.md` +
`themes/` and follows the same theme-page + category-index discipline.

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
