---
initiative_id: INIT-2026-05-25-claude-trail-verdict-summary
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T20:30:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Verdict info in summary section
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-verdict-summary
---

# INIT-2026-05-25-claude-trail-verdict-summary — verdict in summary

> Cycle 10 of claude-harness. Builds on cycles 1, 2A, 2B, 3, 4, 5, 7.

## What this ships

Extend the existing `## Summary` section with explicit `Verdict:`
and `Outcome:` lines so the operator can see at a glance how the
cycle ended. Pulls from the cycle.end event's metadata. Both lines
gracefully default to `(unknown)` if not present in events.

## Constraints

- Post-cycle-1..5+7 worktree (81 tests pass baseline).
- Gate points at NEW test file.
- node:test, no new deps.
- Update fixture's events.jsonl with verdict/outcome on cycle.end +
  update golden's summary to show them.
- Existing 81 tests must keep passing.

## Acceptance

`## Summary` includes two new lines:
```
Verdict: <verdict>
Outcome: <outcome>
```
CLI stdout matches updated golden byte-for-byte.

## Decomposition hint — ONE WI

ONE WI:
1. Extend `extractCycleMeta` in `src/events.ts` to read `verdict`
   and `outcome` from cycle.end event metadata.
2. Update `renderSummarySection` in `src/trail.ts` to accept + emit
   the two new lines.
3. Wire from `cli.ts`.
4. Update fixture events.jsonl: cycle.end event gets `verdict:
   "approve"` + `outcome: "merged"` in metadata.
5. Update golden summary section to include the new lines.
6. NEW `tests/verdict-summary.test.ts`:
   - Unit: `extractCycleMeta` returns verdict + outcome when present.
   - Unit: defaults `(unknown)` when fields absent.
   - Integration: spawn CLI; assert stdout matches updated golden.

Gate: `node --test --experimental-strip-types tests/verdict-summary.test.ts`.
