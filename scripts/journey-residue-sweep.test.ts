/**
 * W8-C2b (beads forge-6lk + forge-yuq) — the crash-safe leading sweep.
 *
 * Two jobs, and the FIRST is the one that keeps this fix alive:
 *
 *  1. A RATCHET over the journey sources. `sweepJourneyResidue` recognises the
 *     harness's own residue by initiative-id SLUG, and an enumerated list rots
 *     the moment someone adds a fixture. This test scans every journey source
 *     for `INIT-…` fixture literals and FAILS if one is not covered — so a new
 *     fixture cannot silently reopen the leak this WI closed.
 *
 *  2. CONTAINMENT + reach. The sweep runs before `assertNoLiveDaemon`, so if it
 *     ever removed a manifest it does not own it would be deleting an
 *     operator's real work AND blinding the guard that exists to protect it.
 *     Every "must NOT sweep" case below is therefore load-bearing, not padding.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  sweepJourneyResidue,
  isJourneyOwnedQueueFile,
  isJourneyOwnedLogDir,
  JOURNEY_INIT_SLUGS,
  JOURNEY_UNDATED_INITS,
  QUEUE_STATES,
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
  test('every INIT-… fixture literal in the journey sources is covered by JOURNEY_INIT_SLUGS / JOURNEY_UNDATED_INITS', () => {
    const journeysDir = join(SCRIPTS_DIR, 'journeys');
    const sources = [
      ...readdirSync(journeysDir).filter((f) => f.endsWith('.mjs')).map((f) => join(journeysDir, f)),
      join(SCRIPTS_DIR, 'lib', 'journey-fixtures.mjs'),
    ];
    assert.ok(sources.length > 10, `fixture precondition: expected to scan the real journey sources, found ${sources.length}`);

    const missing: string[] = [];
    let found = 0;
    for (const file of sources) {
      const src = readFileSync(file, 'utf8');
      // `INIT-${SOME_DATE_CONST}-<slug>` — the dated fixture-id shape.
      for (const m of src.matchAll(/`INIT-\$\{[A-Za-z_][A-Za-z0-9_]*\}-([a-z0-9][a-z0-9-]*)`/g)) {
        found++;
        if (!JOURNEY_INIT_SLUGS.includes(m[1])) missing.push(`${file.replace(SCRIPTS_DIR, 'scripts')}: slug "${m[1]}"`);
      }
      // 'INIT-<something>' — an undated fixture id written as a plain literal.
      for (const m of src.matchAll(/'(INIT-[a-z0-9][a-z0-9-]*)'/g)) {
        found++;
        if (!JOURNEY_UNDATED_INITS.includes(m[1])) missing.push(`${file.replace(SCRIPTS_DIR, 'scripts')}: undated id "${m[1]}"`);
      }
    }

    assert.ok(found >= 15, `fixture precondition: the scan must actually find fixture literals (found ${found}) — a regex that matches nothing would make this ratchet vacuously green`);
    assert.deepEqual(
      missing,
      [],
      `these journey fixture ids are NOT covered by the leading sweep, so a killed run would leave them behind and assertNoLiveDaemon would refuse every later run — add the slug to JOURNEY_INIT_SLUGS in scripts/lib/journey-residue.mjs:\n  ${missing.join('\n  ')}`,
    );
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
