/**
 * halt-record.test.ts — a story run refuses a ground that is already halted,
 * and its teardown clears a halt the run itself pulled, on every path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HALT_RECORD, clearRunHalt, preexistingHaltVerdict } from './halt-record.mjs';
import { runnerSourceContaining } from './runner-source.mjs';
import { haltPath } from '../../packages/kernel/halt.ts';

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-halt-record-'));
  mkdirSync(join(root, '_queue'), { recursive: true });
  return root;
}

test('HALT_RECORD is the product\'s own halt path, not a copy that could drift', () => {
  const root = fixtureRoot();
  assert.equal(join(root, HALT_RECORD), haltPath(join(root, '_queue')));
});

test('no halt record → the run proceeds', () => {
  const v = preexistingHaltVerdict(fixtureRoot());
  assert.equal(v.ok, true);
});

test('a halt record that exists before the run REFUSES, naming since and how to release', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, HALT_RECORD), JSON.stringify({ since: '2026-10-04T09:00:00.000Z', actor: 'operator' }));
  const v = preexistingHaltVerdict(root);
  assert.equal(v.ok, false);
  assert.match(v.reason, /since 2026-10-04T09:00:00\.000Z/);
  assert.match(v.reason, /Release halt/);
});

test('an unreadable halt record refuses too — the product reads it as halted', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, HALT_RECORD), '{not json');
  assert.equal(preexistingHaltVerdict(root).ok, false);
});

test('the teardown clears a halt the run left and says so', () => {
  const root = fixtureRoot();
  writeFileSync(join(root, HALT_RECORD), JSON.stringify({ since: '2026-10-04T09:00:00.000Z', actor: 'operator' }));
  const c = clearRunHalt(root);
  assert.equal(c.ok, true);
  assert.equal(existsSync(join(root, HALT_RECORD)), false);
  assert.match(c.lines.join('\n'), /cleared the emergency halt this run left/);
});

test('the teardown with no halt record is a silent no-op', () => {
  const c = clearRunHalt(fixtureRoot());
  assert.equal(c.ok, true);
  assert.deepEqual([...c.lines], []);
});

test('the runner refuses a halted ground BEFORE the bridge boots', () => {
  const { source } = runnerSourceContaining('preexistingHaltVerdict(ROOT');
  const checkAt = source.indexOf('preexistingHaltVerdict(ROOT');
  const bootAt = source.indexOf('bridgeSpawnOptions(ROOT');
  assert.ok(checkAt !== -1 && bootAt !== -1, 'both call sites must exist');
  assert.ok(checkAt < bootAt, 'the refusal must run before the bridge boots');
});

test('the runner clears a run\'s halt in the finally AFTER studio and serve are stopped, and on the stop path', () => {
  const { source } = runnerSourceContaining('clearRunHalt(ROOT');
  const stopAt = source.indexOf('stopStudioThenScheduler(ROOT');
  const finallyClearAt = source.indexOf('clearRunHalt(ROOT', stopAt);
  assert.ok(stopAt !== -1 && finallyClearAt !== -1, 'the finally must clear after stopping studio + serve');
  const stopPathAt = source.indexOf('const clear = () =>');
  const stopPathClearAt = source.indexOf('clearRunHalt(ROOT', stopPathAt);
  assert.ok(stopPathAt !== -1 && stopPathClearAt !== -1 && stopPathClearAt < stopAt,
    'the operator-stop path must clear it too');
});

test('a halt the teardown could not clear fails the run', () => {
  const { source } = runnerSourceContaining('clearRunHalt(ROOT');
  assert.match(source, /if \(!haltClear\.ok\) exitCode = exitCode \|\| 1/);
});
