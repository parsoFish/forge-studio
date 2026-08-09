/**
 * SHOWCASE pure derivers (R4-14 WI-1/WI-2/WI-3) — which cycle a project's
 * "demo showcase" page should render, the stats-strip summary of that
 * cycle's `DemoModel`, and the gate for whether the project page offers the
 * "open showcase" affordance at all.
 *
 * `deriveShowcaseCycleId` is deliberately NOT built on
 * `./project-cycle-ledger.ts`'s `deriveProjectCycleLedgerRows` (which turns
 * EVERY cycle, of every status, into a history row with no filtering) — this
 * is a narrower "pick the one showcase-worthy cycle" query. It DOES reuse
 * that file's `status === 'merged' || status === 'done'` terminal-check
 * shape (a cycle counts as showcase-worthy only once its merge has actually
 * landed, per `Cycle.status`'s own note in `./bridge-client.ts`).
 *
 * The recency ordering itself is NOT `./history-ledger.ts`'s
 * `sortLedgerRowsNewestFirst` — that helper (and its private `parseWhenMs`
 * seam) key on a single `LedgerRow.when` field, but this deriver's ordering
 * is a three-step fallback chain per cycle (`endedAt ?? startedAt ?? a
 * cycleId-embedded timestamp`, T1 ruling) that has no `LedgerRow` shape to
 * key on. A small explicit per-cycle comparator is the honest fit rather
 * than forcing an ill-fitting reuse.
 */

import type { Cycle, DemoModel } from './bridge-client';

// ---------------------------------------------------------------------------
// deriveShowcaseCycleId (R4-14 WI-1)
// ---------------------------------------------------------------------------

/** Parse a raw ISO-ish string into epoch ms, or `null` if absent/unparsable —
 *  the same "validate the parse result" discipline as `./history-ledger.ts`'s
 *  `parseWhenMs` (not reused directly: that helper is unexported and keys a
 *  single field, this call site needs the same validity check applied to
 *  THREE different sources in a fallback chain). */
function parseValidMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Extract the leading `<ISO-ish-timestamp>_` stamp a `cycleId` is formatted
 *  with (`./cycle-grouping.ts`'s documented convention, e.g.
 *  `2026-07-01T00-00-00_INIT-showcase-a`) and parse it to epoch ms. The
 *  time-of-day segment uses `-` in place of `:` (filesystem-safe), so it is
 *  rewritten back to a parseable ISO string before `Date` sees it. `null`
 *  when the cycleId doesn't carry a recognizable leading stamp at all. */
function parseCycleIdTimestampMs(cycleId: string): number | null {
  const match = cycleId.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})_/);
  if (!match) return null;
  const [, datePlusHour, minute, second] = match;
  return parseValidMs(`${datePlusHour}:${minute}:${second}Z`);
}

/** The fallback chain (T1 ruling): `endedAt ?? startedAt ?? <cycleId stamp>`,
 *  each step independently validated so a genuinely-newer cycle whose
 *  `endedAt` has not landed yet is never out-ranked by an older cycle whose
 *  `endedAt` happens to be set. */
function resolveShowcaseCycleTimeMs(cycle: Cycle): number | null {
  return (
    parseValidMs(cycle.endedAt) ?? parseValidMs(cycle.startedAt) ?? parseCycleIdTimestampMs(cycle.cycleId)
  );
}

/** True once a `Cycle`'s merge has actually landed — the terminal-check
 *  shape reused from `./project-cycle-ledger.ts`'s
 *  `deriveProjectCycleLedgerSegments`. */
function isShowcaseTerminalCycle(cycle: Cycle): boolean {
  return cycle.status === 'merged' || cycle.status === 'done';
}

/**
 * The `cycleId` of the NEWEST `merged`/`done` cycle belonging to `projectId`,
 * or `null` when no such cycle exists (the project has no cycles at all, or
 * none of its cycles ever reached merged/done). Every other status
 * (in-flight / ready-for-review / failed / pending) is excluded, as is every
 * other project.
 */
export function deriveShowcaseCycleId(cycles: Cycle[], projectId: string): string | null {
  const eligible = cycles.filter((cycle) => cycle.project === projectId && isShowcaseTerminalCycle(cycle));
  if (eligible.length === 0) return null;

  let newest = eligible[0];
  let newestMs = resolveShowcaseCycleTimeMs(newest) ?? -Infinity;
  for (const cycle of eligible.slice(1)) {
    const ms = resolveShowcaseCycleTimeMs(cycle) ?? -Infinity;
    if (ms > newestMs) {
      newest = cycle;
      newestMs = ms;
    }
  }
  return newest.cycleId;
}

// ---------------------------------------------------------------------------
// deriveShowcaseStats (R4-14 WI-2)
// ---------------------------------------------------------------------------

export type ShowcaseAcVerdictCounts = { met: number; partial: number; missed: number };

export type ShowcaseStats = {
  testEvidenceCount: number;
  prUrl: string | null;
  branch: string | null;
  commitSha: string | null;
  acVerdictCounts: ShowcaseAcVerdictCounts;
};

/**
 * Reduce an already-fetched `DemoModel` (the same one `DemoComparison`
 * renders) to a small stats-strip summary — no new fetch, no re-derivation
 * of anything the model doesn't genuinely carry. Absent fields render their
 * honest empty value (`0` / `null`), never a fabricated non-zero standing in
 * for a fact the model doesn't have.
 */
export function deriveShowcaseStats(model: DemoModel): ShowcaseStats {
  const acVerdictCounts: ShowcaseAcVerdictCounts = { met: 0, partial: 0, missed: 0 };
  for (const evaluation of model.acEvaluations ?? []) {
    acVerdictCounts[evaluation.verdict] += 1;
  }
  return {
    testEvidenceCount: model.testEvidence?.length ?? 0,
    prUrl: model.summary?.prUrl ?? null,
    branch: model.summary?.branch ?? null,
    commitSha: model.summary?.commitSha ?? null,
    acVerdictCounts,
  };
}

// ---------------------------------------------------------------------------
// showShowcaseEntry (R4-14 WI-3)
// ---------------------------------------------------------------------------

/**
 * Gate for the project page's "open showcase" affordance — TRUE iff
 * `deriveShowcaseCycleId` resolves a real cycle for this project. Deliberately
 * NOT an independent merged|done scan of its own (a maintenance fork that
 * could silently diverge from the deriver the showcase page itself calls),
 * so the link is never offered for a project the showcase page would then
 * render empty for.
 */
export function showShowcaseEntry(cycles: Cycle[], projectId: string): boolean {
  return deriveShowcaseCycleId(cycles, projectId) !== null;
}
