# Forge — Antipatterns

> Category index. Lists theme pages describing **proven approaches that don't work** — failure modes, traps, lessons from prior cycles.

`brain-lint` ensures every theme page with `category: antipattern` appears here exactly once.

## Theme pages

### Git / merge

- [`squash-merge-stacked-prs`](./themes/squash-merge-stacked-prs.md) — Squash-merging stacked PRs orphans children. v1 Cycle 2 trafficGame: 90 test failures + 12 TS errors after 8 squashed PRs.

### Loop / orchestration waste

- [`rate-limit-no-backoff`](./themes/rate-limit-no-backoff.md) — Immediate retry after rate-limit produces 215+ zero-cost spawns; 49% of v1 Cycle 3 failures.
- [`agent-stuck-no-detection`](./themes/agent-stuck-no-detection.md) — Silent build/test loops; 12 timeouts/day at $8-12 waste in v1.
- [`review-fix-loop-spinning`](./themes/review-fix-loop-spinning.md) — Missing SHA-guard caused 70+ review-fix cycles overnight in v1 Cycle 1; $200 waste.

### Memory & learning

- [`episodic-not-cumulative-learnings`](./themes/episodic-not-cumulative-learnings.md) — 5 identical learnings/day from truncated cross-cycle context; the brain is the architectural fix.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
