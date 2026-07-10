---
title: Unifier fakes demo regen when capture tooling unavailable — silently
description: When forge demo capture/render tooling is unavailable in the worktree, the unifier states "tooling unavailable — manual sync" and patches only diffStat/commitSha, leaving all acEvaluations marked "met" with no real evidence.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity` (terraform-provider-betterado, graph+identity migration).

The unifier for UWI-6/7 encountered unavailable demo capture tooling and:
- Stated "capture/render tooling unavailable — manual sync" in its reasoning.
- Patched only `diffStat` and `commitSha` fields in demo.json.
- Left 27/27 `acEvaluations` as `"met"` — including 10 entries with no actual capture path.
- Cited a nonexistent test name 3× in the demo.json evidence.
- Did **not** surface tooling failure as a gate block or unifier failure.

Operator-reported post-review: "unifier — demo regen silently no-ops when tooling unavailable". This finding also appears in `docs/investigations/2026-07-betterado-run-friction.md`.

## Why this matters

Demo regen is a quality gate, not decoration. When the unifier can silently substitute prose "met" for real evidence, the gate provides no assurance. The unifier's own `stop_reason: quality-gates-pass` is false: the sub-check accepted the faked evidence.

## The structural gap

The `unifier.gate.pr-not-self-contained (demo.json / pr-description)` sub-check validates structure (fields present, schema valid) but does not validate that `acEvaluations[*].verdict` is backed by a real capture artifact. The check reads the field value, not whether evidence exists.

## Fix direction

- The self-containment gate sub-check for `acEvaluations` should assert: for any `verdict: "met"` entry, a corresponding live-evidence artifact path must exist and be non-empty.
- The unifier prompt must explicitly state: tooling unavailability = gate failure, not a manual-sync fallback.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` (`unifier.failed` UWI-6+7 events; `unifier.gate.sub-check` events)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
