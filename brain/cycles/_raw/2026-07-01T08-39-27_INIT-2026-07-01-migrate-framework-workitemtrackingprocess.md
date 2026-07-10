---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-workitemtrackingprocess
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess
initiative_id: INIT-2026-07-01-migrate-framework-workitemtrackingprocess
project: terraform-provider-betterado
ingested_at: 2026-07-05T03:30:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by: []
---

## Summary

Migration of the entire `workitemtrackingprocess` package (13 resources + 4 data sources) from Terraform Plugin SDKv2 to terraform-plugin-framework. Largest single-package migration in the betterado arc.

**Delivered:** PR #64 — 188 files changed, +14034 −8123 lines, 58 commits. All 9 WIs: complete. Gap matrix produced at `docs/workitemtrackingprocess-gap-matrix.md`.

**Cost:** ~$70.10 total (PM $2.94, dev-loop $52.30). Duration 2026-07-01 through 2026-07-05 (4 days wall-clock; 3+ full orchestrator restart cycles due to cost-ceiling stop + unifier crash).

**Key failure modes:**
1. PM hit `error_max_turns` on first run (emitted 2 WIs, not 9). Operator added decomposition-completeness annotation; second PM succeeded.
2. SDKv2 deregister omission: WI-2 iter 1 + WI-3 iter 0 both hit `Invalid resource type` gate failure. Same error documented in profile.md clause 1; brainReads=0 in all 15 ralph sessions.
3. `nil *client.AggregatedClient` panic in `checkDestroyed` / `captureEvidence`: hit WI-3, WI-4, WI-5 (profile.md clause 2 not embedded in WI specs).
4. Unifier crash (exit 1, 0 tool calls) on first invocation. Two auto-retries also crashed. Second invocation (UWI-1 second attempt) succeeded via manual demo authoring after `forge demo render` exited 1.
5. Cost-ceiling stop at $110.79 / $100 ceiling mid-WI-9 run. Resume on 2026-07-04 completed cleanly.

**Notable project-specific pattern:** ADO `POST /processes` ignores `isEnabled=false` — process always returns enabled. Framework resource required `Computed: true` + post-create conditional update to pass the `CreateDisabled` acceptance test.

## Event log

See `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl` (25710 events).
