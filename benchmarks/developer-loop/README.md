# Benchmarks — Developer Loop

> Runs the Ralph loop against each fixture and scores iterations / cost / gate-pass / completion.

## Cases

`work-items/<n>/`:
- `spec.md` — the work item spec.
- `seed/` — initial worktree state (files to copy in before running).
- `tests/` — the quality-gate tests the loop must make pass.
- `expected.json` — expected metrics:

```json
{
  "max_iterations": 5,
  "max_cost_usd": 0.50,
  "must_complete": true
}
```

## Scoring

- Completion status (`complete` | `failed` | `wedged`).
- Iterations actually used vs `max_iterations`.
- Cost actually used vs `max_cost_usd`.
- Quality-gate pass/fail at end.
- For comparing loop runtimes (Ralph vs future adapters), the same fixtures run against each runtime and produce side-by-side results.

## Status

⏳ Wired but empty. Cases land alongside developer-loop implementation. 5-10 reference fixtures planned in the phase doc.
