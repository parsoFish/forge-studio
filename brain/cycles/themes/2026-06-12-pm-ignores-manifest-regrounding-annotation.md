---
title: PM ignores manifest re-grounding annotation → gate-too-loose cascade
description: PM decomposed WIs using already-passing test names as gates despite an operator re-grounding annotation explicitly warning that would cause gate-too-loose; 0/3 WIs completed and the entire dev-loop failed.
category: antipattern
created_at: 2026-06-12T12:47:08Z
updated_at: 2026-06-12T12:47:08Z
---

# PM ignores manifest re-grounding annotation → gate-too-loose cascade

## What happened

INIT-2026-06-08-release-acceptance-test-fixes run 1: the manifest contained an operator-written `Re-grounding (2026-06-12, operator) — READ FIRST` section explicitly stating:

> AC-1 is ALREADY SATISFIED. Do NOT create a work item whose gate is just "run _basic" — its gate passes on a clean tree and the gate-tightening check will kill the WI as gate-too-loose (this exact failure killed the 2026-06-12 run).

The PM decomposed WI-1 with gate `go test -tags all -v -count=1 -run TestAccReleaseDefinition_basic|TestAccReleaseDefinition_update|...` — exactly the already-passing tests the annotation warned against. Result:

- WI-1: `ralph.end stop_reason: gate-too-loose`, 0 iterations, 0 tool calls
- WI-2 + WI-3: `ralph.skipped reason: prerequisite-failed`
- `developer-loop: 0/3 work items completed — total failure`

Run 2 (after requeue): same PM, same manifest, annotation still present — correct decomposition, 3 new test names, 3/3 WIs completed 1 iteration each.

## Root cause

PM processed the manifest but did not treat the re-grounding annotation as a hard constraint during WI decomposition. The annotation sat in a prose `## Re-grounding` section; the PM likely weighted the formal `## Acceptance criteria` YAML blocks more heavily.

## Cost

~5 min wasted, one requeue, full re-run of PM phase.

## Mitigation

In run 2 the annotation was sufficient after requeue — the PM correctly used the re-grounding block to pick new test names. No structural fix was needed; the pattern is that the operator can retry after re-reading.

Longer-term: re-grounding annotations may need structural emphasis (e.g., a YAML `operator_notes` frontmatter key the PM is explicitly instructed to check before decomposition).

## Sources

- `_logs/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes/events.jsonl` — `EV_mqawf7a2_v79y5nzu` (failure_classification terminal), ralph.end gate-too-loose at 12:24:27
- `brain/cycles/_raw/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes.md`
