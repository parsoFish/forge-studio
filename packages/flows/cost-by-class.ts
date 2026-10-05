/**
 * §7.3 release-definition gap — "cost-per-merged-initiative by class". Pure
 * producer: reads every manifest in `_queue/done/` (MERGED), buckets by its
 * D-34 `class` frontmatter, and sums each bucket's authoritative spend
 * from its cycle log, reusing `@forge/kernel`'s `deriveSessionCostUsd` (the
 * one cost rule every other surface uses) rather than re-deriving cost math.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

import { deriveSessionCostUsd } from '@forge/kernel';
import { CHANGE_CLASSES } from './manifest.ts';

export type CostClass = (typeof CHANGE_CLASSES)[number] | 'unclassified';

export type CostByClassRow = {
  readonly class: CostClass;
  readonly merged: number; // `_queue/done/` manifests in this class — all MERGED.
  readonly totalUsd: number; // sum over the PRICED initiatives in this class.
  readonly meanUsd: number; // totalUsd / (merged - unpriced); 0 if none priced.
  readonly unpriced: number; // no resolvable cost — never folded into totalUsd as $0.
};

/** Display order: the four D-34 classes, then the catch-all. */
const CLASS_ORDER: readonly CostClass[] = [...CHANGE_CLASSES, 'unclassified'];

/**
 * Read `class` + `cycle_id` off a manifest's RAW frontmatter (gray-matter,
 * same library `manifest.ts` parses with) — NOT `parseManifest`, which
 * throws on a missing `class`. Every manifest in this repo's `_queue/done/`
 * today predates D-34 and has none, so that path would silently drop
 * every merged initiative instead of bucketing it `unclassified`. A file
 * this lenient read cannot even open still counts: unclassified, unpriced.
 */
function readClassAndCycleId(manifestPath: string): { class: CostClass; cycleId: string | null } {
  let data: Record<string, unknown>;
  try {
    data = matter(readFileSync(manifestPath, 'utf8')).data as Record<string, unknown>;
  } catch {
    return { class: 'unclassified', cycleId: null };
  }
  const rawClass = data['class'];
  const cls: CostClass = typeof rawClass === 'string' && (CHANGE_CLASSES as readonly string[]).includes(rawClass) ? (rawClass as CostClass) : 'unclassified';
  const rawCycleId = data['cycle_id'];
  const cycleId = typeof rawCycleId === 'string' && rawCycleId.length > 0 ? rawCycleId : null;
  return { class: cls, cycleId };
}

/**
 * Authoritative cost for one cycle from `_logs/<cycleId>/events.jsonl`.
 * `null` (never `0`) when there is no cycle id, no log, or no priced row —
 * a genuine $0 row is a different fact, a distinction `deriveSessionCostUsd`
 * already draws.
 */
function readCycleCostUsd(logsRoot: string, cycleId: string | null): number | null {
  if (cycleId === null) return null;
  const logPath = join(logsRoot, cycleId, 'events.jsonl');
  if (!existsSync(logPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }
  const events = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
    .filter((e): e is Record<string, unknown> => e !== null);
  return deriveSessionCostUsd(events);
}

/** Cost-per-merged-initiative by D-34 change class (§7.3 evidence).
 *  `forgeRoot` is the operator-trusted forge checkout root — read only. */
export function costByClass(forgeRoot: string): CostByClassRow[] {
  const root = resolve(forgeRoot);
  const doneDir = join(root, '_queue', 'done');
  const logsRoot = join(root, '_logs');
  const buckets = new Map<CostClass, { merged: number; totalUsd: number; unpriced: number }>();
  const files = existsSync(doneDir) ? readdirSync(doneDir).filter((f) => f.endsWith('.md')).sort() : [];

  for (const file of files) {
    const { class: cls, cycleId } = readClassAndCycleId(join(doneDir, file));
    const bucket = buckets.get(cls) ?? { merged: 0, totalUsd: 0, unpriced: 0 };
    bucket.merged += 1;
    const costUsd = readCycleCostUsd(logsRoot, cycleId);
    if (costUsd === null) bucket.unpriced += 1;
    else bucket.totalUsd += costUsd;
    buckets.set(cls, bucket);
  }

  return CLASS_ORDER.filter((c) => buckets.has(c)).map((c) => {
    const b = buckets.get(c)!;
    const priced = b.merged - b.unpriced;
    return { class: c, merged: b.merged, totalUsd: b.totalUsd, meanUsd: priced > 0 ? b.totalUsd / priced : 0, unpriced: b.unpriced };
  });
}
