# ADR 013 — Notifications on review-ready

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The system runs unattended. The human's input is needed only at three moments (architect, review, reflection). Of those three, **review-ready is the one the system has to surface** — the human cannot poll, and an initiative sitting in `_queue/ready-for-review/` for a week is wasted progress.

## Decision

`orchestrator/notify.ts` exposes a pluggable notification interface. The scaffold ships **two providers**:

1. **`desktop`** (default, on) — uses `notify-send` (Linux), `osascript` (macOS), or PowerShell `BurntToast` (Windows) via the Bash tool. No extra dependencies.
2. **`webhook`** (optional, off by default) — POSTs a JSON payload to `notify.webhook_url`. Drop-in for Slack, Discord, Mattermost, custom endpoints.

Notifications fire on:

- Initiative moved to `_queue/ready-for-review/` (primary trigger).
- Initiative moved to `_queue/failed/` (needs human triage).
- Scheduler crashed and recovered with N orphaned items (so the human knows).

The interface is one function — `notify(event: NotifyEvent): Promise<void>` — so adding a new provider (email, ntfy.sh, IM bridges) is a single file in `orchestrator/notify.<provider>.ts` plus a config entry.

## Consequences

**Positive:**
- The user knows immediately when their attention is needed.
- Local-first (desktop) by default; cloud (webhook) opt-in.
- Adding providers is trivial.

**Negative / accepted trade-offs:**
- Desktop notification on a remote/headless machine is silent. Document `webhook` as the recommended provider for headless setups.
- No retry on webhook failure (yet). Adequate for v0; can revisit.

## Alternatives considered

- **No notifications, just `forge status`** — fails the "human knows when to look" requirement.
- **A first-party Slack integration** — premature; webhooks cover Slack and everything else with one provider.
- **Email** — not in default scaffold; can be added as a provider when needed.

## References

- [`notify-send`](https://man.archlinux.org/man/notify-send.1)
- v1's reflect-stage (no notification surface; v2 closes that loop)
