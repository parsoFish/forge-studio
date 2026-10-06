---
initiative_id: INIT-2026-10-06-exclude-author-flag
project: gitpulse
project_repo_path: /home/parso/forge-docs-w0w1-run/projects/gitpulse
created_at: '2026-10-06T04:00:35.482Z'
iteration_budget: 9
cost_budget_usd: 4
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice and
      sentinel-bob
    when: the built artifact is run with `--exclude-author sentinel-alice`
    then: >-
      exit 0; sentinel-alice absent from all output; sentinel-bob stats present;
      verifies single-snapshot runCli pipeline is wired
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice and
      sentinel-bob and two comparable refs
    when: >-
      the built artifact is run with `--compare <ref> --exclude-author
      sentinel-alice`
    then: >-
      exit 0; sentinel-alice absent from both snapshot and compare sides of
      output; verifies the compare sub-path is wired (prior RF-1 recurring miss
      — source: brain/projects/gitpulse/antipatterns.md →
      2026-08-31-author-filter-compare-coverage-gap)
  - given: >-
      a deterministic fixture repo with tags and commits by sentinel-alice and
      sentinel-bob
    when: the built artifact is run with `tags --exclude-author sentinel-alice`
    then: >-
      exit 0; sentinel-alice absent from tags output; sentinel-bob present;
      verifies runTagsCli pipeline is wired
  - given: >-
      a deterministic fixture repo with coupling data and commits by
      sentinel-alice and sentinel-bob
    when: the built artifact is run with `coupling --exclude-author sentinel-alice`
    then: >-
      exit 0; only sentinel-bob commits feed coupling analysis; verifies
      runCouplingCli pipeline is wired
  - given: a deterministic fixture repo with commits by sentinel-alice
    when: >-
      the built artifact is run with `--author sentinel-alice --exclude-author
      sentinel-alice`
    then: >-
      exit 0; output contains zero rows / zero authors; exclude-wins precedence
      holds; combined annotation surfaces both filters
  - given: >-
      a deterministic fixture repo where all commits are authored by
      sentinel-alice
    when: the built artifact is run with `--exclude-author '*'`
    then: >-
      exit 0; zero-row output with no crash; all aggregators (stats.ts,
      format.ts) handle empty Commit[] safely
  - given: any git repo
    when: >-
      the built artifact is run with `--exclude-author ''` (empty-string
      pattern)
    then: >-
      exit 2; error message on stderr describing invalid pattern; no commits
      processed; consistent with --author empty-string behaviour
  - given: a deterministic fixture repo
    when: the built artifact is run WITHOUT any --exclude-author flag
    then: >-
      output is byte-identical to output produced before this feature was added;
      no regression on unfiltered runs
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice and
      sentinel-bob
    when: the built artifact is run with `--exclude-author sentinel-alice --json`
    then: >-
      exit 0; JSON output contains top-level field `authorsExcluded: 1`;
      annotation injected inline in cli.ts without routing through renderer opts
      struct (prevents silent-discard trap — source:
      brain/projects/gitpulse/antipatterns.md →
      2026-09-05-unused-opts-param-silent-tagrange-discard)
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice and
      sentinel-bob
    when: the built artifact is run with `--exclude-author sentinel-alice --csv`
    then: >-
      exit 0; CSV output contains comment line `# authors excluded: 1`; data
      rows contain only sentinel-bob
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice and
      sentinel-bob
    when: >-
      the built artifact is run with `--exclude-author sentinel-alice
      --markdown`
    then: >-
      exit 0; markdown header contains exclusion annotation; annotation injected
      inline in cli.ts (not via _opts parameter — same prevention as AC-9)
  - given: >-
      a deterministic fixture repo with commits by sentinel-alice, sentinel-bob,
      and sentinel-carol
    when: >-
      the built artifact is run with `--exclude-author sentinel-alice
      --exclude-author sentinel-bob` (two flags)
    then: >-
      exit 0; only sentinel-carol commits in output; OR-combination semantics
      verified; repeatable flag works
  - given: src/author-filter.ts and src/cli.ts in the repository
    when: the filterExcludedAuthors function is inspected via grep
    then: >-
      filterExcludedAuthors is exported from src/author-filter.ts AND present in
      the cli.ts import statement AND called at all four pipeline sites
      (single-snapshot, compare, tags, coupling); no dead-code gap (source:
      brain/projects/gitpulse/antipatterns.md →
      2026-08-31-tag-range-dead-code-ac4-wire)
title: Add --exclude-author filter flag
worktree_path: /home/parso/forge-docs-w0w1-run/_worktrees/INIT-2026-10-06-exclude-author-flag
cycle_id: 2026-10-06T04-01-27_INIT-2026-10-06-exclude-author-flag
flow_id: forge-develop
architect_session_id: 2026-10-06T03-53-34-d7138e75
architect_cost_usd: 2.1157339000000004
architect_duration_ms: 472978
resume_from: develop
review_rounds: 1
specs:
  - WI-1
  - WI-2
  - WI-3
  - WI-4
---

## Context

The existing `--author <pattern>` flag (v0.13.0) filters commits to a named-author inclusion set. Operators now need the symmetric exclusion: `--exclude-author <pattern>`. The implementation mirrors `--author` in every mechanical detail and must compose with it and with every other filter already on the CLI.

## Technical approach

### src/author-filter.ts
- Add `filterExcludedAuthors(commits: Commit[], patterns: string[]): Commit[]` — pure, zero-I/O, uses the existing `buildPattern()` helper. No new file. No new dependency.
- Export from the same module; import in `src/cli.ts`.

### src/cli.ts — four pipelines, all wired
1. **Single-snapshot `runCli`** — apply `filterExcludedAuthors` after `filterAuthorCommits` (author-include → author-exclude; exclude wins).
2. **Compare sub-path** (`if (compare !== null)` block, ~line 925) — same call; this is the recurring RF-1 miss site from the `--author` cycle.
3. **`runTagsCli`** — same call in the tags pipeline.
4. **`runCouplingCli`** — same call in the coupling pipeline.

The function MUST appear in the cli.ts `import` statement and be called in all four paths — unit-testing in isolation is insufficient (antipattern: tag-range dead-code gap).

### Precedence rule
When `--author` and `--exclude-author` are both present: apply `--author` inclusion first, then `--exclude-author` exclusion. **Exclude wins.** Edge: `--author alice --exclude-author alice` → empty result.

### Filter order in the pipeline
Tag-range → no-merges → path-exclude → path-include → author-include → **author-exclude** (new, last). Deterministic; commutative with every prior filter.

### Annotations — inline injection only
NEVER route annotation counts through renderer `_opts` parameters (prevents the `renderSummaryMarkdown _opts` silent-discard trap, RF-1 major from prior cycle). Inject inline in `cli.ts` before calling any renderer:
- **Text**: header suffix `(excluding N author(s))`.
- **JSON**: top-level field `authorsExcluded: N`.
- **CSV**: comment line `# authors excluded: N`.
- **Markdown**: header line annotation, same inline-injection pattern.
- **Combined `--author` + `--exclude-author`**: surface both counts explicitly.

### Acceptance tests
Fixture repo deterministic, non-default sentinel authors (e.g. `sentinel-alice`, `sentinel-bob`, `sentinel-carol`). Assert BUILT artifact output.

## Not in scope
- Negated glob syntax (`!pattern`) — not requested; defer.
- `--exclude-author` in the dashboard HTTP server — M3 work.
- Fixing the gitignored-scratch-file recurrence (10-cycle antipattern) — tracked as deferred below; no delivery impact and not this initiative's scope.
- Any change to `src/git.ts` — git-truth seam is read-only for this work.

## Deferred
- **Gitignored scratch files (fix_plan.md / AGENT.md) recurrence** — 10 consecutive gitpulse cycles; `projects/gitpulse/AGENT.md` worktree template still absent; autocommit safety net is the only guard. No delivery impact. Patching the template is a separate chore initiative.
