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
 * It removes ONLY ids this harness owns. It never removes an unrecognised
 * manifest, so `assertNoLiveDaemon` still refuses on genuine strays exactly as
 * before: this sweep narrows what the guard must complain about, it does not
 * weaken the guard.
 *
 * That containment claim was ATTACKED by a hostile review and one real hole was
 * found, so the rules below are narrower than the first version:
 *
 *  - **A harness slug must not be something a real title can slugify into.**
 *    Real initiative ids are `INIT-<YYYY-MM-DD>-<slug>`
 *    (`orchestrator/architect-runner.ts:1359`, `orchestrator/initiative-id.ts:4`)
 *    where `slug = slugify(title)` — lowercased, non-alphanumerics collapsed to
 *    `-`. The review proved `r4-12-ledger-nav` is reachable that way: R4-12 is a
 *    LIVE roadmap initiative whose F2 is literally "Cycle ledger dig-in", so a
 *    real initiative titled "R4-12 Ledger Nav" slugifies to exactly the fixture
 *    id and the sweep deleted its manifest. Before this sweep existed that
 *    manifest made the guard REFUSE — i.e. the operator was protected — so the
 *    first version turned "refuse loudly" into "delete silently". That slug is
 *    now in `DELIBERATELY_UNSWEPT_SLUGS`, at zero cost (see its note).
 *
 *  - **Undated ids are structurally safe.** Canonical real ids always carry a
 *    `YYYY-MM-DD` component, so an id like `INIT-r4-14-showcase-empty-inflight`
 *    cannot be produced by the real generator at all. Pinned by a test.
 *
 *  - **The `_logs/` scratch-KB rule matches by PREFIX, not substring.** The
 *    first version used `dirname.includes('journey-scratch-kb')`, which would
 *    also match a real dir that merely mentioned it anywhere in its name.
 *
 *  - **Daemon liveness is checked BEFORE this sweep runs**
 *    (`assertNoLiveDaemonProcess`, `e2e-journey.mjs`), so no deletion can happen
 *    while a real `forge serve` is mid-cycle.
 *
 * The slug list cannot rot: `scripts/journey-residue-sweep.test.ts` scans the
 * journey sources — `scripts/e2e-journey.mjs` included — for every `INIT-…`
 * fixture literal and fails if one is neither swept nor explicitly and
 * justifiably excluded.
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
  // AUTO_CYCLE_ID (journey-fixtures.mjs:77) is built by CONCATENATION —
  // `${CYCLE_ID}-automated` — so it never appears as an `INIT-${X}-slug`
  // literal and the source-scanning ratchet could not see it. Found from the
  // real residue a CLEAN full run left behind (~35 of these had accumulated in
  // the real checkout). The runtime ratchet added alongside this entry now
  // imports the fixtures module and inspects exported VALUES, so a
  // concatenation-built id can never hide from it again.
  'e2e-toc-write-mode-automated',
  'home-fixture-active',
  'home-fixture-gated',
  'monitor-fixture-active',
  'monitor-fixture-failed',
];

/**
 * Harness fixture slugs deliberately NOT swept, each with the reason it is safe
 * to leave. A slug belongs here when sweeping it would risk deleting a real
 * operator initiative and leaving it costs us nothing.
 */
export const DELIBERATELY_UNSWEPT_SLUGS = {
  'r4-12-ledger-nav':
    'COLLIDABLE and unnecessary. A real initiative titled "R4-12 Ledger Nav" slugifies to exactly ' +
    'this id (R4-12 is a live roadmap initiative), so sweeping it could delete real work. Leaving ' +
    'it costs nothing: it is only ever written to _queue/done/ (scripts/journeys/stand-up-create.mjs:131), ' +
    'and assertNoLiveDaemon only inspects pending/in-flight/flow-runs (journey-daemon-guard.mjs:54,63) — ' +
    'so residue here can never block a later run, which is the whole failure this sweep exists to stop.',
};

/**
 * A swept DATED slug should carry a token no real initiative title would
 * produce. `authored-flow-run` is the one exception and is listed here with its
 * reason, so adding another unmarked slug is a conscious act, not an accident.
 * Enforced by `scripts/journey-residue-sweep.test.ts`.
 */
export const UNTOKENED_SWEPT_SLUGS = {
  'authored-flow-run':
    'Kept swept despite carrying neither "e2e" nor "fixture". It is J5_INIT, which moves through ' +
    'pending/in-flight (cleanFirstFlowRun sweeps all six states), so residue here CAN block the ' +
    'daemon guard and must be swept — and cleanFirstFlowRun itself runs at e2e-journey.mjs:419, ' +
    'AFTER the guard, so it cannot cover this. Collision risk accepted as remote: it reads as a ' +
    'test-fixture description, not a feature title anyone would name an initiative.',
};

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

/**
 * The suffix EVERY journey-seeded STANDALONE AGENT-RUN log dir must carry.
 *
 * W8-F4 (found by adversarial review): a journey fixture can also create a
 * `_logs/_agent-<slug>-<stamp>` directory — the shape `collectRecentAgentRuns`
 * (cli/ui-bridge.ts) enumerates to build the standalone half of the
 * everything-ledger. That shape is NOT `INIT-…`, so neither this module nor
 * either ratchet in `scripts/journey-residue-sweep.test.ts` could see it, and a
 * SIGKILL mid-run leaked one per crash, forever. The `_agent-` PREFIX is forced
 * by the route (a fixture cannot opt out of it), so ownership is declared by a
 * suffix instead — a real run's id is a timestamp and can never end in this.
 */
export const JOURNEY_AGENT_RUN_SUFFIX = '-journey-fixture';

/**
 * Journey-seeded standalone agent-run dirs that predate
 * `JOURNEY_AGENT_RUN_SUFFIX` and are pinned by exact id.
 *
 * Enumerated rather than pattern-matched because these are FIXED literals with
 * fixed fake timestamps (2026-01-01 / 2026-08-10) — an exact-id list cannot
 * collide with an operator's real run, and the ratchet below fails if a new
 * `_agent-…` literal appears that is covered by neither mechanism. Sweeping
 * them closes a pre-existing leak of the same class as the one W8-F4 found in
 * its own new fixture.
 */
export const JOURNEY_AGENT_RUN_IDS = [
  '_agent-architect-2026-01-01T00-10-00-000-r606',
  '_agent-developer-ralph-2026-08-10T00-00-00-000-e2e',
  '_agent-adversarial-review-2026-08-10T00-05-00-000-e2e',
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
 *  Four shapes, all unambiguous:
 *    - `<stamp>_INIT-<date>-<known-slug>`  — an emulated cycle's log dir
 *    - `INIT-<date>-<known-slug>`          — the same, unstamped
 *    - anything embedding `journey-scratch-kb` — the harness's own scratch KB
 *      (its `_brainfix-journey-scratch-kb-*-consolidate-*` run dirs and its
 *      `journey-scratch-kb-ingest-activity` fixture cycle). A real KB cannot
 *      collide with that id: the knowledge journey creates and destroys it. */
export function isJourneyOwnedLogDir(dirname) {
  // PREFIX, not substring (hostile-review finding): `includes` would also match
  // a real directory that merely mentions the scratch KB somewhere in its name.
  // These two shapes are the only ones the harness actually creates —
  // `journey-scratch-kb-ingest-activity` (the ingest fixture cycle) and
  // `_brainfix-journey-scratch-kb-{cleanup,maintain}-consolidate-<runId>`.
  if (dirname.startsWith('journey-scratch-kb') || dirname.startsWith('_brainfix-journey-scratch-kb')) return true;
  // W8-F4: a journey-seeded STANDALONE AGENT RUN. The `_agent-` prefix is the
  // route's, not ours; the suffix (or the exact-id list, for the three that
  // predate it) is what makes it ours.
  if (dirname.startsWith('_agent-') && dirname.endsWith(JOURNEY_AGENT_RUN_SUFFIX)) return true;
  if (JOURNEY_AGENT_RUN_IDS.includes(dirname)) return true;
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
