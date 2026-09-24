/**
 * Wire-numeric normalization for `Run.costUsd` / `RunPhaseMeta.costUsd`
 * (forge-byh), split out of `studio-client.ts` so `parseRun`'s own fix stays
 * a one-line call at each field rather than growing that file past its
 * file-size ratchet.
 *
 * `parseRun`'s field defaults (`?? null` / `?? 0`) only ever covered ABSENT
 * keys; a key that IS present but holds the wrong type sailed straight
 * through as a fake `number`, all the way to `.toFixed()` — a malformed
 * `phaseMeta[node].costUsd` crashed FlowRunDetail's timeline, and a
 * malformed top-level `costUsd` crashed the shared HistoryLedger, the same
 * unguarded-cast shape at two call sites, closed here once.
 */

import type { RunPhaseMeta } from './studio-client';

/**
 * A wire numeric normalized to a genuine finite number, or `fallback` for
 * anything else (a string, `NaN`, an object — or absent).
 */
export function finiteNumberOr<F>(value: unknown, fallback: F): number | F {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalise a raw server `phaseMeta`, coercing each node's `costUsd` to a
 * genuine finite number (never a crash-in-waiting at every downstream
 * `.toFixed()` call). `0` mirrors `deriveFlowRunTimeline`'s own
 * `meta?.costUsd ?? 0` default for a MISSING phaseMeta entry — a malformed
 * value reads the same as one that was never recorded. Every other field on
 * the node (`retries`, `model`, `delivered`, …) is carried through
 * unchanged; forge-byh names `costUsd` specifically as the crash site.
 */
export function normalizePhaseMeta(raw: Record<string, RunPhaseMeta> | undefined): Record<string, RunPhaseMeta> {
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([nodeId, meta]) => [nodeId, { ...meta, costUsd: finiteNumberOr(meta?.costUsd, 0) }]),
  );
}
