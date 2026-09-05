# gitpulse — Antipatterns

> Category index. Lists theme pages describing **proven approaches that don't — failure modes, traps, lessons paid for in prior cycles**.

`brain-lint` ensures every theme page with `category: antipattern` appears here exactly once.

## Theme pages

- [`2026-06-21-acceptance-gate-covers-only-headline-output`](./themes/2026-06-21-acceptance-gate-covers-only-headline-output.md) — >-
- [`2026-06-21-gitignored-scratch-files-double-commit`](./themes/2026-06-21-gitignored-scratch-files-double-commit.md) — >-
- [`2026-06-21-gitignored-scratch-files-recurrence`](./themes/2026-06-21-gitignored-scratch-files-recurrence.md) — >-
- [`2026-06-22-demo-visual-verification-prose-fallback`](./themes/2026-06-22-demo-visual-verification-prose-fallback.md) — >-
- [`2026-06-22-gitignored-scratch-file-third-cycle`](./themes/2026-06-22-gitignored-scratch-file-third-cycle.md) — >-
- [`2026-06-22-incremental-edit-vs-single-write`](./themes/2026-06-22-incremental-edit-vs-single-write.md) — >-
- [`2026-06-22-model-rendering-wi-split-overgranular`](./themes/2026-06-22-model-rendering-wi-split-overgranular.md) — >-
- [`2026-07-11-gitignored-scratch-fourth-cycle`](./themes/2026-07-11-gitignored-scratch-fourth-cycle.md) — ralph writes fix_plan.md and AGENT.md after every WI commit in the tags-command cycle — the 4th gitpulse cycle in a row with this pattern; SKILL.md and AGENT.md still not updated.
- [`2026-07-12-gitignored-scratch-fifth-cycle`](./themes/2026-07-12-gitignored-scratch-fifth-cycle.md) — >-
- [`2026-08-28-gitignored-scratch-sixth-cycle`](./themes/2026-08-28-gitignored-scratch-sixth-cycle.md) — ralph writes fix_plan.md and AGENT.md after WI-1 and WI-2 in the no-merges-flag cycle — 6th consecutive gitpulse cycle; AGENT.md worktree template still not updated.
- [`2026-08-31-gitignored-scratch-seventh-cycle`](./themes/2026-08-31-gitignored-scratch-seventh-cycle.md) — ralph.uncommitted-work-swept fired for all 3 WIs in the author-filter cycle; seventh consecutive gitpulse cycle; AGENT.md worktree template still unpatched.
- [`2026-08-31-author-filter-compare-coverage-gap`](./themes/2026-08-31-author-filter-compare-coverage-gap.md) — --author silently ignored under --compare; filterAuthorCommits() not called in the compare branch; none of the 7 acceptance assertions tested --compare --author composition; adversarial review caught it post-merge.
- [`2026-08-31-gitignored-scratch-eighth-cycle`](./themes/2026-08-31-gitignored-scratch-eighth-cycle.md) — ralph.uncommitted-work-swept ×2 (WI-1, WI-2) in the tag-range-filter cycle; eighth consecutive gitpulse cycle; projects/gitpulse/AGENT.md worktree template still unpatched.
- [`2026-08-31-tag-range-dead-code-ac4-wire`](./themes/2026-08-31-tag-range-dead-code-ac4-wire.md) — resolveEffectiveBounds exported and unit-tested in src/tag-range.ts but never imported by src/cli.ts; AC4 narrower-bound annotation is dead code; no per-WI gate detected the absent import; adversarial review caught it (RF-1 major).

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-09-05-unused-opts-param-silent-tagrange-discard`](./themes/2026-09-05-unused-opts-param-silent-tagrange-discard.md) — renderSummaryMarkdown accepted _opts?: { tagRange? } but never read it; runCli passed { tagRange } at the call site when --since-tag/--until-tag were active; silently discarded. No AC required the combined flag path; no unit test exercised non-null tagRange. The _opts underscore prefix made the gap invisible to compiler and linter.

- [`2026-09-05-gitignored-scratch-tenth-cycle`](./themes/2026-09-05-gitignored-scratch-tenth-cycle.md) — ralph.uncommitted-work-swept fired for all 3 WIs in the --markdown cycle (fix_plan.md, AGENT.md untracked). Tenth consecutive gitpulse cycle. projects/gitpulse/AGENT.md does not exist. The autocommit safety net is the only guard; ten data points with zero delivery impact.

- [`2026-09-04-gitignored-scratch-ninth-cycle`](./themes/2026-09-04-gitignored-scratch-ninth-cycle.md) — ralph.uncommitted-work-swept fired for all 3 WIs in the include-path-filter cycle (fix_plan.md, AGENT.md untracked). Ninth consecutive gitpulse cycle with this recurrence. projects/gitpulse has no AGENT.md worktree template; the forge autocommit safety net is the only guard.
