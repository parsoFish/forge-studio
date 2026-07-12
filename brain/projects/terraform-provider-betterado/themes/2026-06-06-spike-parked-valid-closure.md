---
title: Spike-parked-with-reason is a valid clean closure for this provider's roadmap
description: Pre-authorizing STOP as a spike outcome in the manifest lets the operator close an initiative cleanly when build scope proves heavier than assumed, without wasted iterations on a half-built resource.
category: pattern
keywords: [spike, park, stop-condition, manifest, clean-closure, pm-decomposition, environment-templates]
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Pattern

The environment-templates initiative manifest explicitly declared:

> "Spike-parked-with-reason is a valid done state for INIT-5."
> "If neither is viable, STOP — record the finding and park the resource; do NOT vendor-patch."

When the spike confirmed the API was reachable but the build scope (full `ReleaseDefinitionEnvironment` blueprint) proved too heavy for the current provider maturity, the operator applied this exit cleanly:

1. Spike verdict written to brain (`2026-06-06-environment-templates-spike-findings.md`).
2. Manifest annotated with `## OUTCOME: PARKED` + reason + forward pointer.
3. PR #12 left open but not merged; worktree released.
4. Build folded into a future initiative.

Zero wasted dev-loop iterations on a half-built resource.

## Why it works

The **pre-authorized exit condition** in the manifest means the operator's "STOP" is not a failure — it was a first-class outcome anticipated at design time. The manifest's spike-gate predicate (`if neither is viable`) was satisfied (API is viable but build scope is not), which is sufficient to close.

Contrast with a spike that has no explicit exit condition: the agent may push forward into partial implementation, spending budget on code that will be reverted.

## Signal for PM decomposition

Any initiative with a genuine unknown (API support, token format, schema feasibility) should declare its STOP condition explicitly in the manifest acceptance criteria:

```markdown
If [condition] is false, STOP and park the resource with the finding — do NOT [costly work].
Spike-parked-with-reason is a valid done state.
```

This is now a confirmed pattern in the betterado roadmap. INIT-4's token-format spike used the same structure (separate spike WI with explicit fail path).

## Sources

- `_logs/2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike.md`
- `_queue/done/INIT-2026-06-05-environment-templates-spike.md` (OUTCOME: PARKED section)
