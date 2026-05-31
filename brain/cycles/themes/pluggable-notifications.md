---
title: Pluggable notifications on review-ready
description: >-
  orchestrator/notify.ts with desktop (default) and webhook providers. Closes
  the unattended loop — human knows when to look.
category: pattern
keywords:
  - notifications
  - notify-send
  - webhook
  - desktop
  - slack
  - review-ready
  - unattended
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - unattended-scheduler
  - file-based-state-machine
---

# Pluggable notifications on review-ready

The system runs unattended. Human input is needed at three moments (architect, review, reflection); review-ready is the one the system has to *surface* — the human cannot poll, and an initiative sitting in `_queue/ready-for-review/` for a week is wasted progress.

`orchestrator/notify.ts` exposes a pluggable interface — `notify(event: NotifyEvent): Promise<void>`. Two providers ship:

1. **`desktop`** (default, on) — `notify-send` (Linux), `osascript` (macOS), or PowerShell `BurntToast` (Windows) via Bash. No extra deps.
2. **`webhook`** (optional, off) — POSTs JSON to `notify.webhook_url`. Drop-in for Slack, Discord, Mattermost, custom endpoints.

Triggers: initiative moved to `_queue/ready-for-review/`, initiative moved to `_queue/failed/`, scheduler crashed and recovered with N orphaned items.

Adding a new provider (email, ntfy.sh, IM bridges) is a single `notify.<provider>.ts`-style module under `orchestrator/` plus a config entry.

Trade-off: desktop notification on remote/headless machine is silent. Document `webhook` as recommended for headless. No retry on webhook failure (yet).

## Sources

- [`adr-013-notifications.docs.md`](../../_raw/docs/adr-013-notifications.docs.md) — decision record.

## See also

- [[unattended-scheduler]] — what triggers the notifications.
- [[file-based-state-machine]] — file-based state machine for queue management.
