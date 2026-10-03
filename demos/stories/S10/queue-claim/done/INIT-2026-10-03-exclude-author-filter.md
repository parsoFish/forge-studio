---
initiative_id: INIT-2026-10-03-exclude-author-filter
project: gitpulse
project_repo_path: /home/parso/forge-clean-m7e/projects/gitpulse
created_at: '2026-10-03T11:12:55.390Z'
iteration_budget: 9
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: src/author-filter.ts with existing filterAuthorCommits
    when: 'filterExcludeAuthor(commits, patterns) is called'
    then: >-
      returns only commits where neither commit.author nor commit.authorEmail
      matches any pattern (inline *-only regex, case-insensitive, NOT matchGlob
      from src/glob.ts); empty patterns array returns original array unchanged;
      unit tests cover: single pattern, multiple patterns (OR),
      case-insensitive, wildcard, empty-patterns identity, name-match,
      email-match
  - given: '--exclude-author "" (empty string) is passed on the CLI'
    when: argument parsing runs
    then: >-
      process exits with code 2 and prints exactly 'gitpulse: --exclude-author
      pattern cannot be empty string' to stderr — matching --author's
      established validation behaviour
  - given: a repo with commits from multiple authors
    when: gitpulse <repo> --exclude-author <pattern> is run (single-snapshot path)
    then: >-
      output excludes all commits where name or email matches the pattern;
      filterExcludeAuthor is applied in the single-snapshot runCli path
  - given: gitpulse <repo> --compare <branch> --exclude-author <pattern>
    when: the compare sub-path inside runCli executes
    then: >-
      filterExcludeAuthor is applied to BOTH headCommits AND baseCommits before
      the diff computation — explicit prevention of the RF-1 compare-path gap
      class (brain: 2026-08-31-author-filter-compare-coverage-gap.md); note:
      pre-existing --author gap on this path is NOT fixed by this initiative
  - given: gitpulse tags <repo> --exclude-author <pattern>
    when: per-span aggregation runs in runTagsCli
    then: filterExcludeAuthor is applied to each span's commits before summarize
  - given: gitpulse coupling <repo> --exclude-author <pattern>
    when: runCouplingCli executes
    then: >-
      filterExcludeAuthor is applied after readCommits and before
      computeCoupling
  - given: >-
      both --author <include-pattern> and --exclude-author <exclude-pattern> are
      given
    when: >-
      filters are applied in runCli (single-snapshot and compare paths),
      runTagsCli, and runCouplingCli
    then: >-
      filterAuthorCommits runs first (narrows to matching set), then
      filterExcludeAuthor removes from that result; a commit survives only if it
      matches an --author pattern AND does NOT match any --exclude-author
      pattern
  - given: a non-empty repo
    when: gitpulse <repo> --exclude-author "*" is run
    then: >-
      output reports zero commits without error (not an error, valid zero-output
      path); text header carries excludedAuthors reflecting total count; JSON
      authorsExcluded equals total commit count; CSV # authorsExcluded comment
      reflects the same count
  - given: a repo with commits
    when: gitpulse <repo> --exclude-author "pattern-matching-nobody" is run
    then: >-
      output is byte-identical to gitpulse <repo> with no filter — the no-match
      identity invariant is verified by an acceptance assertion
  - given: '--exclude-author is active (alone or with --author)'
    when: 'output is rendered in text, JSON, and CSV modes'
    then: >-
      text header carries 'excludedAuthors: N'; JSON output carries
      authorsExcluded: N field (not _ -prefixed, always read at the call site);
      CSV carries '# authorsExcluded: N' comment line; when both --author and
      --exclude-author are active, both authorsFiltered and authorsExcluded
      appear in all three output formats
title: Add --exclude-author filter flag
worktree_path: /home/parso/forge-clean-m7e/_worktrees/INIT-2026-10-03-exclude-author-filter
cycle_id: 2026-10-03T11-14-20_INIT-2026-10-03-exclude-author-filter
flow_id: forge-develop
architect_session_id: 2026-10-03T11-08-18-ca24c432
architect_cost_usd: 1.7650382999999998
architect_duration_ms: 361012
resume_from: develop
review_rounds: 1
specs:
  - WI-1
  - WI-2
  - WI-3
  - WI-4
---

## Context

`--author` (src/author-filter.ts, `filterAuthorCommits`) narrows commits to those matching one or more glob patterns against name+email. This initiative adds its inverse: `--exclude-author <pattern>` removes matching commits from the set. Implementation extends `src/author-filter.ts` with `filterExcludeAuthor` — same inline `*`-only regex builder, same Commit fields (authorEmail is already non-optional), no new source file, no new Commit field sweep.

Composition when both flags are given: apply `filterAuthorCommits` first (narrows to matching set), then `filterExcludeAuthor` removes from that result. A commit survives only if it matches an `--author` pattern AND does NOT match any `--exclude-author` pattern. This canonical order is stated in the CLI `--help` output.

**Brain constraints applied:**
- Inline `*`-only regex builder — NOT `matchGlob` from `src/glob.ts` (path-segment semantics don't apply to author strings). _(brain/projects/gitpulse/themes/2026-08-31-author-filter-flag-delivery.md)_
- All 4 aggregation paths named as explicit AC sub-items; `compare` is a sub-path of `runCli`, not a top-level function. _(brain/projects/gitpulse/themes/2026-09-04-compare-path-gap-pre-empted-by-explicit-ac.md)_
- Never `_`-prefix options params that will be read — silent discard is invisible to compiler and linter. _(brain/projects/gitpulse/themes/2026-09-05-unused-opts-param-silent-tagrange-discard.md)_
- Zero runtime dependencies; `src/author-filter.ts` has no external imports — keep it that way. _(brain/projects/gitpulse/profile.md)_

## Scope

### In scope
- `filterExcludeAuthor(commits, patterns)` in `src/author-filter.ts`, unit-tested.
- `--exclude-author` flag parsed in `src/cli.ts`; empty-string pattern rejected with exit 2.
- Applied in all four aggregation paths: single-snapshot `runCli`, compare sub-path of `runCli` (both `headCommits` and `baseCommits`), `runTagsCli` per-span, `runCouplingCli` before `computeCoupling`.
- Composition with `--author`: `filterAuthorCommits` first, then `filterExcludeAuthor`.
- Output annotations: text header `excludedAuthors: N`, JSON field `authorsExcluded: N`, CSV comment `# authorsExcluded: N`; both `authorsFiltered` and `authorsExcluded` present when both flags active.
- `--help` updated with flag description and precedence note.

### Not in scope
- Fixing the pre-existing `--author` compare-branch gap (silently discarded on the `if (compare !== null)` path). This initiative wires `--exclude-author` correctly on the compare path but does NOT repair `--author` on that path — a separate initiative owns that. ACs here must not imply the `--author` gap is closed.
- Any new Commit field or fixture factory sweep (authorEmail is already non-optional).
- Interactive / TUI mode.

## Implementation notes

- `filterExcludeAuthor(commits: Commit[], patterns: string[]): Commit[]` — returns `commits` unchanged when `patterns` is empty; otherwise filters out any commit where `authorName` or `authorEmail` matches any pattern (case-insensitive, `*`-only wildcard via inline regex).
- CLI parsing: validate each `--exclude-author` value before constructing the filter; reject empty string immediately (exit 2, stderr message).
- Apply filters in `runCli` after the existing `applyExclusions` / `applyInclusions` / `filterAuthorCommits` chain; apply in the compare sub-path to BOTH arrays before diff.
- `runTagsCli`: apply per-span after commit slice, before `summarize`.
- `runCouplingCli`: apply after `readCommits`, before `computeCoupling`.
