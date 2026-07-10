/**
 * G4 (plan item 2.2) — unifier fix-loop cap + `uwi.gate-failed` restart event.
 *
 * Evidence: brain/cycles/themes/2026-07-04-unifier-uwi-restart-loop-no-gate-
 * failure-event.md (16 unifier restarts, zero diagnostic events between them)
 * and 2026-07-04-unifier-incomplete-delivery-loop-cap-missing.md (16 resume
 * spins against a gate the unifier could not clear; $84.56 single-cycle burn).
 *
 * Two seams under test:
 *   1. `composedUnifierGate` reports every failing evaluation through the new
 *      `onGateFailure` callback — which sub-check failed + exit code + output
 *      tail — so the caller can make the previously-invisible restart visible.
 *   2. `createUwiGateFailureTracker` emits one `uwi.gate-failed` event per
 *      failing evaluation and a single terminal `uwi.loop-cap-exhausted`
 *      (event_type: error) once the SAME sub-check has failed `cap`
 *      consecutive times; `capExhausted()` then stops the Ralph loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composedUnifierGate,
  createUwiGateFailureTracker,
  type UnifierGateFailure,
} from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

function loggerHarness(): {
  dir: string;
  logger: ReturnType<typeof createLogger>;
  events: () => EventLogEntry[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-uwi-gf-'));
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-uwi-gf', logsDir);
  return {
    dir,
    logger,
    events: () =>
      readFileSync(logger.logFilePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EventLogEntry),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const INITIATIVE_ID = 'INIT-uwi-gf';

// ---------------------------------------------------------------------------
// composedUnifierGate → onGateFailure
// ---------------------------------------------------------------------------

test('composedUnifierGate: initiative-gate failure reports checkId + exit code + output tail via onGateFailure', async () => {
  const h = loggerHarness();
  try {
    const failures: UnifierGateFailure[] = [];
    const passed = await composedUnifierGate({
      worktreePath: h.dir,
      initiativeId: INITIATIVE_ID,
      qualityGateCmd: ['sh', '-c', 'echo boom >&2; exit 3'],
      logger: h.logger,
      initiativeIdForEvent: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemsDir: join(h.dir, '.forge', 'work-items'),
      demoDir: `demo/${INITIATIVE_ID}`,
      onGateFailure: (f) => failures.push(f),
    });
    assert.equal(passed, false);
    assert.equal(failures.length, 1, 'exactly one failing evaluation reported');
    assert.equal(failures[0]!.checkId, 'initiative_gate');
    assert.equal(failures[0]!.exitCode, 3, 'the real gate-command exit code');
    assert.match(failures[0]!.outputTail, /boom/, 'the gate stderr tail');
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate: pr_self_contained failure reports null exit code + demo.json detail', async () => {
  const h = loggerHarness();
  try {
    const failures: UnifierGateFailure[] = [];
    const passed = await composedUnifierGate({
      worktreePath: h.dir,
      initiativeId: INITIATIVE_ID,
      qualityGateCmd: ['true'], // initiative gate passes → falls to check 2
      logger: h.logger,
      initiativeIdForEvent: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemsDir: join(h.dir, '.forge', 'work-items'),
      demoDir: `demo/${INITIATIVE_ID}`, // demo.json never written
      onGateFailure: (f) => failures.push(f),
    });
    assert.equal(passed, false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.checkId, 'pr_self_contained');
    assert.equal(failures[0]!.exitCode, null, 'structural checks carry no exit code');
    assert.match(failures[0]!.outputTail, /demo\.json/);
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate: onGateFailure is NOT called when all sub-checks pass', async () => {
  // Full git harness (bare remote) so branches_in_sync passes.
  const dir = mkdtempSync(join(tmpdir(), 'forge-uwi-gf-pass-'));
  try {
    const remoteDir = join(dir, 'remote.git');
    mkdirSync(remoteDir, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', remoteDir], { stdio: 'pipe' });
    const wt = join(dir, 'wt');
    execFileSync('git', ['clone', remoteDir, wt], { stdio: 'pipe' });
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
    git('config', 'user.email', 'test@forge.test');
    git('config', 'user.name', 'forge-test');
    writeFileSync(join(wt, 'README.md'), '# base\n');
    git('add', 'README.md');
    git('commit', '-m', 'base');
    git('push', 'origin', 'main');
    git('checkout', '-b', 'forge/init-test');
    git('push', '--set-upstream', 'origin', 'forge/init-test');

    // Valid demo.json + pr-description.md; no WIs → complete_delivery exempt.
    const demoDir = join(wt, 'demo', INITIATIVE_ID);
    mkdirSync(demoDir, { recursive: true });
    writeFileSync(
      join(demoDir, 'demo.json'),
      JSON.stringify({
        title: 'Test demo',
        essence: 'Proves the pass path never fires onGateFailure.',
        project: 'test-project',
        diffStat: '1 file changed, 1 insertion(+)',
        checkpoints: [{ label: 'Gate passes', caption: 'All sub-checks pass.' }],
      }),
    );
    const forgeDir = join(wt, '.forge');
    mkdirSync(join(forgeDir, 'work-items'), { recursive: true });
    writeFileSync(
      join(forgeDir, 'pr-description.md'),
      [
        '## Why',
        '',
        'We needed the change to satisfy the initiative acceptance criteria end to end.',
        '',
        '## What',
        '',
        '- Implemented the module with tests.',
        '',
        '## How',
        '',
        'Follows the established project patterns for this codebase.',
        '',
      ].join('\n'),
    );
    git('add', '-A');
    git('commit', '-m', 'feat: demo + pr-description');
    git('push', 'origin', 'forge/init-test');

    const logsDir = join(dir, '_logs');
    mkdirSync(logsDir, { recursive: true });
    const logger = createLogger('TEST-uwi-gf-pass', logsDir);

    const failures: UnifierGateFailure[] = [];
    const passed = await composedUnifierGate({
      worktreePath: wt,
      initiativeId: INITIATIVE_ID,
      qualityGateCmd: ['true'],
      logger,
      initiativeIdForEvent: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemsDir: join(forgeDir, 'work-items'),
      demoDir: `demo/${INITIATIVE_ID}`,
      onGateFailure: (f) => failures.push(f),
    });
    assert.equal(passed, true, 'gate should pass');
    assert.equal(failures.length, 0, 'no failing evaluation → no callback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// createUwiGateFailureTracker — uwi.gate-failed + uwi.loop-cap-exhausted
// ---------------------------------------------------------------------------

test('tracker: emits one uwi.gate-failed per failing evaluation with gate identity + evidence', () => {
  const h = loggerHarness();
  try {
    const tracker = createUwiGateFailureTracker({
      logger: h.logger,
      initiativeId: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemId: 'UWI-1',
      cap: 4,
    });
    tracker.onGateFailure({ checkId: 'initiative_gate', exitCode: 2, outputTail: 'FAIL: TestX' });

    const evts = h.events().filter((e) => e.message === 'uwi.gate-failed');
    assert.equal(evts.length, 1);
    const md = evts[0]!.metadata as Record<string, unknown>;
    assert.equal(evts[0]!.phase, 'unifier');
    assert.equal(evts[0]!.skill, 'developer-unifier');
    assert.equal(md.work_item_id, 'UWI-1');
    assert.equal(md.check_id, 'initiative_gate');
    assert.equal(md.gate_exit_code, 2);
    assert.match(String(md.gate_output_tail), /TestX/);
    assert.equal(md.consecutive_failures, 1);
    assert.equal(md.failure_cap, 4);
    assert.equal(tracker.capExhausted(), false);
  } finally {
    h.cleanup();
  }
});

test('tracker: a DIFFERENT failing sub-check resets the consecutive counter', () => {
  const h = loggerHarness();
  try {
    const tracker = createUwiGateFailureTracker({
      logger: h.logger,
      initiativeId: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemId: 'UWI-1',
      cap: 2,
    });
    tracker.onGateFailure({ checkId: 'initiative_gate', exitCode: 1, outputTail: 'a' });
    tracker.onGateFailure({ checkId: 'pr_self_contained', exitCode: null, outputTail: 'b' });
    // Two failures, but of different checks → counter is 1, cap (2) NOT hit.
    assert.equal(tracker.capExhausted(), false);
    const caps = h.events().filter((e) => e.message === 'uwi.loop-cap-exhausted');
    assert.equal(caps.length, 0);
  } finally {
    h.cleanup();
  }
});

test('tracker: cap consecutive SAME-check failures → single terminal uwi.loop-cap-exhausted error event', () => {
  const h = loggerHarness();
  try {
    const tracker = createUwiGateFailureTracker({
      logger: h.logger,
      initiativeId: INITIATIVE_ID,
      parentEventId: 'parent-1',
      workItemId: 'UWI-1',
      cap: 3,
    });
    tracker.onGateFailure({ checkId: 'complete_delivery', exitCode: null, outputTail: 'missing: a.go' });
    tracker.onGateFailure({ checkId: 'complete_delivery', exitCode: null, outputTail: 'missing: a.go' });
    assert.equal(tracker.capExhausted(), false, 'below cap → keep iterating');
    tracker.onGateFailure({ checkId: 'complete_delivery', exitCode: null, outputTail: 'missing: a.go' });
    assert.equal(tracker.capExhausted(), true, '3rd consecutive same-check failure hits cap 3');

    const caps = h.events().filter((e) => e.message === 'uwi.loop-cap-exhausted');
    assert.equal(caps.length, 1);
    assert.equal(caps[0]!.event_type, 'error', 'the cap event is terminal');
    const md = caps[0]!.metadata as Record<string, unknown>;
    assert.equal(md.failure_class, 'dev-loop-unifier-loop-cap-exhausted');
    assert.equal(md.check_id, 'complete_delivery');
    assert.equal(md.consecutive_failures, 3);
    assert.equal(md.failure_cap, 3);

    // Further failures never re-emit the terminal event.
    tracker.onGateFailure({ checkId: 'complete_delivery', exitCode: null, outputTail: 'missing: a.go' });
    assert.equal(
      h.events().filter((e) => e.message === 'uwi.loop-cap-exhausted').length,
      1,
      'terminal event emitted exactly once',
    );
  } finally {
    h.cleanup();
  }
});
