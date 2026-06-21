# trafficGame — Decisions

> Project-specific decisions. `brain-lint` ensures every theme page with `category: decision` (project-scoped) appears here exactly once.

- [`per-map-calibrated-thresholds`](./themes/per-map-calibrated-thresholds.md) — Star thresholds are hand-tuned via playtesting, not auto-generated. Agents must not rewrite without playtest data.
- [`2026-05-23-binary-elevation-model`](./themes/2026-05-23-binary-elevation-model.md) — vehicle.currentElevation is the single source of truth; three update rules (locked-to-target on transitions, early-lift on next waypoint, early-lift on ramp CPs); all consumers read this one value; future-walk segments evaluated at TARGET, not source-to-target span. Unlocks +72% throughput on the crossroads map.
