---
title: trafficGame — canvas + BPR flow regressions need visual tests
description: Vitest unit tests miss canvas rendering and BPR-flow prediction regressions. Playwright test:visual is the orchestrator-verified gate for the game's correctness.
category: pattern
keywords: [trafficgame, playwright, visual-test, canvas, bpr, flow-prediction, regression]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# trafficGame — canvas + BPR flow regressions need visual tests

trafficGame is a canvas game. Subtle changes in road placement, vehicle physics, or BPR-based flow prediction don't surface in unit tests but show up immediately in `npm run test:visual` (Playwright).

Discipline for trafficGame's developer loop:

- **Quality-gates verifier runs both** `npm test` *and* `npm run test:visual` for any work item touching:
  - The canvas rendering layer.
  - Vehicle physics or movement.
  - BPR flow prediction.
  - Score calculation.
- For pure-utility / type-only / docs work items, `npm test` alone is sufficient.

The reviewer phase should refuse to merge if visual diffs aren't reviewed; the human shouldn't have to dig.

## Sources

- trafficGame README — lists Vitest + Playwright as the two test entry points.
- `docs/MVP_ARCHITECTURE.md` — defines the canvas + BPR core systems.

## Related

- [Theme: Quality gates orchestrator-verified](../../../forge/themes/quality-gates-orchestrator-verified.md) — verification principle.
- [Theme: TDD with agents](../../../forge/themes/tdd-with-agents.md) — orchestrator-runs-tests discipline.
