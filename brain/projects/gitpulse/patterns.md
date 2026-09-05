# gitpulse — Patterns

> Category index. Lists theme pages describing **proven approaches that work in this project**.

`brain-lint` ensures every theme page with `category: pattern` appears here exactly once.

## Theme pages

- [`2026-06-21-json-output-flag-delivery`](./themes/2026-06-21-json-output-flag-delivery.md) — >-
- [`2026-06-21-single-iteration-4wi-milestone-delivery`](./themes/2026-06-21-single-iteration-4wi-milestone-delivery.md) — >-
- [`2026-06-21-single-iteration-delivery-tdd-pure-modules`](./themes/2026-06-21-single-iteration-delivery-tdd-pure-modules.md) — >-
- [`2026-06-22-single-iteration-tdd-with-4-wi-chain`](./themes/2026-06-22-single-iteration-tdd-with-4-wi-chain.md) — >-
- [`2026-07-11-csv-output-flag-delivery`](./themes/2026-07-11-csv-output-flag-delivery.md) — >-
- [`2026-07-11-exclude-path-filter-single-seam`](./themes/2026-07-11-exclude-path-filter-single-seam.md) — >-
- [`2026-07-11-tags-command-delivery`](./themes/2026-07-11-tags-command-delivery.md) — gitpulse tags subcommand (release-cadence table with JSON/CSV/filter support) delivered via 4-WI TDD chain; WI-1+WI-2 in 1 iter each, WI-3+WI-4 absorbed by unifier in 1 iter.
- [`2026-07-12-sort-flag-delivery`](./themes/2026-07-12-sort-flag-delivery.md) — >-
- [`git-truth-and-pure-aggregation`](./themes/git-truth-and-pure-aggregation.md) — >-
- [`2026-08-28-no-merges-flag-delivery`](./themes/2026-08-28-no-merges-flag-delivery.md) — Global --no-merges flag added via parentCount at the git-truth seam; filterMergeCommits() applied once in cli.ts before any aggregation; 3-WI TDD chain, all 1-iter, all 20 test fixture files updated for required Commit field.
- [`2026-08-31-author-filter-flag-delivery`](./themes/2026-08-31-author-filter-flag-delivery.md) — Repeatable --author <glob> flag via src/author-filter.ts; OR-semantics, name+email, case-insensitive, *-only wildcard; 3-WI TDD chain all 1-iter; authorEmail breaking-change sweep updated 27 fixture factories.
- [`2026-08-31-tag-range-filter-delivery`](./themes/2026-08-31-tag-range-filter-delivery.md) — --since-tag / --until-tag release-window filter delivered via src/tag-range.ts; annotated+lightweight tag dereference; all four CLI paths wired; text/JSON/CSV renderers carry range annotation; 3-WI TDD chain all 1-iter; resolveEffectiveBounds dead code post-merge (RF-1).

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-09-05-markdown-output-flag-delivery`](./themes/2026-09-05-markdown-output-flag-delivery.md) — The --markdown flag follows the symmetric renderer-pair pattern: 6 new exports in format.ts (markdownEscape, gfmTable private, 4 renderers), all 4 CLI code paths wired, mutual exclusion with --json/--csv. 3 WIs, all iter=1. RF-1 major: renderSummaryMarkdown silently discards tagRange.

- [`2026-09-04-include-path-filter-delivery`](./themes/2026-09-04-include-path-filter-delivery.md) — `applyInclusions(commits, patterns)` inlined in src/cli.ts (mirrors applyExclusions). Applied in all 4 CLI code paths including the compare branch — explicitly pre-empting the RF-1 gap from the prior --author cycle. 3-WI TDD chain, all 1 iteration. +1225/-34, 6 files, PR #15, v0.14.0.

- [`2026-09-04-compare-path-gap-pre-empted-by-explicit-ac`](./themes/2026-09-04-compare-path-gap-pre-empted-by-explicit-ac.md) — Prior cycle's RF-1 major (--author silently discarded on --compare path) was converted to an explicit acceptance criterion (AC-2.2) and acceptance assertion (AC-5) in this cycle's manifest. No review send-back. Lesson-to-spec propagation via brain → PM → WI ACs is the effective prevention path.
