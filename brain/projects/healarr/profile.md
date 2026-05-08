---
project: healarr
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
status: active
domain: self-healing agent for Plex/*arr media stacks
stack: [python, claude-api, sqlite, docker, imap-smtp]
taste_decay: 0.05
---

# healarr

A self-healing agent for Plex/*arr media stacks. Watches Plex + Radarr + Sonarr + Prowlarr + Overseerr + qBittorrent + the underlying NAS; detects when work-in-progress is silently failing; uses a Claude API agent to remediate within bounded permissions. **Not a monitoring dashboard** — the layer that does something when monitoring goes red.

Companion to (but separate from) [simplarr](../simplarr/profile.md).

## Taste signals

- **Two-stage pipeline (Triage → Agent).** Triage is a deterministic rule engine — no LLM. Agent is invoked only on the small fraction of observations that look wrong. Don't blur this boundary; it's the cost-control mechanism.
- **Tool-tier permission model** (Observe / Nudge / Correct / Escalate) is the safety mechanism. Every tool maps to exactly one tier; the tier sets the default policy.
- **Email approvals, not a web UI.** Reply "approve" / "yes" or "reject" / "no" as the first line. Adds zero infrastructure; works from any phone.
- **Phase 0 is the current state** — scaffolding only. Don't propose features past the current phase without revisiting the phasing doc.

## Hard constraints

- **Tier-coded tool boundaries** are non-negotiable. A new tool is added by:
  1. Choosing its tier.
  2. Documenting the tier choice in `docs/tools.md`.
  3. Wiring the default policy (Auto / Email-gated / Off).
  No tool is added without a tier assignment.
- **Reversibility of Nudge tier** — anything in the Nudge tier must be undoable without data loss. If it isn't, it's actually Correct (or Escalate).
- **Email-gated approvals are the only mechanism for Correct-tier actions** in the default config. Adding alternative approval channels needs explicit user buy-in.
- **No remediation logic flows back into simplarr.** healarr observes simplarr from the outside.

## Active focus (current phase)

- **Phase 1 — Monitor + Triage**: polling, deterministic rules, dashboard summaries, email digests. Stay deterministic; agent stays out of the path.
- **Phase 2 — Read-only agent**: agent invoked, drafts proposals, email approvals.
- **Phase 3 — Write tools**: Nudge auto-execute, Correct gated by approval.
- **Phase 4 — Polish**: webhooks, Haiku routing for routine triage, simplarr homepage tile.
