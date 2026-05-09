# GitWeave (fixture)

Minimal slice of the GitWeave project for the developer-loop benchmark.
WI-1 creates `src/multipart.ts` with a `splitOnBoundary` helper.

## Layout

- `src/runner.ts` — pre-existing stage runner (regression target).
- `tests/runner.test.ts` — pre-existing tests (must not regress).
- `tests/multipart.test.ts` — failing acceptance test for WI-1.
- `.forge/work-items/WI-1.md` — work-item spec.
