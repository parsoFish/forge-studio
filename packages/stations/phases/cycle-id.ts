import type { CycleInput } from '@forge/flows';

/**
 * The cycle's own id, the `_logs/<cycleId>/` dir its agents write under —
 * `forge-8vfn.8.1.17` (T1 ruling 1562, §6.15). `runCycle` threads the id it
 * minted, so a missing one means something upstream dropped it: throw, never
 * fall back to the initiative id, whose dir Studio never reads.
 */
export function requireCycleId(input: Pick<CycleInput, 'initiativeId' | 'cycleId'>, site: string): string {
  if (input.cycleId) return input.cycleId;
  throw new Error(`${site}: input.cycleId is required (initiativeId="${input.initiativeId}")`);
}
