/**
 * queue-state.mjs — the single place that reads WHICH `_queue/` directory an
 * initiative's manifest currently sits in (`packages/flows/queue.ts`'s own
 * `QueueState`: `pending → in-flight → ready-for-review → merged → done`,
 * with `failed` as the side branch from `in-flight`). Read-only — it moves
 * nothing.
 *
 * Both harness drivers (`scripts/verify-cycle.mjs`,
 * `scripts/stories/d12-demo-runs.mjs`) and the d12 teardown module
 * (`scripts/stories/d12-demo-runs-teardown.mjs`) need this exact read, so it
 * lives here once rather than three times.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from '@forge/flows';

/** The `getPaths()` keys, in queue order. */
export const QUEUE_STATES = Object.freeze(['pending', 'inFlight', 'readyForReview', 'merged', 'done', 'failed']);

/** Which `_queue/<state>/` holds `initiativeId`'s manifest right now (a
 *  `QUEUE_STATES` entry), or `'absent'` when it is in none of them. */
export function manifestQueueState(forgeRoot, initiativeId) {
  const paths = getPaths(join(forgeRoot, '_queue'));
  const found = QUEUE_STATES.find((state) => existsSync(join(paths[state], `${initiativeId}.md`)));
  return found ?? 'absent';
}
