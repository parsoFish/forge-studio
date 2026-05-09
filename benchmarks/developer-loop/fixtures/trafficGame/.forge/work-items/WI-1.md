---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2026-05-09-trafficgame-distribute-flow
status: pending
depends_on: []
acceptance_criteria:
  - given: "an intersection with N outbound edges and an incoming load"
    when:  "distributeFlow(intersection, incomingLoad) is called"
    then:  "the sum of returned loads equals min(incomingLoad, sum_of_effective_capacities)"
  - given: "any edge in the result"
    when:  "its load is read"
    then:  "the load is in [0, edge.effective_capacity] (no edge ever exceeds its capacity)"
  - given: "edges with equal capacities and equal priorities and incomingLoad below total capacity"
    when:  "distributeFlow runs"
    then:  "load is divided equally across the edges"
  - given: "edges with skewed capacities and equal priority"
    when:  "incomingLoad fits within total capacity"
    then:  "the distribution preserves the capacity ratio"
  - given: "incomingLoad large enough that the proportional split would saturate one or more edges"
    when:  "distributeFlow runs"
    then:  "every edge caps at its effective capacity (sum equals min(incomingLoad, totalCap))"
  - given: "an intersection with no outbound edges"
    when:  "distributeFlow runs"
    then:  "an empty array is returned"
  - given: "incomingLoad of 0"
    when:  "distributeFlow runs"
    then:  "one entry per edge is returned with load 0"
  - given: "edges in any input order"
    when:  "distributeFlow returns its result"
    then:  "the result is sorted by edgeId ascending (deterministic)"
  - given: "edges with equal capacity but different priorities"
    when:  "incomingLoad <= highest-priority edge capacity"
    then:  "the higher-priority edge (lower priority number) absorbs all of the load"
  - given: "edges with different priorities and incomingLoad exceeds the highest-priority edge"
    when:  "distributeFlow runs"
    then:  "the highest-priority edge fills first; remainder flows to the next priority tier"
  - given: "a calibrator that scales edge capacities"
    when:  "distributeFlow is called with that calibrator"
    then:  "each edge's effective_capacity = capacity * calibrator.factor(edgeId), and the algorithm uses that effective capacity throughout"
  - given: "no calibrator is passed to distributeFlow"
    when:  "the function runs"
    then:  "it uses defaultCalibrator (which returns 1.0 for every edge — i.e., capacity unchanged)"
  - given: "an input intersection"
    when:  "distributeFlow returns"
    then:  "the input intersection (and its edgesOut array) are not mutated"
files_in_scope:
  - src/flow.ts
  - src/intersections.ts
  - src/calibration.ts
estimated_iterations: 4
---

# Implement priority-aware, calibrator-driven `distributeFlow`

The simulation's per-tick loop needs a richer load-distribution function. This work item lands the algorithm across **three coordinated source files**:

- `src/intersections.ts` — already updated to add a `priority: number` field on `Edge` and an `EdgeLoad` result type.
- `src/calibration.ts` — **new file**; export a `Calibrator` interface plus a `defaultCalibrator` constant.
- `src/flow.ts` — add the `distributeFlow` function, importing the calibrator and the intersection types.

## Function signature

```ts
import type { Intersection, EdgeLoad } from './intersections.ts';
import type { Calibrator } from './calibration.ts';

export function distributeFlow(
  intersection: Intersection,
  incomingLoad: number,
  calibrator?: Calibrator,
): EdgeLoad[];
```

`Calibrator` shape:

```ts
export interface Calibrator {
  factor(edgeId: string): number;  // multiplier applied to edge.capacity to get effective capacity
}

export const defaultCalibrator: Calibrator;  // factor() returns 1.0 for every edgeId
```

## Algorithm

For each call, compute each edge's **effective capacity** = `edge.capacity * calibrator.factor(edge.id)`.

Then, in priority order (lowest `priority` number first; ties broken by edgeId ascending):

1. Group edges by priority tier.
2. Within a tier, distribute the *remaining* incomingLoad proportionally to effective capacity, capping each edge at its effective capacity.
3. Move to the next priority tier with whatever load remains.
4. If incomingLoad runs out, remaining edges get load 0.
5. If load exceeds the sum of all effective capacities, every edge saturates at its effective capacity.

Output is **always sorted by edgeId ascending** regardless of priority order or input order.

Edge cases:
- Empty `edgesOut` → return `[]`.
- `incomingLoad === 0` → return one `{edgeId, load: 0}` entry per edge.
- Missing calibrator argument → use `defaultCalibrator` (every edge gets its raw capacity).

## Failing tests

`tests/distribute-flow.test.ts` has 13 acceptance-criterion tests, currently failing. **Make them all pass without modifying the test file.** The pre-existing `tests/flow.test.ts` (predictLoads) must keep passing too.

## Hard rules

- Files in scope: `src/flow.ts`, `src/intersections.ts`, `src/calibration.ts` only.
- Do not modify `predictLoads`, `estimateLoad`, or `tick`.
- No new external dependencies.
- TypeScript strict mode applies — no implicit `any`, exhaustive types.
- The input intersection must not be mutated. Construct fresh result objects.

## Brain themes worth a look

- `algorithm-heavy-items` (project theme) — historical 48% failure rate when this archetype was scoped as a single WI. This fixture deliberately leaves the algorithm coupled to validate the developer loop.
- `dependency-ordered-work` — why determinism (sort by id) matters.
- `declarative-specs-vs-imperative` — keep `distributeFlow` a pure function over input data.
