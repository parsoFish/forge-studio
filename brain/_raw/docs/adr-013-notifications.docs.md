---
source_type: docs
source_url: docs/decisions/013-notifications.md
source_title: ADR 013 — Notifications on review-ready
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 013 — Notifications on review-ready

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The system runs unattended. The human's input is needed only at three moments (architect, review, reflection). Of those three, **review-ready is the one the system has to surface** — the human cannot poll, and an initiative sitting in `_queue/ready-for-review/` for a week is wasted progress.

## Decision

`orchestrator/notify.ts` exposes a pluggable notification interface. Two providers ship:

1. **`desktop`** (default, on) — `notify-send` (Linux), `osascript` (macOS), or PowerShell `BurntToast` (Windows) via Bash. No extra deps.
2. **`webhook`** (optional, off by default) — POSTs JSON to `notify.webhook_url`. Drop-in for Slack, Discord, Mattermost, custom endpoints.

Notifications fire on:

- Initiative moved to `_queue/ready-for-review/` (primary trigger).
- Initiative moved to `_queue/failed/` (needs human triage).
- Scheduler crashed and recovered with N orphaned items.

Interface is one function — `notify(event: NotifyEvent): Promise<void>` — adding a new provider is a single file in `orchestrator/notify.<provider>.ts`.

## Consequences

- The user knows immediately when their attention is needed.
- Local-first (desktop) by default; cloud (webhook) opt-in.
- Adding providers is trivial.
- Trade-off: desktop notification on a remote/headless machine is silent. Document `webhook` as recommended for headless. No retry on webhook failure (yet).

## Alternatives considered

- No notifications, just `forge status` — fails the "human knows when to look" requirement.
- A first-party Slack integration — premature; webhooks cover Slack and everything else.
- Email — not in default scaffold; can be added as a provider when needed.

## References

- https://man.archlinux.org/man/notify-send.1
- v1's reflect-stage (no notification surface; v2 closes that loop)
