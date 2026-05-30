---
initiative_id: INIT-2026-05-26-claude-trail-verify-cascade-v2
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-26T00:00:00.000Z'
iteration_budget: 8
cost_budget_usd: 6.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Filter parser — `--filter phase:<p>` / `--filter status:<s>`
    depends_on: []
  - feature_id: FEAT-2
    title: Filter matchers (phase + status, kept distinct)
    depends_on: [FEAT-1]
  - feature_id: FEAT-3
    title: Filtered renderers + CLI wiring + golden tests
    depends_on: [FEAT-2]
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-26-claude-trail-verify-cascade-v2
---

# INIT-2026-05-26-claude-trail-verify-cascade-v2 — verification cycle v2

> **Verification cycle — explicitly throwaway work.** v2 of the earlier
> verify-cascade cycle. Authored to exercise:
>
>   1. The **per-WI / per-feature status colour** changes (blue active,
>      green complete, yellow retrying, red only on full cycle failure).
>      Sibling WIs/features stay in their own colour regardless of
>      what others do.
>   2. **Variation in feature size** — the seed deliberately calls out
>      that the three features warrant different WI counts (FEAT-1 is
>      a single parser, FEAT-2 has two distinct matchers, FEAT-3 has
>      three independent renderers / CLI wiring / tests).
>   3. Same cascading hex tree, event-driven materialisation,
>      repositioned badges as the v1 cycle.

## What this ships

A new `claude-trail --filter <key>:<value> <cycle-dir>` mode that
filters which cycles' info is rendered:

```
$ claude-trail --filter phase:reflection --filter status:done <cycles-dir>
INIT-2026-05-25-...: 47 events, 6 phases, dominant=reflection (12 events) [status=done]
INIT-2026-05-25-...: 33 events, 5 phases, dominant=reflection (9 events)  [status=done]
```

(Operates on a directory containing cycle subdirs; each one is parsed
+ filtered.)

## Constraints

- TypeScript + `node --test --experimental-strip-types`, no new deps.
- Each WI declares its own sharp `quality_gate_cmd` pointing at a NEW
  test file (no extending existing tests).
- 184 existing tests must keep passing.

## Acceptance

- Each filter key (`phase`, `status`) is honoured; matching cycles
  appear, non-matching are excluded.
- New tests under `tests/filter-*.test.ts` pass for parser,
  per-matcher, and end-to-end golden CLI invocation.
- Existing tests still pass.

## Decomposition hint (PM)

The three features intentionally warrant **different WI counts** so
the PM-emitted hex tree has visible variation across feature columns
(operator note 2026-05-25: encourage varied feature sizes to test the
canvas's layout flexibility):

- **FEAT-1** is a small parser — naturally one WI for argv parsing.
- **FEAT-2** carries two **distinct matcher types** (`phase-matcher`
  + `status-matcher`). Keep them separate — they have different
  acceptance criteria and the dev-loop can iterate them
  independently. Naturally two WIs.
- **FEAT-3** spans three independent concerns: filtered output
  renderer, CLI wiring (`--filter` flag plumbed end-to-end), and the
  golden test harness. Naturally three WIs.

Use the brain (`brain/projects/claude-harness/themes/`) for sizing
references from past claude-harness cycles where you find them
relevant.
