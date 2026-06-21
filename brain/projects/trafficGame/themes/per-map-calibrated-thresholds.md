---
title: 'trafficGame — per-map star thresholds are hand-tuned, not auto-generated'
description: >-
  Each map's star thresholds are calibrated against realistically achievable
  scores via playtesting. Auto-generating from heuristics produces
  frustrating-or-trivial maps.
category: decision
keywords:
  - trafficgame
  - star-threshold
  - calibration
  - playtest
  - learnings-doc
  - scoring
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# trafficGame — per-map star thresholds are hand-tuned

Every trafficGame map has hand-tuned, "realistically achievable" star thresholds documented in `docs/LEARNINGS.md`. The thresholds are derived from playtesting, not auto-computed from a scoring formula.

Why this matters for agents:

- **An agent must not rewrite thresholds** unless the work item explicitly says "recalibrate map X" with a referenced playtest result.
- **Adding a new map** requires playtest input from the human, captured in `docs/LEARNINGS.md`. The architect should treat "add map without playtest data" as an Engineering-critic escalation, not a mechanical auto-resolve.
- **Refactoring the scoring model** is allowed, but must regenerate thresholds against existing maps using the same playtest data. The agent should refuse if `docs/LEARNINGS.md` is missing or stale.

This is the prime example of *taste-signal-as-data* in trafficGame: per-map LEARNINGS entries are the project's calibration ground truth.

## Sources

- trafficGame README — "Each map has calibrated star thresholds based on realistically achievable scores."
- `docs/LEARNINGS.md` (in the project repo) — per-map strategy notes.
