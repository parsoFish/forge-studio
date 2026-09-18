/**
 * W8-C2b (beads forge-6lk + forge-yuq) — the crash-safe leading sweep.
 *
 * Two jobs, and the FIRST is the one that keeps this fix alive:
 *
 *  1. THE SOURCE RATCHET IS GONE (7.6.131). Three tests here scanned every
 *     journey source for `INIT-…` fixture literals and failed if one was not
 *     covered. The journey harness was retired and those sources no longer
 *     exist, so the ratchet had no subject and went with them — a door that
 *     scans a deleted tree passes vacuously, which is worse than absent.
 *     `journey-residue.mjs` itself SURVIVES and is live: `scripts/stories/`
 *     consumes it in `queue-claim.mjs` and `sweep.mjs`. Everything below doors
 *     the module's OWN rules against temp-dir fixtures and is unaffected by the
 *     retirement, which is why this file was rewritten rather than deleted.
 *
 *  2. CONTAINMENT + reach. The sweep runs before `assertNoLiveDaemon`, so if it
 *     ever removed a manifest it does not own it would be deleting an
 *     operator's real work AND blinding the guard that exists to protect it.
 *     Every "must NOT sweep" case below is therefore load-bearing, not padding.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  sweepJourneyResidue,
  isJourneyOwnedQueueFile,
  isJourneyOwnedLogDir,
  JOURNEY_INIT_SLUGS,
  JOURNEY_UNDATED_INITS,
  DELIBERATELY_UNSWEPT_SLUGS,
  UNTOKENED_SWEPT_SLUGS,
  QUEUE_STATES,
  JOURNEY_AGENT_RUN_SUFFIX,
  JOURNEY_AGENT_RUN_IDS,
} from './lib/journey-residue.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'journey-residue-'));
  for (const q of QUEUE_STATES) mkdirSync(join(root, '_queue', q), { recursive: true });
  mkdirSync(join(root, '_logs'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// 1. THE RATCHET — the slug list must cover every fixture literal in the source
// ---------------------------------------------------------------------------

describe('the sweep list cannot rot', () => {
  test('a REAL standalone agent run is never swept — the suffix, not the `_agent-` prefix, is what declares ownership', () => {
    // The containment half. `_agent-<slug>-<ISO stamp>` is what a real
    // `forge agent dispatch` writes; sweeping one would delete an operator's
    // own run log at the top of every journey run.
    for (const real of [
      '_agent-architect-2026-08-27T10-00-00-000',
      '_agent-onboarding-agent-2026-08-01T00-00-00-000',
      '_agent-developer-ralph-2026-08-28T09-15-00-000',
    ]) {
      assert.equal(isJourneyOwnedLogDir(real), false, `${real} is a REAL run dir and must never be swept`);
    }
    for (const owned of [`_agent-developer-ralph-2026-08-28T01-09-17Z${JOURNEY_AGENT_RUN_SUFFIX}`, ...JOURNEY_AGENT_RUN_IDS]) {
      assert.equal(isJourneyOwnedLogDir(owned), true, `${owned} is harness residue and must be swept`);
    }
  });

  test('every DELIBERATELY_UNSWEPT_SLUGS entry carries a real written reason — an exclusion list with blank reasons is just a hole', () => {
    for (const [slug, reason] of Object.entries(DELIBERATELY_UNSWEPT_SLUGS)) {
      assert.ok(typeof reason === 'string' && reason.length > 80,
        `DELIBERATELY_UNSWEPT_SLUGS["${slug}"] must state WHY leaving it unswept is safe (got ${reason?.length ?? 0} chars)`);
    }
    for (const [slug, reason] of Object.entries(UNTOKENED_SWEPT_SLUGS)) {
      assert.ok(typeof reason === 'string' && reason.length > 80,
        `UNTOKENED_SWEPT_SLUGS["${slug}"] must state why the collision risk is accepted (got ${reason?.length ?? 0} chars)`);
      assert.ok(JOURNEY_INIT_SLUGS.includes(slug), `${slug} is listed as an untokened SWEPT slug but is not actually swept`);
    }
  });

  test('every swept DATED slug carries an "e2e"/"fixture" token, or is an explicitly justified exception — a slug a real title could slugify into must never be swept', () => {
    // Real ids are INIT-<YYYY-MM-DD>-slugify(title) (orchestrator/architect-runner.ts:1359).
    // A harness slug indistinguishable from a real slugify output is deletable
    // real work — that is exactly how `r4-12-ledger-nav` got caught.
    const untokened = JOURNEY_INIT_SLUGS
      .filter((s) => !s.includes('e2e') && !s.includes('fixture'))
      .filter((s) => !(s in UNTOKENED_SWEPT_SLUGS));
    assert.deepEqual(untokened, [],
      `these swept slugs carry no harness-only token and no written exception, so a real initiative title could slugify into them and the sweep would silently delete an operator's manifest: ${untokened.join(', ')}`);
  });

  test('the undated harness ids cannot collide with a real id at all — real ids always carry a YYYY-MM-DD component', () => {
    for (const id of JOURNEY_UNDATED_INITS) {
      assert.ok(!/^INIT-\d{4}-\d{2}-\d{2}-/.test(id),
        `${id} is listed as UNDATED but carries a date stamp — it would then be indistinguishable from a real initiative id and must not be swept by name`);
    }
  });
});

// ---------------------------------------------------------------------------
// 1b. REGRESSION — the exact hostile-review S1. Keep this test forever.
// ---------------------------------------------------------------------------

describe('regression: the r4-12-ledger-nav collision (hostile-review S1)', () => {
  test('a real operator initiative titled "R4-12 Ledger Nav" is NOT swept — before the sweep existed its manifest made the guard REFUSE, so deleting it would turn a loud refusal into silent data loss', () => {
    const root = makeRoot();
    try {
      // slugify("R4-12 Ledger Nav") === 'r4-12-ledger-nav'
      // (orchestrator/architect-runner.ts:1379 — lowercase, non-alnum runs -> '-')
      const real = join(root, '_queue', 'in-flight', 'INIT-2026-08-24-r4-12-ledger-nav.md');
      writeFileSync(real, 'real in-flight operator work\n');
      const realLog = join(root, '_logs', '2026-08-24T13-00-00Z_INIT-2026-08-24-r4-12-ledger-nav');
      mkdirSync(realLog, { recursive: true });

      const { removed } = sweepJourneyResidue(root);

      assert.ok(existsSync(real), 'the real operator manifest must survive');
      assert.ok(existsSync(realLog), 'the real cycle log dir must survive');
      assert.deepEqual(removed, [], 'nothing may be removed');
      assert.equal(isJourneyOwnedQueueFile('INIT-2026-08-24-r4-12-ledger-nav.md'), false);
      assert.equal(isJourneyOwnedLogDir('2026-08-24T13-00-00Z_INIT-2026-08-24-r4-12-ledger-nav'), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a _logs/ dir that merely MENTIONS journey-scratch-kb mid-name is not owned — the rule is a prefix, not a substring', () => {
    assert.equal(isJourneyOwnedLogDir('2026-08-01T00-00-00_INIT-2026-08-01-journey-scratch-kb-audit'), false);
    assert.equal(isJourneyOwnedLogDir('journey-scratch-kb-ingest-activity'), true);
    assert.equal(isJourneyOwnedLogDir('_brainfix-journey-scratch-kb-maintain-consolidate-msmxvvg9'), true);
  });
});

// ---------------------------------------------------------------------------
// 2. CONTAINMENT — it must never remove anything it does not own
// ---------------------------------------------------------------------------

describe('containment: the sweep only removes harness-owned residue', () => {
  test('an operator\'s real queue manifest is left untouched — the sweep narrows what the daemon guard must complain about, it never blinds it', () => {
    const root = makeRoot();
    try {
      const real = join(root, '_queue', 'in-flight', 'INIT-2026-08-24-ship-the-billing-api.md');
      writeFileSync(real, 'real operator work\n');
      const realUndated = join(root, '_queue', 'pending', 'INIT-customer-escalation.md');
      writeFileSync(realUndated, 'real operator work\n');

      const { removed } = sweepJourneyResidue(root);

      assert.ok(existsSync(real), 'a real dated operator manifest must survive the sweep');
      assert.ok(existsSync(realUndated), 'a real undated operator manifest must survive the sweep');
      assert.deepEqual(removed, [], 'nothing was harness-owned, so nothing may be removed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a slug that merely CONTAINS a harness slug is not owned — the id match is anchored at both ends', () => {
    assert.equal(isJourneyOwnedQueueFile('INIT-2026-08-24-e2e-studio-demo.md'), true, 'exact harness slug is owned');
    assert.equal(isJourneyOwnedQueueFile('INIT-2026-08-24-e2e-studio-demo-for-real-customer.md'), false, 'a LONGER slug that starts with a harness slug is a different initiative and must NOT be swept');
    assert.equal(isJourneyOwnedQueueFile('INIT-2026-08-24-not-e2e-studio-demo.md'), false, 'a slug that merely ends with a harness slug must NOT be swept');
    assert.equal(isJourneyOwnedQueueFile('INIT-not-a-date-e2e-studio-demo.md'), false, 'the date stamp shape is required');
    assert.equal(isJourneyOwnedQueueFile('README.md'), false);
  });

  test('a real cycle log directory is left untouched; only harness-owned _logs/ dirs go', () => {
    assert.equal(isJourneyOwnedLogDir('2026-05-30T13-48-23_INIT-2026-05-30-betterado-forge-onboarding'), false, 'a real archived cycle log must never be swept');
    assert.equal(isJourneyOwnedLogDir('_authoring-2026-08-15T08-54-57-86aa5f59'), false, 'a real authoring session log is not this harness\'s to remove');
    assert.equal(isJourneyOwnedLogDir('2026-08-24T12-55-44Z_INIT-2026-08-24-monitor-fixture-active'), true, 'the emulated cycle log a killed run leaves IS owned');
    assert.equal(isJourneyOwnedLogDir('_brainfix-journey-scratch-kb-cleanup-consolidate-mt33royi'), true, 'the scratch-KB consolidate run dirs ARE owned');
    assert.equal(isJourneyOwnedLogDir('journey-scratch-kb-ingest-activity'), true, 'the ingest-activity fixture cycle IS owned');
  });

  test('a _logs/ FILE that happens to match is not removed — the sweep only ever removes directories', () => {
    const root = makeRoot();
    try {
      const f = join(root, '_logs', 'journey-scratch-kb-ingest-activity');
      writeFileSync(f, 'not a directory\n');
      const { removed, failed } = sweepJourneyResidue(root);
      assert.ok(existsSync(f), 'a plain file under _logs/ must not be removed by a directory sweep');
      assert.deepEqual(removed, []);
      assert.deepEqual(failed, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// 3. REACH — it must remove the residue actually measured after a real SIGKILL
// ---------------------------------------------------------------------------

describe('reach: the sweep clears exactly what a killed run leaves', () => {
  test('the residue measured after SIGKILLing a real run at beat 6 is fully cleared', () => {
    const root = makeRoot();
    try {
      // Verbatim from the 2026-08-24 kill repro.
      const inflight = join(root, '_queue', 'in-flight', 'INIT-2026-08-24-monitor-fixture-active.md');
      const failedQ = join(root, '_queue', 'failed', 'INIT-2026-08-24-monitor-fixture-failed.md');
      const cycleLog = join(root, '_logs', '2026-08-24T12-55-44Z_INIT-2026-08-24-monitor-fixture-active');
      writeFileSync(inflight, '---\n');
      writeFileSync(failedQ, '---\n');
      mkdirSync(cycleLog, { recursive: true });
      writeFileSync(join(cycleLog, 'events.jsonl'), '{}\n');

      const { removed, failed } = sweepJourneyResidue(root);

      assert.ok(!existsSync(inflight), 'the in-flight stray that makes assertNoLiveDaemon refuse EVERY later run must be gone');
      assert.ok(!existsSync(failedQ), 'the failed-state fixture manifest must be gone');
      assert.ok(!existsSync(cycleLog), 'the emulated cycle log dir must be gone');
      assert.deepEqual(failed, [], 'no cleanup step may fail silently');
      assert.equal(removed.length, 3, `the sweep must report exactly what it removed, got ${JSON.stringify(removed)}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('residue from a run killed on an EARLIER DATE is cleared — the per-id cleanups it backstops are date-stamped and never could', () => {
    const root = makeRoot();
    try {
      const yesterday = join(root, '_queue', 'in-flight', 'INIT-2020-01-01-monitor-fixture-active.md');
      writeFileSync(yesterday, '---\n');
      const { removed } = sweepJourneyResidue(root);
      assert.ok(!existsSync(yesterday), 'residue from any date must be swept: an id-and-date-scoped cleanup can only ever reach TODAY\'s residue, which is why stale residue blocked the guard permanently');
      assert.deepEqual(removed, ['_queue/in-flight/INIT-2020-01-01-monitor-fixture-active.md']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the sidecar filename shapes the harness also writes are swept', () => {
    const root = makeRoot();
    try {
      const paths = [
        join(root, '_queue', 'done', 'INIT-2026-08-24-e2e-toc-write-mode.verdict-response.md'),
        join(root, '_queue', 'pending', 'INIT-2026-08-24-e2e-toc-write-mode-e2e-develop-trigger.md'),
        join(root, '_queue', 'done', 'INIT-r6-06-agent-ledger-flow-node.md'),
      ];
      for (const p of paths) writeFileSync(p, '---\n');
      sweepJourneyResidue(root);
      for (const p of paths) assert.ok(!existsSync(p), `sidecar manifest must be swept: ${p}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the scratch-KB _logs/ dirs that accumulate unboundedly across runs are swept', () => {
    const root = makeRoot();
    try {
      // 17+ of these were found never-cleaned in the real checkout; they are
      // what makes the ingest-activity scan slow enough to time the beat out.
      const dirs = [
        '_brainfix-journey-scratch-kb-cleanup-consolidate-mt33royi',
        '_brainfix-journey-scratch-kb-maintain-consolidate-msmxvvg9',
        'journey-scratch-kb-ingest-activity',
      ];
      for (const d of dirs) {
        mkdirSync(join(root, '_logs', d), { recursive: true });
        writeFileSync(join(root, '_logs', d, 'events.jsonl'), '{}\n');
      }
      const keep = join(root, '_logs', '2026-08-01T00-00-00_INIT-2026-08-01-real-work');
      mkdirSync(keep, { recursive: true });

      sweepJourneyResidue(root);

      for (const d of dirs) assert.ok(!existsSync(join(root, '_logs', d)), `harness scratch-KB log dir must be swept: ${d}`);
      assert.ok(existsSync(keep), 'a real cycle log must survive');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a missing _queue/ or _logs/ is not an error — a first-ever run must sweep cleanly', () => {
    const root = mkdtempSync(join(tmpdir(), 'journey-residue-bare-'));
    try {
      const { removed, failed } = sweepJourneyResidue(root);
      assert.deepEqual(removed, []);
      assert.deepEqual(failed, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
