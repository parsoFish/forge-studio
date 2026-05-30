---
initiative_id: INIT-2026-05-26-claude-trail-verify-cascade-v3
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-26T03:00:00.000Z'
iteration_budget: 8
cost_budget_usd: 6.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Stats parser — extract counts per phase
    depends_on: []
  - feature_id: FEAT-2
    title: Stats sinks (text + JSON output, kept distinct)
    depends_on: [FEAT-1]
  - feature_id: FEAT-3
    title: Stats CLI wiring plus golden tests and edge cases
    depends_on: [FEAT-2]
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-26-claude-trail-verify-cascade-v3
---

# INIT-2026-05-26-claude-trail-verify-cascade-v3 — verification cycle v3

> **Verification cycle — explicitly throwaway work.** v3 of the
> cascade verification, run after Tier 2 (wedged-detection removed)
> and Tier 3 (CLAUDE.md trim + DOM-as-metrics rewrite). Purpose: prove
> that the prior changes ship cleanly through a real cycle.
>
> Specifically this cycle exercises:
>   1. **No wedged false-fires** — Tier 2 dropped `wedgedNoProgressIterations`;
>      iteration budget is now the only no-progress backstop. A clean cycle
>      should never surface the term "wedged" in events.
>   2. **CLAUDE.md trim** — PM should still produce a healthy multi-WI
>      decomposition (1 / 2 / 3 WIs) per the seed without needing the
>      dropped "Consult the brain before starting work" bullet.
>   3. **Cascading UI + status colours** — same as v2; should look the
>      same in the captured frames.

## What this ships

A new `claude-trail stats <cycle-dir>` subcommand that emits per-
phase event counts in two formats (text + JSON):

```
$ claude-trail stats _logs/2026-05-25T...
phase:           events
architect          12
project-manager     8
developer-loop     47
review-loop         9
closure             5
reflection         12
total              93

$ claude-trail stats --json _logs/2026-05-25T...
{"architect":12,"project-manager":8,"developer-loop":47,"review-loop":9,"closure":5,"reflection":12,"total":93}
```

Strictly read-only; no I/O outside the supplied cycle dir.

## Constraints

- TypeScript + `node --test --experimental-strip-types`. No new deps.
- Each WI declares its own sharp `quality_gate_cmd` pointing at a NEW
  test file.
- Existing tests must keep passing.

## Acceptance

- `claude-trail stats <fixture>` produces the text format above.
- `claude-trail stats --json <fixture>` produces a JSON object matching
  the per-phase counts.
- All new tests under `tests/stats-*.test.ts` pass.
- Existing tests still pass.

## Decomposition hint (PM)

Same shape as v2 — three features with deliberately different WI
counts so the cascade canvas tier varies:

- **FEAT-1** is a thin parser — one WI for the events.jsonl → counts.
- **FEAT-2** has two distinct sinks (text formatter + JSON formatter).
  Keep them separate WIs — they have different acceptance criteria.
- **FEAT-3** spans three concerns: the stats CLI wiring (with the
  `--json` flag), the golden test, and an edge-case test for empty
  or malformed cycle dirs. Three WIs.

Use brain-query against `brain/projects/claude-harness/themes/` for
sizing references from past successful cycles.
