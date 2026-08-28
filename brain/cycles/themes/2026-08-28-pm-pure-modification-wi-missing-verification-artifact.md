---
title: PM emits pure-modification WI without verification_artifact, triggering ADR-037 set-error and cycle restart
description: >-
  When a WI only modifies existing files (no new file created), ADR 037 requires
  verification_artifact instead of creates. PM spec-lint passes but the ADR 037
  set-validator fires at graph-emit time, classifying the cycle terminal/non-
  recoverable and forcing a full restart — wasting one PM run (~$0.79, ~3 min).
category: antipattern
keywords:
  - pm
  - adr-037
  - creates
  - verification_artifact
  - pure-modification
  - cycle-restart
  - set-error
  - terminal
related_themes: [2026-07-12-pm-adr037-set-error-cycle-restart]
created_at: 2026-08-28T12:30:00.000Z
updated_at: 2026-08-28T12:30:00.000Z
---

# PM pure-modification WI missing `verification_artifact` → ADR-037 set-error → cycle restart

## What happened

The PM decomposed the `--no-merges` initiative into 3 WIs. WI-1 and WI-2 created new test files (`creates: [test/no-merges.test.ts]`, `creates: [test/no-merges-cli.test.ts]`). WI-3 only modified existing files (`test/acceptance/run.ts`, `README.md`) and declared neither `creates` nor `verification_artifact`. `pm.spec-lint` passed (0 flagged). But the ADR 037 set-validator fired at `pm.graph-emitted` time:

```
project-manager phase failed: set errors: WI-3: creates is required (ADR 037) unless
verification_artifact is set — pure-modification WIs must declare verification_artifact
as the creates: escape
```

The orchestrator classified this terminal/non-recoverable, fired `failure_classification`, and restarted the cycle 11 seconds later. The second PM run succeeded.

**Cost: ~$0.79 and one full PM run wasted.**

## Why it recurs

The PM must declare `verification_artifact` for any WI that modifies files without creating one. The spec-lint does not catch this (`pm.spec-lint` reported `flagged: 0`); only the post-graph ADR-037 validator does. This is a latent PM prompt gap: the set-validator fires after the PM has already finished, forcing a full restart rather than an in-place fix.

## Pattern signature

- `pm.spec-lint` reports 0 flagged
- `pm.graph-emitted` fires
- Immediately followed by `project-manager phase failed: set errors: WI-N: creates is required (ADR 037)`
- Then `failure_classification` with `recoverable: false`
- Then `cycle.start` ~10s later (automatic restart)

## Fix directions

1. **PM prompt** — add an explicit reminder that pure-modification WIs (no new file created) MUST set `verification_artifact` equal to the quality-gate test path or output path.
2. **spec-lint extension** — detect `creates: []` (or absent) + `verification_artifact: absent` at spec-lint time and flag immediately, before the set-validator fires.

## Sources

- `_logs/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag/events.jsonl` — events: `pm.graph-emitted`, `project-manager phase failed`, `failure_classification` at `2026-08-28T11:36:20`; second `cycle.start` at `2026-08-28T11:36:31`
- `/home/parso/forge-m0-a/brain/cycles/_raw/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag.md`

## See also

- [[2026-07-12-pm-adr037-set-error-cycle-restart]] — earlier instance of this same failure mode
