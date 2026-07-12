---
title: ADO feed soft-delete — CheckDestroy must assert DeletedDate
description: DeleteFeed is a soft-delete; GetFeed returns the feed until explicitly purged, so naive CheckDestroy must assert DeletedDate != nil or a 404, not just a non-error response.
category: antipattern
keywords: [feed-soft-delete, checkdestroy, deleteddate, false-green, purge, acceptance-test]
related_themes: [fixture-discipline-index, ado-api-shapes-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

# ADO feed soft-delete — CheckDestroy must assert DeletedDate

## Problem

`betterado_feed` acceptance test `CheckDestroy` called `GetFeed` and treated a non-error response as "feed still exists". But `DeleteFeed` (ADO API) is a **soft-delete**: the resource remains queryable with `DeletedDate != nil` until an explicit purge. Test checked `GetFeed(ctx, GetFeedArgs{FeedId: ...})` — no 404, no error → `CheckDestroy` returned nil → acceptance test passed while feed was soft-deleted not gone.

Observed in WI-2 iteration 3 (live gate): idempotency check passed, destroy check allowed a soft-deleted feed through, producing a false green.

## Rule

`CheckDestroy` for `betterado_feed` MUST check one of:
1. `err != nil` (404 from ADO after hard-delete/purge), OR
2. `resp.DeletedDate != nil` — feed is soft-deleted.

Treat soft-deleted feed (`DeletedDate != nil`) as destroyed for test purposes. Pattern is already in `internal/service/feed/resource_feed_framework.go`'s `readFeed` helper after WI-2 landed.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl` — WI-2 iterations 2–3, ralph reasoning `"CheckDestroy false-negative"` in WI-2 iter 2 event
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed.md`
