/**
 * The demo's capture outcome (forge-nk1y.43): what the orchestrator's
 * before/after comparison found, as a NAMED state — an all-`unchanged` capture
 * is `no-change`, never a silent pass. Shared by the integrate band (recorded on
 * demo.json and the PR body) and the verdict gate (its headline), so the two
 * can never count differently. `test-evidence` checkpoints carry gate output,
 * not a before/after pair, and are not counted.
 */

export type DemoOutcomeKind = 'changed' | 'no-change' | 'unknown';
export type DemoOutcome = { kind: DemoOutcomeKind; compared: number; changed: number; unchanged: number; unknown: number };

/** `null` when no checkpoint was compared (capture did not run). */
export function demoOutcomeOf(checkpoints: ReadonlyArray<{ delta?: string | null; form?: string }>): DemoOutcome | null {
  const pairs = checkpoints.filter((c) => c.form !== 'test-evidence' && typeof c.delta === 'string');
  if (pairs.length === 0) return null;
  const changed = pairs.filter((c) => c.delta === 'changed').length;
  const unchanged = pairs.filter((c) => c.delta === 'unchanged').length;
  const unknown = pairs.length - changed - unchanged;
  const kind: DemoOutcomeKind = changed > 0 ? 'changed' : unknown === pairs.length ? 'unknown' : 'no-change';
  return { kind, compared: pairs.length, changed, unchanged, unknown };
}

/** One line naming the outcome, for the verdict headline, demo.json's essence and the PR body. */
export function demoOutcomeHeadline(o: DemoOutcome): string {
  if (o.kind === 'changed') return `${o.changed} of ${o.compared} checkpoints changed behaviour`;
  if (o.kind === 'unknown') return `Demo compared no checkpoint — ${o.unknown}/${o.compared} could not be compared`;
  const notCompared = o.unknown > 0 ? `, ${o.unknown} could not be compared` : '';
  return `Demo captured no behaviour change — ${o.unchanged}/${o.compared} checkpoints identical${notCompared}`;
}
