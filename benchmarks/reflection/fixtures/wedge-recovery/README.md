# Fixture: wedge-recovery

A hand-fabricated cycle for the trafficGame project where the developer
loop wedged on its only WI (3 iterations, `stop_reason: wedged`) before an
orchestrator-triggered fresh-context retry resolved it in 1 iteration.

## Why this fixture

Stresses these rubric paths:

- **Wedge signal**: events.jsonl includes a `ralph.end` with
  `stop_reason: wedged` AND a downstream `ralph.end` with `status: complete`
  on a recovery attempt. The reflector should capture both the antipattern
  and the recovery pattern.
- **`theme_categories_balanced`**: the wedge stop_reason satisfies the
  antipattern requirement.
- **Cost-overhead lesson**: user feedback quantifies the wedge cost
  ($1.38 wasted) — the reflector should integrate this into a theme.

## Inputs

- `manifest.md` — closed manifest for the trafficGame distributeFlow
  initiative.
- `events.jsonl` — hand-fabricated 16-line trace with two `ralph.iteration`
  entries (each with `tests_failing > 0`), a wedged `ralph.end`, a
  `ralph.recovery-attempt` log, then a successful `ralph.end`.
- `brain-gaps.jsonl` — empty.
- `merged-tree/` — TS project snapshot.
- `user-feedback.md` — explains the oscillation root cause + recovery cost.

## Expected output

- ≥ 2 themes under `brain/projects/trafficGame/themes/`.
- ≥ 1 theme with `category: antipattern` (the wedge).
- ≥ 1 theme with `category: pattern` (fresh-context recovery).
