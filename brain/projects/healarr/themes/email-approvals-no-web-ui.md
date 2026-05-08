---
title: healarr — email approvals; no web UI
description: Correct-tier actions are gated by email approval — reply "approve" / "yes" or "reject" / "no" as the first line. Zero web infrastructure. Works from any phone.
category: pattern
keywords: [healarr, email, approval, no-web-ui, imap, smtp, mobile-friendly, lightweight]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# healarr — email approvals; no web UI

The default approval mechanism for Correct-tier actions is **email reply**:

- Agent drafts a proposal.
- healarr emails it via SMTP.
- The user replies. The first line of the reply is `approve` / `yes` (case-insensitive) → execute; `reject` / `no` → skip.
- IMAP polls for replies; the agent acts on first match.

Why this shape:

- Zero web infrastructure (no auth, no certs, no front-end).
- Works from any phone or laptop.
- The audit trail is the email thread itself — natural, persistent, searchable.
- The mailbox is the lock — no concurrent approvals possible.

For forge initiatives:

- The architect treats *"add a web dashboard for approvals"* as a major scope expansion. Surfaces it as an escalation, not auto-resolve.
- Webhook-based approvals (Slack, Discord) are the natural extension and are listed for Phase 4 — adding them is OK *as a new approval channel* alongside email, not as a replacement.

## Sources

- healarr README "What it does about it" — email-reply specification.
- `docs/architecture.md` (referenced in README) — full flow.

## Related

- [Theme: Pluggable notifications](../../../forge/themes/pluggable-notifications.md) — sister pattern (forge's own notification interface).
