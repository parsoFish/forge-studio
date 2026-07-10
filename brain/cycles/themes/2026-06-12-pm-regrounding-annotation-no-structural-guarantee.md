---
title: PM has no structural guarantee to read re-grounding annotations
description: Operator re-grounding annotations in manifests are read by the PM probabilistically, not by structural obligation — requeue is de facto recovery, burning a full wasted run each time; needs a hardened PM prompt obligation or a structured field.
category: antipattern
created_at: 2026-06-12T00:00:00Z
updated_at: 2026-06-12T00:00:00Z
---

# PM has no structural guarantee to read re-grounding annotations

## What happened

INIT-2026-06-08-release-acceptance-test-fixes carried an operator-written `## Re-grounding (2026-06-12) — READ FIRST` block in the manifest. Run 1's PM ignored it and decomposed WIs with already-passing gates → `gate-too-loose` on WI-1 → WI-2 + WI-3 skipped (prerequisite-failed) → `0/3 total failure`. Requeue (run 2) succeeded because the fresh-context PM read the annotation and decomposed correctly.

## Root cause

No structural PM prompt obligation exists to read or acknowledge operator annotations. The annotation is plain prose in the manifest markdown; the PM may weight YAML AC fields more heavily. Fresh-context requeue increases (but does not guarantee) read compliance.

## Operator-confirmed (2026-06-12 feedback)

> "No structural guarantee currently exists that the PM reads a re-grounding annotation before decomposition; requeue works but burns a full run every time. A structured `operator_notes` field (or explicit PM prompt obligation) would prevent recurrence."

## Cost

One full pipeline run wasted (~5 min, 0/3 WIs, follow-on WI skips, requeue overhead).

## Fix direction

Two candidates:
1. **Structured YAML field** — add `operator_notes:` or `regrounding:` to the manifest YAML; the PM SKILL.md mandates it be read before WI decomposition.
2. **Explicit PM prompt obligation** — PM SKILL.md includes: "If the manifest contains a `Re-grounding` or `READ FIRST` section, you MUST reproduce it in a `## Pre-decomposition context check` before emitting any WI."

Either converts probabilistic-read into structural obligation.

## Contrast

The `2026-06-12-manifest-regrounding-annotation-as-operator-override` pattern page documents that annotation *works* when read. This page documents the structural gap that prevents guaranteed reading.

## Sources

- `_logs/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes/events.jsonl` — L35: `ralph.end` run 1 WI-1 `gate-too-loose`, L42: `0/3 total failure`, L44: cycle.start run 2, L125: run 2 WI-1 gate.pass
- `_logs/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes/user-feedback.md` — Q3 answer (operator confirms hardening warranted)
- `brain/cycles/_raw/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes.md`
