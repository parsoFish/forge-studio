---
title: Resume PM re-decomposes correctly — collapsing over-granular WIs without losing scope
description: When Run 1 produced a 5-WI over-granular linear chain that crashed, the resume PM run re-decomposed to 2 WIs covering identical scope. Both WIs passed at iteration 1. PM correctly identified AC consolidation without operator hand-holding.
category: pattern
keywords: [resume-pm, redecompose, over-granular-wi, scope-consolidation, linear-chain, ac-consolidation]
related_themes: [pm-decomposition-index]
created_at: 2026-06-11T13:42:00Z
updated_at: 2026-06-11T13:42:00Z
---

# Resume PM re-decomposes correctly — collapsing over-granular WIs without losing scope

## Observation

In `INIT-2026-06-08-release-definition-environment-config-surface`, Run 1's PM decomposed to 5 WIs (WI-1 → WI-2 → WI-3 → WI-4 → WI-5), one per schema field + a live acceptance WI. WI-1 crashed → 0/5 total failure.

On resume (Run 2, 2026-06-11), the PM re-ran with the same initiative manifest and re-decomposed to 2 WIs:
- **WI-1**: all 4 schema fields (`environment_trigger`, `schedule`, `process_parameters`, `properties`) — expand/flatten + 4 unit tests.
- **WI-2**: live acceptance test `TestAccReleaseDefinition_environmentConfig`.

WI-1 passed at iteration 1 (gate: `TestReleaseDefinition_Environment.*RoundTrip`). WI-2 passed at iteration 1 (with one crash-retry; gate passed at iteration=0 on retry, 22.163s live ADO run).

## Why this works

The initiative manifest is the PM's input, not the prior WI decomposition. On resume, the PM starts fresh from the manifest and applies its current decomposition heuristics — it isn't constrained to replicate Run 1's structure. For this initiative, the manifest's 4 ACs mapped cleanly to a 2-WI split, which the PM chose independently.

## Implication

When a crash-cascade causes total failure, the correct operator action is `forge requeue --resume-from=project-manager` (or full requeue). The PM re-decomposes correctly without operator intervention specifying WI count. Do NOT manually rewrite WI files before requeue — let the PM re-derive.

## Sources

- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/events.jsonl` — `pm.work-item-emitted WI-1/WI-2` (2026-06-11T13:04:53); `ralph.end WI-1 complete` (13:11:35); `ralph.end WI-2 complete` (13:34:28); `dev-loop.delivered 7 files +1427 insertions` (13:41:49)
- `brain/cycles/_raw/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface.md`
