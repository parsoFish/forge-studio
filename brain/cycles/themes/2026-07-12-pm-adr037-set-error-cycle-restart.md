---
title: PM ADR-037 set-error triggers full cycle restart instead of in-place WI fix
description: >-
  When PM emits a WI without `creates` or `verification_artifact` (ADR 037),
  the orchestrator classifies it terminal/non-recoverable and restarts the
  full cycle — costing a wasted PM run instead of an in-place correction.
category: antipattern
keywords:
  - pm
  - adr-037
  - set-error
  - cycle-restart
  - creates
  - verification_artifact
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

# PM ADR-037 set-error causes full cycle restart

## Observed

INIT-2026-07-11-cli-sort-flag: PM emitted 3 WIs (WI-1, WI-2, WI-3). WI-3 is a pure modification WI (no new file created) — it correctly needed `verification_artifact` as the escape hatch for ADR 037's `creates` requirement. PM did not set it.

Orchestrator emitted:
```
pm.work-item-emitted (WI-3)
pm.spec-lint (0 flagged)
pm.graph-emitted
ERROR: WI-3: creates is required (ADR 037) unless verification_artifact is set
cycle.start (restart)
```

The cycle restarted from `cycle.start` — PM re-ran, reread the manifest, and correctly emitted 3 WIs on the second attempt. First attempt cost $0.55 and 2 min — fully wasted.

## Root cause

The `pm.spec-lint` check (which ran and flagged 0 issues) does not enforce ADR 037. The ADR 037 constraint is a downstream set-error fired by the work-item validator after the PM exits — making it impossible for the PM to self-correct before the cycle fails.

## Impact

A full cycle restart means:
1. PM re-reads the manifest and codebase from scratch.
2. If the second PM run also omits `creates`/`verification_artifact`, the cycle restarts again.
3. Operator has no visibility into why the restart happened without reading the events.jsonl.

## Fix directions

1. **Move ADR 037 check into `pm.spec-lint`** — fire the same constraint during PM's own lint pass so it can self-correct before exiting.
2. **Recoverable set-error** — classify `creates`-missing as a recoverable failure, auto-patch the WI file (set `verification_artifact: "test/acceptance/run.ts"` or similar), and continue without a cycle restart.
3. **PM SKILL.md** — add an explicit rule: "Pure-modification WIs (no new file) MUST set `verification_artifact`; omitting `creates` without it fires a set-error."

## Sources

- `_logs/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag.md`
