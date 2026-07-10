---
title: betterado_workitemquery_folder acceptance test passes live but CaptureLiveEvidence not called
description: TestAccWorkItemQueryFolder_UnderArea passed live during the workitemtracking migration cycle but CaptureLiveEvidence('acceptance-resource-workitemquery-folder', ...) was never called in the WI-4 test — no live-evidence file produced.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking`.

The dev-loop WI-4 (`betterado_workitemquery_folder` framework migration) ran `TestAccWorkItemQueryFolder_UnderArea` successfully against live ADO. However, the test did not call `CaptureLiveEvidence("acceptance-resource-workitemquery-folder", ...)`. No `.forge/live-evidence/acceptance-resource-workitemquery-folder.json` was produced.

The unifier noted this as AC11 `partial` — the test passed but no evidence file exists. All other 17 ACs in the initiative were `met` with evidence files.

## Why this happens

`CaptureLiveEvidence` must be added explicitly in each acceptance test. If the WI spec says "migrate to framework + run TestAcc*" but does not explicitly state "call CaptureLiveEvidence", the ralph agent may omit it. The workitem framework migration WI template should include `CaptureLiveEvidence` as a mandatory AC item for every resource/data-source WI.

## Profile checklist update

Add to the `Framework migration checklist` in `brain/projects/terraform-provider-betterado/profile.md`:
> AC enforcement: every acceptance test file MUST call `CaptureLiveEvidence("<resource-name>", ...)` — verify with `grep -r 'CaptureLiveEvidence' <file>` before marking WI complete.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking/events.jsonl` (UWI-1 iteration 1 summary: "Known partial (AC11): CaptureLiveEvidence('acceptance-resource-workitemquery-folder', ...) was not called")
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking.md`
