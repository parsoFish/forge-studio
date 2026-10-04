---
initiative_id: INIT-2026-10-04-exclude-author-filter
project: gitpulse
project_repo_path: /home/parso/forge-clean-m7e/projects/gitpulse
created_at: '2026-10-04T18:32:29.016Z'
iteration_budget: 9
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      src/author-filter.ts exports filterExcludeAuthorCommits(commits,
      patterns); fixture commits include 'Ada Smith' (name) and a commit with
      authorEmail 'bob@example.com'; patterns are ['Ada*', 'bob*']
    when: >-
      filterExcludeAuthorCommits is called with the fixture commits and those
      patterns
    then: >-
      commits whose name matches Ada* are excluded; commits whose email matches
      bob* are excluded; unmatched commits are returned unchanged; OR-semantics
      apply (name OR email match triggers exclusion); matching is
      case-insensitive; an inline glob matcher is used (not src/glob.ts);
      repeatable patterns are all evaluated
  - given: >-
      WI-1 implementation is complete and filterExcludeAuthorCommits is defined
      in src/author-filter.ts
    when: grep -q 'filterExcludeAuthorCommits' src/cli.ts
    then: >-
      exits 0, confirming the function is imported and called in the CLI
      (dead-code guard; source:
      brain/projects/gitpulse/themes/2026-09-04-include-path-filter-delivery.md)
  - given: >-
      the built binary and a fixture repo containing sentinel commits from
      author 'Exclude Sentinel'
    when: gitpulse <repo> --exclude-author 'Exclude Sentinel'
    then: >-
      commits by 'Exclude Sentinel' are absent from the output;
      excludeAuthorsFiltered count in the text annotation equals the number of
      excluded commits; all other authors' counts are unchanged
  - given: >-
      the built binary and a fixture repo with sentinel commits from 'Exclude
      Sentinel' on both the head branch and a compare base branch
    when: gitpulse <repo> --compare <branch> --exclude-author 'Exclude Sentinel'
    then: >-
      filterExcludeAuthorCommits is applied to both headCommits AND baseCommits
      before each summarize() call; 'Exclude Sentinel' is absent from both the
      head and base summaries; commit count for 'Exclude Sentinel' is 0 in both
      branches (closes RF-1 compare-path gap; source:
      brain/projects/gitpulse/themes/2026-08-31-author-filter-compare-coverage-gap.md)
  - given: >-
      the built binary and a fixture repo with tagged releases where sentinel
      author 'Tags Sentinel' has commits in a known span
    when: gitpulse tags <repo> --exclude-author 'Tags Sentinel'
    then: >-
      filterExcludeAuthorCommits is applied per-span before per-span
      aggregation; 'Tags Sentinel' is absent from the span(s) containing their
      commits; all other spans are unaffected
  - given: >-
      the built binary and a fixture repo where sentinel author 'Coupling
      Sentinel' has file-coupling commits
    when: gitpulse coupling <repo> --exclude-author 'Coupling Sentinel'
    then: >-
      filterExcludeAuthorCommits is applied before coupling aggregation;
      coupling scores reflect only commits from non-excluded authors; output
      differs from an unfiltered run by the sentinel's contribution
  - given: >-
      the built binary and a fixture repo where N > 0 commits by 'Annotation
      Sentinel' exist
    when: >-
      gitpulse <repo> --exclude-author 'Annotation Sentinel' is run without
      --json/--csv, then with --json, then with --csv
    then: >-
      text output header contains '(N commits excluded by author-exclusion
      filter)' where N equals excluded count; JSON output contains field
      excludeAuthorsFiltered: N; CSV output contains line '#
      excludeAuthorsFiltered: N'; when the same repo is run with
      --exclude-author 'nonexistent-xyz-sentinel' (N=0), no annotation line
      appears in any format
  - given: the built binary
    when: >-
      gitpulse <repo> --exclude-author '' or gitpulse <repo> --exclude-author
      with no following argument token
    then: >-
      exits 2 with a message requiring a non-empty pattern; mirrors --author
      validation
  - given: the built binary and a fixture repo containing at least one commit
    when: gitpulse <repo> --exclude-author '*'
    then: >-
      exits 0; output contains zero commits or a zero-author-match message; no
      error or panic; no annotation (N=0 for all non-excluded commits)
  - given: the built binary and a fixture repo
    when: >-
      gitpulse <repo> --exclude-author 'nonexistent-xyz-sentinel' is run and
      compared byte-for-byte against an unfiltered run of gitpulse <repo>
    then: >-
      both outputs are byte-identical: same commit counts, same author list,
      same ordering, no annotation line in either output (source:
      brain/projects/gitpulse/themes/2026-08-31-author-filter-flag-delivery.md)
  - given: >-
      the built binary and a fixture repo containing commits from 'Ada Smith'
      and 'Ada Jones' (both matching 'Ada*')
    when: gitpulse <repo> --author 'Ada*' --exclude-author 'Ada Smith'
    then: >-
      output contains only 'Ada Jones' commits; 'Ada Smith' commits are absent;
      non-Ada authors are absent; confirmed that --author narrows first (include
      only Ada*) and --exclude-author then removes Ada Smith from that result
      (include-first-then-exclude semantics; source:
      brain/projects/gitpulse/themes/2026-08-31-author-filter-flag-delivery.md)
  - given: >-
      the built binary and a fixture repo with sentinel commits from 'Compare
      Exclude Sentinel' present in both the head branch history and the base
      branch history
    when: >-
      gitpulse <repo> --compare <branch> --exclude-author 'Compare Exclude
      Sentinel'
    then: >-
      dedicated assertion verifies: 'Compare Exclude Sentinel' commit count is 0
      in head summary AND 0 in base summary; if one side is non-zero the
      assertion fails; this is a dedicated test separate from the runCli
      single-snapshot AC (closes recurring compare-path gap class; source:
      brain/projects/gitpulse/themes/2026-09-04-compare-path-gap-pre-empted-by-explicit-ac.md)
  - given: >-
      the built binary and a fixture repo containing merges, known file paths,
      and a sentinel author with commits that touch excluded paths and include
      merges
    when: >-
      gitpulse <repo> --exclude-author 'Sentinel' --no-merges --exclude
      'excluded-path/*'
    then: >-
      sentinel author's commits are absent; merge commits are absent; commits
      touching excluded-path/* are absent; result reflects the composed filter
      chain (applyInclusions → applyExclusions → filterMergeCommits →
      filterAuthorCommits → filterExcludeAuthorCommits); commit count equals
      manual intersection of all three filters
  - given: README.md after the PR merges
    when: reading the --exclude-author flag documentation
    then: >-
      precedence rule is explicitly stated: '--author narrows first (keep only
      matching commits), --exclude-author then removes from that result'; a
      worked example with --author 'Ada*' --exclude-author 'Ada Smith' is shown;
      annotation format (text/JSON/CSV) is documented; flag is shown as
      repeatable and OR-combined
title: Add --exclude-author filter flag
worktree_path: /home/parso/forge-clean-m7e/_worktrees/INIT-2026-10-04-exclude-author-filter
cycle_id: 2026-10-04T18-34-03_INIT-2026-10-04-exclude-author-filter
flow_id: forge-develop
architect_session_id: 2026-10-04T18-25-38-e973a07d
architect_cost_usd: 2.1272053
architect_duration_ms: 504542
resume_from: develop
review_rounds: 1
specs:
  - WI-1
  - WI-2
  - WI-3
  - WI-4
---

## Context

`--exclude-author <pattern>` is the logical inverse of `--author`. When `--author` is also given, `--author` narrows first (keep only matching commits), then `--exclude-author` removes from that set. Repeatable, OR-combined. Pattern is a `*`-wildcard glob, case-insensitive, tested against both `commit.author` (name) and `commit.authorEmail` — exclusion fires if either matches.

## Spec

### 1. New function: `filterExcludeAuthorCommits(commits, patterns)`

Add to `src/author-filter.ts` alongside `filterAuthorCommits`. Use an **inline glob matcher** (split on `*`, case-insensitive regex) — **NOT `src/glob.ts`**: path-segment-aware semantics (`**`, slash normalisation) are wrong for author strings. Source: `brain/projects/gitpulse/themes/2026-08-31-author-filter-flag-delivery.md`.

OR-semantics: a commit is excluded if ANY pattern matches name OR email.

### 2. All 4 aggregation paths — named individually

Pipeline order in every path: `applyInclusions → applyExclusions → filterMergeCommits → filterAuthorCommits → filterExcludeAuthorCommits`.

- **`runCli` single-snapshot** — apply to `commits` before `summarize()`.
- **`runCli` `--compare` path** — apply to BOTH `headCommits` AND `baseCommits` before each `summarize()` call. `--author` silently skipped this path (RF-1 post-merge, 2026-08-31); cite explicitly in WI AC. Source: `brain/projects/gitpulse/themes/2026-08-31-author-filter-compare-coverage-gap.md`.
- **`runTagsCli`** — apply per-span before per-span aggregation.
- **`runCouplingCli`** — apply before coupling aggregation.

WI-1 dead-code guard in quality_gate_cmd: `grep -q 'filterExcludeAuthorCommits' src/cli.ts` — rejects a passing-unit-test that never wires into the CLI. Source: `brain/projects/gitpulse/themes/2026-09-04-include-path-filter-delivery.md`.

### 3. Annotation

When N > 0 commits excluded:
- Text: `(N commits excluded by author-exclusion filter)` in header.
- JSON: `excludeAuthorsFiltered: N`.
- CSV: `# excludeAuthorsFiltered: N`.

When N = 0: **no annotation** (mirrors `--author` suppression).

### 4. Precedence (--author + --exclude-author)

`--author` narrows first; `--exclude-author` removes from that result. Example: `--author 'Ada*' --exclude-author 'Ada Smith'` → all Ada* commits except Ada Smith. Document in README. Verified by a named acceptance assertion (AC-11).

### 5. CLI flag

Repeatable flag, same syntax as `--author`. `--exclude-author ''` → exit 2 with non-empty-pattern message. Missing value → exit 2.

## Not in scope

- Negation syntax inside `--author` (e.g. `--author '!Ada*'`).
- `**` or slash-aware glob semantics.
- Interactive author selection.
- Changes to `src/glob.ts`.

## Y-statement decisions

**Implementation location:** In the context of adding exclude-author logic, facing new file vs `src/author-filter.ts`, we chose `src/author-filter.ts` to achieve a single cohesive author-filtering module, accepting the tradeoff of a slightly larger file.

**Glob matcher:** In the context of pattern matching, facing reusing `src/glob.ts` vs inline glob, we chose inline (split on `*`, case-insensitive regex) to achieve correct author-string semantics, accepting that `src/glob.ts`'s path-aware logic is wrong for name/email strings.

**Precedence:** In the context of `--author` + `--exclude-author` composition, facing ambiguity in application order, we chose include-first (author narrows, then exclude removes) to achieve predictable intersection semantics, accepting that the reverse order would be harder to reason about.
