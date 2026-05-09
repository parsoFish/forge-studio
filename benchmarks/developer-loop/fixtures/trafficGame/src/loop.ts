import { predictLoads } from './flow.ts';
import type { Intersection } from './intersections.ts';

export type LoopState = {
  intersections: Intersection[];
  tick: number;
  /** Cumulative load fed into each intersection across ticks. Set by the loop runner. */
  inflow: Map<string, number>;
};

export function tick(state: LoopState): void {
  const _loads = predictLoads(state.intersections, state.tick);
  state.tick += 1;
}
