---
title: Fix ambient-env leaks at the SDK spawn seam, not in one launcher
description: Operator-shell env (headroom proxy vars, ANTHROPIC_BASE_URL) leaking into spawned agents must be scrubbed at forge's shared SDK spawn seam; per-launcher fixes let the same defect class recur on every new launch path.
category: decision
keywords: [env-leak, headroom, spawn-seam, ANTHROPIC_BASE_URL, sdk-agent-spawn, recurring-defect, env-pin]
created_at: 2026-07-13
updated_at: 2026-07-13
related_themes: [2026-07-11-orphaned-scheduler-stale-modules]
---

# Fix ambient-env leaks at the SDK spawn seam, not in one launcher

- **Evidence**: betterado 2026-07 run-friction (git history). The headroom proxy-env leak recurred **three times** — first fixed 2026-06-16 scoped inside `scripts/verify-cycle.mjs`; recurred 2026-07-02 (≈50% decompose max-turns failures, initially misattributed to brain-chasing); recurred again 2026-07-11 from a bridge launched via an unscrubbed shell. The seam-level pin (G8) remains OPEN/deferred.

A class of defect where ambient operator-shell variables (proxy base URLs,
compression-tool env) leak into spawned Claude Agent SDK children has recurred
repeatedly, and every prior fix landed in a single launch script rather than the
**shared SDK spawn seam** all launch paths pass through. Forge spawns agents from
several entry points (daemon, bridge, `verify-cycle`, `e2e-journey`, direct CLI),
so a per-launcher fix only covers the paths someone remembered to touch.

The durable fix is an allowlist/scrub applied **once at the shared spawn boundary**,
so every current and future launch path inherits it. As of last confirmed state
this is still open (G8) — worth flagging on sight if the leak resurfaces, because
the fix *location*, not the fix itself, is what keeps getting missed.

## See also

- [[2026-07-11-orphaned-scheduler-stale-modules]] — another long-lived-process / stale-context failure mode.
