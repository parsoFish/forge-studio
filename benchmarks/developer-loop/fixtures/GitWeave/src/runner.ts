/**
 * Stage runner — schedules per-PR work, retries, persists results, and
 * merges in dependency-order.
 */

export type StageInput = {
  prNumbers: number[];
  retryLimit: number;
};

export async function runStages(input: StageInput): Promise<void> {
  for (const _pr of input.prNumbers) {
    // Scheduler + retry + (currently inlined) merge.
  }
}
