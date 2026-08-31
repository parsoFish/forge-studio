/**
 * W7-B7 pins — artifact-plan-11 (verdict presence) + artifact-plan-17 (prUrl).
 *
 * artifact-plan-11: `deriveArtifacts` decided verdict presence ONLY from
 * `_queue/<state>/<initiativeId>.verdict-response.md` — a file nothing writes
 * any more — so the verdict trail chip read "Not yet produced" on every run,
 * including merged ones whose `_logs/<cycle>/artifacts/verdict.json` the same
 * page renders as the approved stamp. The fix detects the cycle's own
 * artifacts/verdict.json FIRST (the file `writeVerdictJson` actually writes),
 * keeping the legacy queue-file check as a fallback for frozen logs.
 *
 * artifact-plan-17: the PR artifact page had no link to the actual pull
 * request — the run model never carried the URL even though the cycle's own
 * `reviewer.pr-opened` event records it verbatim. `findPrUrl` derives it
 * (derive-don't-store) from the event log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveArtifacts, findPrUrl } from './run-model-derive.ts';
import type { EventLogEntry, Phase } from './logging.ts';

// ---------------------------------------------------------------------------
// deriveArtifacts — verdict presence
// ---------------------------------------------------------------------------

function makeRoot(): { root: string; logDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'b7-derive-'));
  const logDir = join(root, '_logs', '2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag');
  mkdirSync(join(logDir, 'artifacts'), { recursive: true });
  for (const state of ['done', 'merged', 'failed', 'ready-for-review', 'pending', 'in-flight']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  return { root, logDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const INIT = 'INIT-2026-07-11-cli-sort-flag';

test('deriveArtifacts: artifacts/verdict.json ⇒ verdict present (view) — the file writeVerdictJson actually writes', () => {
  const { root, logDir, cleanup } = makeRoot();
  try {
    writeFileSync(
      join(logDir, 'artifacts', 'verdict.json'),
      JSON.stringify({ kind: 'approve', initiative_id: INIT, decidedBy: 'operator', rationale: 'ok' }),
    );
    const artifacts = deriveArtifacts(logDir, root, 'complete', INIT);
    assert.equal(artifacts['verdict'], 'view');
  } finally {
    cleanup();
  }
});

test('deriveArtifacts: legacy _queue/<state>/<init>.verdict-response.md still detected (frozen-log fallback)', () => {
  const { root, logDir, cleanup } = makeRoot();
  try {
    writeFileSync(join(root, '_queue', 'done', `${INIT}.verdict-response.md`), 'approved');
    const artifacts = deriveArtifacts(logDir, root, 'complete', INIT);
    assert.equal(artifacts['verdict'], 'view');
  } finally {
    cleanup();
  }
});

test('deriveArtifacts: no verdict.json and no queue file ⇒ verdict honestly absent', () => {
  const { root, logDir, cleanup } = makeRoot();
  try {
    const artifacts = deriveArtifacts(logDir, root, 'gated', INIT);
    assert.equal(artifacts['verdict'], undefined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// findPrUrl — the run's PR link, from its own reviewer.pr-opened event
// ---------------------------------------------------------------------------

let seq = 0;
function ev(message: string | undefined, metadata: Record<string, unknown>): EventLogEntry {
  seq += 1;
  return {
    event_id: `e-${seq}`,
    cycle_id: 'CYCLE-test',
    initiative_id: INIT,
    phase: 'review-loop' as Phase,
    skill: 'review-router',
    event_type: 'log',
    started_at: new Date(1700000000000 + seq * 1000).toISOString(),
    input_refs: [],
    output_refs: [],
    ...(message !== undefined ? { message } : {}),
    metadata,
  } as EventLogEntry;
}

test('findPrUrl: derives the URL from the reviewer.pr-opened event', () => {
  const events = [
    ev('dev-loop.delivered', {}),
    ev('reviewer.pr-opened', { url: 'https://github.com/parsoFish/gitpulse/pull/12', pr_created: true }),
  ];
  assert.equal(findPrUrl(events), 'https://github.com/parsoFish/gitpulse/pull/12');
});

test('findPrUrl: the LATEST pr-opened wins (a re-opened PR after requeue)', () => {
  const events = [
    ev('reviewer.pr-opened', { url: 'https://github.com/parsoFish/gitpulse/pull/12' }),
    ev('reviewer.pr-opened', { url: 'https://github.com/parsoFish/gitpulse/pull/13' }),
  ];
  assert.equal(findPrUrl(events), 'https://github.com/parsoFish/gitpulse/pull/13');
});

test('findPrUrl: honestly absent — no pr-opened event, or a non-string / null url (pr-open-failed writes url:null)', () => {
  assert.equal(findPrUrl([]), undefined);
  assert.equal(findPrUrl([ev('reviewer.pr-open-failed', { url: null, pr_created: false })]), undefined);
  assert.equal(findPrUrl([ev('reviewer.pr-opened', { url: 42 })]), undefined);
  assert.equal(findPrUrl([ev(undefined, { url: 'https://github.com/x/y/pull/1' })]), undefined);
});
