/**
 * Crash-safe leading sweep for `ui:journey`'s own residue (W8-C2b, beads
 * forge-6lk + forge-yuq).
 *
 * WHY THIS EXISTS — the defect, measured, not assumed
 * ---------------------------------------------------
 * `scripts/e2e-journey.mjs` registers NO signal handlers. Node's default
 * disposition for SIGINT/SIGTERM terminates the process WITHOUT running a
 * pending `finally`, and SIGKILL cannot be handled at all — so every kind of
 * kill, an operator Ctrl-C included, skips the harness's end-of-run teardown
 * in full. Of its ~25 cleanup steps only 6 ran at the START of a run; the
 * other ~19 lived exclusively in that unreachable `finally`.
 *
 * The consequence was measured on 2026-08-24 by SIGKILLing a real run at beat
 * 6 of a six-journey pass. It left:
 *
 *     _queue/in-flight/INIT-2026-08-24-monitor-fixture-active.md
 *     _queue/failed/INIT-2026-08-24-monitor-fixture-failed.md
 *     _logs/2026-08-24T12-55-44Z_INIT-2026-08-24-monitor-fixture-active/
 *     projects/mdtoc/.forge/project.json   (left half-stripped, tracked file)
 *
 * and `scripts/lib/journey-daemon-guard.mjs`'s `assertNoLiveDaemon` throws on
 * exactly that in-flight manifest:
 *
 *     [e2e] REFUSING to seed: stray queue manifest(s)/request(s) already
 *     present: in-flight/INIT-2026-08-24-monitor-fixture-active.md
 *
 * That guard runs at `e2e-journey.mjs:358`, BEFORE the start-of-run cleanup at
 * `:380`. So the residue was self-perpetuating: the only code that could clear
 * it sat downstream of the guard that refused to proceed because of it.
 *
 * WHY IT READ AS FLAKY (and was misdiagnosed twice as a flaky AI-1 beat): the
 * detached Studio bridge SURVIVES the harness kill (it is spawned with its own
 * process group) and keeps mutating queue state afterwards. In one measured
 * re-run it had already cleared the stray before the next run's guard looked,
 * and that run passed. Whether the next run dies therefore depends on a race
 * with an orphan — non-deterministic, which is precisely what "flaky" means.
 *
 * THE CURE IS STRUCTURAL, NOT A CLEANUP STEP SOMEONE MUST REMEMBER
 * ----------------------------------------------------------------
 * This sweep runs at the START of every run, BEFORE the daemon guard. A
 * start-of-run sweep is crash-safe against every signal by construction — it
 * does not depend on the previous process having survived to do anything.
 *
 * It is also DATE-INDEPENDENT, which the per-id cleanups it backstops are not.
 * Every harness initiative id is stamped `INIT-<today>-<slug>`, so the existing
 * `rmSync(join(QDIR(q), `${INIT}.md`))` calls can only ever remove residue from
 * a run on the SAME DAY. Residue from a run killed yesterday was unreachable
 * forever and blocked the guard permanently. Matching on the SLUG fixes that.
 *
 * CONTAINMENT — why this cannot eat an operator's real work
 * ---------------------------------------------------------
 * It removes ONLY ids whose slug is in `JOURNEY_INIT_SLUGS` (or the one undated
 * id below) — every one of them a fixture literal owned by this harness. It
 * never removes an unrecognised manifest, so `assertNoLiveDaemon` still refuses
 * on genuine strays exactly as before: this sweep narrows what the guard has to
 * complain about, it does not weaken the guard. The `_logs/` sweep is held to
 * the same rule and additionally to prefixes that embed the harness's own
 * scratch KB id (`journey-scratch-kb`), which no real KB can collide with.
 *
 * The slug list cannot rot: `scripts/journey-residue-sweep.test.ts` scans the
 * journey sources for every `INIT-…` fixture literal and fails if one is not
 * covered here.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The six queue states a manifest can be sitting in. Mirrors the sweep in
 *  `e2e-journey.mjs`'s finally (`merged` is the transient QueueState
 *  pass-through dir, not the CycleOutcome value of the same name). */
export const QUEUE_STATES = ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed'];

/**
 * Every initiative-id SLUG this harness seeds into `_queue/`, i.e. the tail of
 * an `INIT-<YYYY-MM-DD>-<slug>` id. Sourced from the fixture literals in
 * `scripts/journeys/*.mjs` and `scripts/lib/journey-fixtures.mjs`; kept honest
 * by the ratchet test named in this file's header.
 */
export const JOURNEY_INIT_SLUGS = [
  'authored-flow-run',
  'e2e-dag-elsewhere',
  'e2e-dag-leaf',
  'e2e-dag-mid',
  'e2e-dag-root',
  'e2e-develop-trigger',
  'e2e-merged-state',
  'e2e-plan-trigger',
  'e2e-recovery-surface',
  'e2e-repoint-guard',
  'e2e-studio-demo',
  'e2e-toc-write-mode',
  'home-fixture-active',
  'home-fixture-gated',
  'monitor-fixture-active',
  'monitor-fixture-failed',
  'r4-12-ledger-nav',
];

/** Harness initiative ids that carry no date stamp. The R4-14 showcase trio
 *  was MISSED by hand-enumeration and caught by the ratchet test — one of them
 *  (`INIT-r4-14-showcase-empty-inflight`, `journey-fixtures.mjs:933`) is seeded
 *  straight into `_queue/in-flight/`, i.e. precisely the state that makes
 *  `assertNoLiveDaemon` refuse every subsequent run. That is why the ratchet
 *  exists rather than a comment asking people to remember. */
export const JOURNEY_UNDATED_INITS = [
  'INIT-r4-14-showcase-empty-inflight',
  'INIT-r4-14-showcase-evidence-a',
  'INIT-r4-14-showcase-evidence-b',
  'INIT-r6-06-agent-ledger-flow-node',
];

const DATE_STAMP = '\\d{4}-\\d{2}-\\d{2}';

/** `INIT-<date>-<slug>` for a KNOWN slug, allowing the two sidecar filename
 *  shapes the harness also writes (`.verdict-response.md`, and the
 *  `-e2e-develop-trigger` suffix the develop-trigger fixture appends to the
 *  main initiative id). Anchored at both ends: a partial slug match must never
 *  qualify an id this harness does not own. */
function ownedInitPattern() {
  const slugs = JOURNEY_INIT_SLUGS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^INIT-${DATE_STAMP}-(?:${slugs})(?:-e2e-develop-trigger)?(?:\\.verdict-response)?\\.md$`);
}

/** True iff `filename` is a `_queue/` manifest THIS HARNESS wrote. */
export function isJourneyOwnedQueueFile(filename) {
  if (JOURNEY_UNDATED_INITS.some((id) => filename === `${id}.md` || filename === `${id}.verdict-response.md`)) return true;
  return ownedInitPattern().test(filename);
}

/** True iff a `_logs/<dir>` entry is one THIS HARNESS created.
 *
 *  Three shapes, all unambiguous:
 *    - `<stamp>_INIT-<date>-<known-slug>`  — an emulated cycle's log dir
 *    - `INIT-<date>-<known-slug>`          — the same, unstamped
 *    - anything embedding `journey-scratch-kb` — the harness's own scratch KB
 *      (its `_brainfix-journey-scratch-kb-*-consolidate-*` run dirs and its
 *      `journey-scratch-kb-ingest-activity` fixture cycle). A real KB cannot
 *      collide with that id: the knowledge journey creates and destroys it. */
export function isJourneyOwnedLogDir(dirname) {
  if (dirname.includes('journey-scratch-kb')) return true;
  const initPart = dirname.includes('_INIT-') ? dirname.slice(dirname.indexOf('_INIT-') + 1) : dirname;
  const slugs = JOURNEY_INIT_SLUGS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (new RegExp(`^INIT-${DATE_STAMP}-(?:${slugs})$`).test(initPart)) return true;
  return JOURNEY_UNDATED_INITS.includes(initPart);
}

/**
 * Remove every `_queue/` manifest and `_logs/` directory this harness owns,
 * from ANY date. Returns the list of removed repo-relative paths so the caller
 * can report exactly what a previous crashed run had left behind — silence
 * about a real cleanup is how this class stayed invisible for so long.
 *
 * Best-effort per entry (a single unremovable path must not abort the sweep and
 * strand the rest), but every failure is returned to the caller rather than
 * swallowed.
 */
export function sweepJourneyResidue(forgeRoot) {
  const removed = [];
  const failed = [];

  for (const q of QUEUE_STATES) {
    const dir = join(forgeRoot, '_queue', q);
    if (!existsSync(dir)) continue;
    let entries = [];
    try { entries = readdirSync(dir); } catch (err) { failed.push({ path: `_queue/${q}`, error: err.message }); continue; }
    for (const f of entries) {
      if (!isJourneyOwnedQueueFile(f)) continue;
      try { rmSync(join(dir, f), { force: true }); removed.push(`_queue/${q}/${f}`); }
      catch (err) { failed.push({ path: `_queue/${q}/${f}`, error: err.message }); }
    }
  }

  const logsRoot = join(forgeRoot, '_logs');
  if (existsSync(logsRoot)) {
    let entries = [];
    try { entries = readdirSync(logsRoot); } catch (err) { failed.push({ path: '_logs', error: err.message }); entries = []; }
    for (const d of entries) {
      if (!isJourneyOwnedLogDir(d)) continue;
      const p = join(logsRoot, d);
      try {
        if (!statSync(p).isDirectory()) continue;
        rmSync(p, { recursive: true, force: true });
        removed.push(`_logs/${d}`);
      } catch (err) { failed.push({ path: `_logs/${d}`, error: err.message }); }
    }
  }

  return { removed, failed };
}
