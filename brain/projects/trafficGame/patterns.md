# trafficGame — Patterns

> Project-specific patterns. `brain-lint` ensures every theme page with `category: pattern` (project-scoped) appears here exactly once.

- [`canvas-bpr-flow-tests`](./themes/canvas-bpr-flow-tests.md) — Visual tests via Playwright are mandatory for canvas / physics / BPR / scoring changes.
- [`2026-05-10-ui-canvas-overlay-pattern`](./themes/2026-05-10-ui-canvas-overlay-pattern.md) — Overlays share one canvas with the paused game; `CanvasScreen` snapshots the frame and restores it each redraw (PR #56, `01630c7`).
- [`2026-05-23-grading-frontier-infrastructure`](./themes/2026-05-23-grading-frontier-infrastructure.md) — `scripts/grading/runSweep.mjs` parallel-sweep library + `docs/baselines/` locked frontier docs + `docs/baselines/screenshots/` curated visual reference. Turns "is this design better" into a measurable score-delta.
