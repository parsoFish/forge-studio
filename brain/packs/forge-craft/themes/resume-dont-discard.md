---
title: Resume, don't discard — a unifier failure keeps per-WI work
description: When only the integration step fails, resume from the unifier; never throw away the completed per-work-item branches and re-run the whole cycle.
category: pattern
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# Resume, don't discard

The expensive part of a cycle is the per-WI dev-loop work. The unifier (the
integration + PR step) is cheap by comparison. So a unifier-only failure — or a
human send-back at the verdict gate — must **resume from the unifier boundary**, not
restart the whole cycle:

- Per-WI branches that already passed their gates are preserved; the unifier re-runs
  against them (rebase onto current main, re-open/refresh the PR).
- A send-back appends unifier-work-items (UWIs) the unifier drains in place — one
  cycle, no fresh decomposition, no discarded dev-loop output.
- The manifest records a `resume_from` boundary so the scheduler skips the
  already-done phases.

Anti-pattern: treating any post-dev failure as "the cycle failed, requeue from
scratch" — that re-pays the most expensive phase and can delete branches a human
wanted to keep. The diff/delivery event is delivery truth; a stale per-WI `failed`
status after a resume is not.

## Sources

- ADR 019 (resume from unifier) + ADR 026 (review→unifier UWI list, no send-back).
- Cross-cycle theme: stale-status-vs-real-delivery.
