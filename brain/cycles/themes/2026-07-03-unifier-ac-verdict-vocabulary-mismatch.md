---
title: Unifier AC verdict vocabulary mismatch — prose "not-met" leaks into machine field
description: When a judge-installed gate writes "not-met" (prose) into an AC verdict field that expects the enum met|partial|missed, the self-containment gate red-loops on every retry until the vocabulary mismatch is caught.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity` (terraform-provider-betterado, graph+identity migration).

The rework unifier installed a gate that evaluated ACs and wrote verdicts. The judge wrote `"not-met"` (natural prose negation of "met") into the `acEvaluations[*].verdict` field. The demo schema expects one of `met | partial | missed`. The self-containment gate sub-check validated the field and rejected it — but the error message did not surface the vocabulary constraint clearly.

Result: 6 consecutive `unifier.gate.pr-not-self-contained` retries before the vocabulary mismatch was identified and corrected. Operator: "verdict AC vocabulary — judge prose leaked into machine fields."

## Why this matters

The gate's rejection message was structural ("demo.json schema invalid") not semantic ("verdict value 'not-met' not in allowed enum"), so the unifier's retry reasoning focused on schema repair rather than vocabulary correction. 6 iterations burned on a 1-line fix.

## The structural gap

1. The judge prompt did not state the allowed verdict enum.
2. The schema error surfaced by the gate did not name the invalid value or the allowed alternatives.
3. The `met|partial|missed` enum is not in the unifier SKILL.md where judge-gate instructions live.

## Fix direction

- Unifier SKILL.md must document the AC verdict enum (`met | partial | missed`) wherever it defines judge-gate output format.
- The self-containment gate rejection message for invalid verdict values must include: `value='X', allowed=['met','partial','missed']`.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` (`unifier.gate.pr-not-self-contained` events ×6)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
