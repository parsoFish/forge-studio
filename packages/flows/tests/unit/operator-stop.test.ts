/**
 * M7 row 150 (bead forge-8vfn.8.1.39, rulings 1771 + 1774) — the shared
 * primitives `operator-stop.ts` exports: the flag file's path/read (presence-
 * based, mirroring `daemon.ts`'s `.paused`), `OperatorStopError`'s message
 * signature (`failure-classifier.ts` scans for the literal `operator-stop:`
 * prefix), `describeNodeAbort` (the wedge-kill/operator-stop message
 * disambiguator `developer-loop.ts` uses at both its abort sites), and
 * `appendOperatorStopEvents` (the GATED-run half `bridge-recovery.ts` uses,
 * with no live runner to emit the event itself).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OPERATOR_STOP_REASON,
  OperatorStopError,
  appendOperatorStopEvents,
  describeNodeAbort,
  operatorStopFilename,
  operatorStopPath,
  readOperatorStopRequest,
} from '../../operator-stop.ts';
import { WedgeKillError } from '../../flow-budgets.ts';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'forge-operator-stop-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('operatorStopFilename / operatorStopPath: the flag file is <id>.stop, a sibling of the manifest', () => {
  assert.equal(operatorStopFilename('INIT-x'), 'INIT-x.stop');
  assert.equal(operatorStopPath('/a/b/in-flight', 'INIT-x'), join('/a/b/in-flight', 'INIT-x.stop'));
});

test('readOperatorStopRequest: absent file → null', () => {
  withTmpDir((dir) => {
    assert.equal(readOperatorStopRequest(dir, 'INIT-x'), null);
  });
});

test('readOperatorStopRequest: presence is the signal — a well-formed flag is read back verbatim', () => {
  withTmpDir((dir) => {
    const body = { reason: OPERATOR_STOP_REASON, ts: '2026-09-27T12:00:00.000Z', actor: 'operator' };
    writeFileSync(operatorStopPath(dir, 'INIT-x'), JSON.stringify(body));
    assert.deepEqual(readOperatorStopRequest(dir, 'INIT-x'), body);
  });
});

test(
  'readOperatorStopRequest: a malformed flag still halts — presence, not contents, is ' +
    'authoritative (mirrors daemon.ts .paused)',
  () => {
  withTmpDir((dir) => {
    writeFileSync(operatorStopPath(dir, 'INIT-x'), 'not json at all');
    const got = readOperatorStopRequest(dir, 'INIT-x');
    assert.ok(got !== null, 'a corrupt file must still be read as a stop request');
    assert.equal(got!.reason, OPERATOR_STOP_REASON);
    assert.equal(got!.actor, 'operator');
  });
});

test('OperatorStopError: message carries the operator-stop: prefix failure-classifier.ts scans for', () => {
  const err = new OperatorStopError();
  assert.match(err.message, /^operator-stop:/);
  assert.match(err.message, /resumable/i);
  assert.match(err.message, /worktree and branch are kept/i);
  assert.equal(err.name, 'OperatorStopError');
});

test('describeNodeAbort: an OperatorStopError reason overrides the wedge-kill fallback text', () => {
  const controller = new AbortController();
  controller.abort(new OperatorStopError());
  assert.match(describeNodeAbort(controller.signal, 'wedge-kill: node aborted'), /^operator-stop:/);
});

test(
  'describeNodeAbort: a WedgeKillError reason keeps the caller\'s own fallback text ' +
    '(never mislabelled operator-stop)',
  () => {
  const controller = new AbortController();
  controller.abort(new WedgeKillError('dev', Date.now(), 50, Date.now() + 100));
  assert.equal(describeNodeAbort(controller.signal, 'wedge-kill: node aborted'), 'wedge-kill: node aborted');
});

test('describeNodeAbort: an undefined signal keeps the caller\'s own fallback text', () => {
  assert.equal(describeNodeAbort(undefined, 'wedge-kill: node aborted'), 'wedge-kill: node aborted');
});

test(
  'appendOperatorStopEvents: writes flow.operator-stop + failure_classification to the ' +
    'cycle\'s own events.jsonl',
  () => {
  withTmpDir((logsRoot) => {
    const cycleId = '2026-09-27T08-00-00_INIT-gated-spec';
    appendOperatorStopEvents(logsRoot, cycleId, 'INIT-gated-spec');
    const logPath = join(logsRoot, cycleId, 'events.jsonl');
    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].message, 'flow.operator-stop');
    assert.equal(lines[1].message, 'failure_classification');
    assert.equal(lines[1].metadata.recoverable, false);
    assert.equal(lines[1].metadata.environment, false);
    assert.equal(lines[1].metadata.cleanBoundaryHalt, true);
    assert.match(lines[1].metadata.reason, /^operator-stop:/);
    for (const l of lines) {
      assert.equal(l.cycle_id, cycleId);
      assert.equal(l.initiative_id, 'INIT-gated-spec');
    }
  });
});

test('appendOperatorStopEvents: best-effort — an unwritable logsRoot never throws', () => {
  // A path segment that is a FILE, not a directory, makes mkdirSync fail.
  withTmpDir((dir) => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    assert.doesNotThrow(() => appendOperatorStopEvents(blocker, 'cycle-x', 'INIT-x'));
  });
});
