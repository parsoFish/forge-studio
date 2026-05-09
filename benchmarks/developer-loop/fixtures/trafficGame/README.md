# trafficGame (fixture)

Minimal slice of the trafficGame project for the developer-loop benchmark.
WI-1 adds a `decayFlow` helper to `src/flow.ts`.

## Layout

- `src/flow.ts` — flow predictor.
- `src/intersections.ts` — intersection model + edge graph.
- `tests/flow.test.ts` — pre-existing tests (must not regress).
- `tests/decay-flow.test.ts` — failing acceptance test for WI-1.
- `.forge/work-items/WI-1.md` — work-item spec.
