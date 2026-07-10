---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-feed
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed
initiative_id: INIT-2026-07-01-migrate-framework-feed
project: terraform-provider-betterado
ingested_at: 2026-07-03T12:00:00Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/projects/terraform-provider-betterado/themes/2026-07-01-pr50-committed-scratch-and-broken-squash-merge.md
---

# Cycle Archive — INIT-2026-07-01-migrate-framework-feed

## Summary

Migrated all 4 feed resources/data-sources (`betterado_feed`, `betterado_feed_permission`, `betterado_feed_retention_policy`, `data.betterado_feed`) from SDKv2 to terraform-plugin-framework. PR #50, merged 2026-07-03.

**Outcome:** 762 files changed, 55263 insertions, 446 deletions, 38 commits. All 6 WIs complete. Live acceptance gates passed for all types.

## Key metrics

- WIs: 6 declared, 6 complete, 0 failed
- Dev-loop runs: 2 (first aborted by unifier branch-divergence)
- PM runs: 3 (first 2 exhausted max_turns with 0 WIs)
- Unifier runs: 2 (first exhausted 15-iteration budget on branch-divergence, $12.7 wasted)
- Total cost: ~$60 estimated across all sessions
- brainReads: 0 across all 12 ralph sessions (12 WI executions across 2 dev-loop runs)

## ADO-specific bugs re-derived (all in profile.md, none read by ralph)

1. **1000-project cap (WI-2 iter 1):** test used `resource betterado_project` → TF_ACC limit → PATCH failure. Fix: use `SharedFixtureProjectName`.
2. **Feed soft-delete (WI-2 iter 2):** `DeleteFeed` is a soft-delete; `GetFeed` returns deleted feed with `DeletedDate != nil`. `CheckDestroy` must assert `DeletedDate != nil` OR 404.
3. **Null-vs-empty-string for org-scoped feeds (WI-2 iter 3):** framework treats absent optional string as `StringNull()`, not `StringValue("")`. SDKv2 used `d.Set("project_id", "")` which normalised to empty string both ways. Framework resource must preserve null.

## SDKv2 dead file non-deletion

Dead files (`resource_feed.go`, `resource_feed_permission.go`, `resource_feed_retention_policy.go`, `data_feed.go` and tests) not deleted. Checklist item 3b in profile.md unread/unenforced for 7th time.

## Event log reference

Full log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl`
Retro: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/retro.md`
