/**
 * scheduler-preflight.test.ts — refuse a run whose cost ceiling would bind
 * nothing because a scheduler is already up.
 *
 * GAP `forge-8vfn.8.1.6` follow-up. `spawnServeDetached`
 * (`packages/flows/daemon.ts`) starts nothing new while a scheduler pid is
 * already alive, so a LEFTOVER `forge serve` daemon from an earlier run keeps
 * its own, already-fixed env — this run's `--ceiling` would bind nothing, and
 * the beat that presses Start would still succeed (it just starts nothing
 * new), so nothing about the run's own transcript would say so.
 *
 * Fixture shapes (real pid, no fixture door) mirror `sweep-teardown.test.ts`'s
 * `657(ii)` tests exactly: `process.pid` stands in for a genuinely live pid,
 * `'999999'` for a certainly-dead one — same file, same product pid file
 * (`DAEMON_PID_FILE`), so this door and that one can never disagree about
 * which path they mean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { preexistingSchedulerVerdict } from './scheduler-preflight.mjs';
import { DAEMON_PID_FILE } from './sweep-teardown.mjs';
import { runnerSourceContaining } from './runner-source.mjs';

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'forge-sched-preflight-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  return root;
}

test('a LIVE scheduler pid REFUSES, naming the pid and why', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, DAEMON_PID_FILE), String(process.pid));

  const v = preexistingSchedulerVerdict(root);

  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(String(process.pid)));
  assert.match(v.reason, /cost ceiling/);
});

test('a DEAD scheduler pid does NOT refuse — stale, and it says so', () => {
  const root = fixtureRoot();
  // Real in shape, certainly not running — same stand-in `stopOwnScheduler`'s
  // own 657(ii) tests use for "dead".
  writeFileSync(join(root, DAEMON_PID_FILE), '999999');

  const v = preexistingSchedulerVerdict(root);

  assert.equal(v.ok, true);
  assert.match(v.reason, /stale/);
});

test('no pid file at all does NOT refuse', () => {
  const root = fixtureRoot();

  const v = preexistingSchedulerVerdict(root);

  assert.equal(v.ok, true);
  assert.match(v.reason, new RegExp(DAEMON_PID_FILE.replace(/[/\\]/g, '.')));
});

test('a pid file holding nonsense does NOT refuse — treated as none, not signalled', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, DAEMON_PID_FILE), 'not-a-pid');

  const v = preexistingSchedulerVerdict(root);

  assert.equal(v.ok, true);
  assert.match(v.reason, /not a pid/);
});

test('(wiring) the refusal actually runs, ahead of the bridge boot call site it protects', () => {
  const { source } = runnerSourceContaining('preexistingSchedulerVerdict(ROOT');
  const checkAt = source.indexOf('preexistingSchedulerVerdict(ROOT');
  const bootAt = source.indexOf('bridgeSpawnOptions(ROOT');
  assert.ok(checkAt !== -1, 'the call site must exist');
  assert.ok(bootAt !== -1, 'the boot call site must exist');
  assert.ok(checkAt < bootAt, 'the refusal must run BEFORE the bridge boots, not after');
});
