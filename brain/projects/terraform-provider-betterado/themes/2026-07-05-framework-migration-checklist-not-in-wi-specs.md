---
title: Framework-migration checklist not embedded in WI specs causes repeated live-gate failures
description: >-
  All 15 ralph sessions in the workitemtrackingprocess migration had brainReads=0.
  Profile.md clauses 1-2 (deregister+delete SDKv2; Configure wires real client)
  were absent from WI-3 through WI-5 specs, causing SDKv2-deregister and
  nil-AggregatedClient failures across 5 WIs before the pattern self-corrected.
category: antipattern
created_at: 2026-07-05T00:00:00.000Z
updated_at: 2026-07-05T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess` (workitemtrackingprocess package, 13 resources).

All 15 ralph sessions: `brainReads=0`. The PM embedded some framework-migration knowledge in the WI specs but did not include the full checklist for downstream WIs (WI-3 onward only listed the resources being migrated, not the deregister+delete requirement or the Configure-stub danger).

**Failures caused by omission:**

| Failure class | WIs affected | Gate failures |
|---|---|---|
| `Invalid resource type` (SDKv2 deregister omitted) | WI-2 (iter 1), WI-3 (iter 0) | 2 |
| `nil *client.AggregatedClient` in `checkDestroyed`/`captureEvidence` (Configure stub left) | WI-3, WI-4, WI-5 | 3+ |

Both classes are in `profile.md` framework-migration checklist (clauses 1 and 2). Both were documented in `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas` from the prior cycle.

## Third consecutive cycle with the same failure

- `2026-06-20-ralph-zero-brain-reads-on-documented-gotchas` (first documentation)
- `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas` (second cycle, same failures)
- This cycle: third recurrence

The PM reads the brain (9+5 reads); the dev-loop does not (by design). The fix must be the PM embedding the checklist clauses verbatim into EVERY framework-migration WI's acceptance criteria — not just the first WI.

## Required fix

For any WI that migrates a resource/data-source to the framework, the PM MUST embed:
1. Profile.md clause 1 (deregister from SDKv2 provider.go AND delete SDKv2 files in the same WI).
2. Profile.md clause 2 (Configure wires `*client.AggregatedClient`, not a stub).
3. Profile.md clause 3b (dedup = deregister AND delete; `go vet -tags all ./azuredevops/...` must compile).

These are ~10 lines and fit in a WI spec without context inflation.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl` (gate.fail at 11:40, 11:48 WI-2; 11:48 WI-3; 14:33 WI-4; 14:48 WI-5)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess.md`
- `brain/cycles/themes/2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md`
