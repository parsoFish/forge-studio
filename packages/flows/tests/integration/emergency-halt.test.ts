/**
 * The one emergency halt (ADR 011) at the queue claim seams: `claim()`, the
 * scheduler tick (`--once` and forever), the drain sweep, and the halt log
 * watcher. The record is `<queueRoot>/halt.json`; kernel and flows read the
 * same file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeHalt, releaseHalt, readHalt } from '@forge/kernel';
import { claim, getPaths, listPending } from '../../queue.ts';
import { serve } from '../../scheduler.ts';
import { runDrainSweep } from '../../scheduler-sweeps.ts';
import { createHaltWatch, HALT_REMINDER_MS } from '../../halt-watch.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';

function mkQueue(): { dir: string; paths: ReturnType<typeof getPaths> } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-halt-q-'));
  const paths = getPaths(join(dir, '_queue'));
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
    mkdirSync(p, { recursive: true });
  }
  return { dir, paths };
}

const MANIFEST = '---\ninitiative_id: INIT-2026-10-04-halt-probe\nproject: nonexistent\ncreated_at: 2026-10-04T00:00:00Z\niteration_budget: 10\ncost_budget_usd: 5\nclass: code\n---\nbody\n';
const WIRING = {} as unknown as PhaseWiring;

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
  return { lines, restore: () => { console.log = log; console.error = err; } };
}

test('claim() refuses under halt: returns null, the pending file stays put', () => {
  const { dir, paths } = mkQueue();
  try {
    writeFileSync(join(paths.pending, 'INIT-x.md'), MANIFEST);
    writeHalt(paths.root, 'operator');
    assert.equal(claim('INIT-x.md', paths), null);
    assert.deepEqual(listPending(paths), ['INIT-x.md']);
    assert.equal(existsSync(join(paths.inFlight, 'INIT-x.md')), false);
    releaseHalt(paths.root);
    assert.ok(claim('INIT-x.md', paths), 'claims again once released');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('halt watch: 3 consecutive halted ticks log once, naming how to release; release logs once', () => {
  const { dir, paths } = mkQueue();
  const lines: string[] = [];
  let t = 0;
  try {
    const watch = createHaltWatch(paths.root, { log: (l) => lines.push(l), now: () => t });
    assert.equal(watch(), false);
    const rec = writeHalt(paths.root, 'operator');
    assert.equal(watch(), true);
    assert.equal(watch(), true);
    assert.equal(watch(), true);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, new RegExp(`^\\[serve\\] emergency halt on since ${rec.since} — claiming nothing`));
    assert.ok(lines[0]!.includes(`release it from Studio (Release halt) or remove ${join(paths.root, 'halt.json')}`));
    t += HALT_REMINDER_MS - 1;
    watch();
    assert.equal(lines.length, 1, 'no reminder before the interval');
    t += 1;
    watch();
    assert.equal(lines.length, 2, 'one reminder per interval');
    releaseHalt(paths.root);
    assert.equal(watch(), false);
    assert.equal(watch(), false);
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '[serve] emergency halt released — claiming again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve --once under halt (non-default queue root): claims nothing, logs once, exits normally', async () => {
  const { dir, paths } = mkQueue();
  const cap = captureLogs();
  try {
    writeFileSync(join(paths.pending, 'INIT-2026-10-04-halt-probe.md'), MANIFEST);
    writeHalt(paths.root, 'operator');
    await serve({ mode: 'once', phaseWiring: WIRING, queueRoot: paths.root, worktreesRoot: join(dir, '_worktrees') });
    cap.restore();
    assert.deepEqual(listPending(paths), ['INIT-2026-10-04-halt-probe.md']);
    assert.equal(cap.lines.filter((l) => l.includes('emergency halt on since')).length, 1);
  } finally {
    cap.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve --once without a halt claims the pending item (control)', async () => {
  const { dir, paths } = mkQueue();
  const cap = captureLogs();
  try {
    writeFileSync(join(paths.pending, 'INIT-2026-10-04-halt-probe.md'), MANIFEST);
    await serve({ mode: 'once', phaseWiring: WIRING, queueRoot: paths.root, worktreesRoot: join(dir, '_worktrees') });
    cap.restore();
    assert.deepEqual(listPending(paths), [], 'claimed (left pending/)');
  } finally {
    cap.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve forever: a pending item stays pending under halt, an in-flight item is untouched, release claims it', async () => {
  const { dir, paths } = mkQueue();
  const cap = captureLogs();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    writeFileSync(join(paths.inFlight, 'INIT-2026-10-04-running.md'), MANIFEST);
    writeFileSync(join(paths.inFlight, 'INIT-2026-10-04-running.md.heartbeat'), '');
    writeFileSync(join(paths.pending, 'INIT-2026-10-04-halt-probe.md'), MANIFEST);
    writeHalt(paths.root, 'operator');
    const done = serve({ mode: 'forever', phaseWiring: WIRING, queueRoot: paths.root, worktreesRoot: join(dir, '_worktrees'), pollIntervalMs: 40 });
    await sleep(400);
    assert.deepEqual(listPending(paths), ['INIT-2026-10-04-halt-probe.md'], 'pending stays pending across many polls');
    assert.ok(existsSync(join(paths.inFlight, 'INIT-2026-10-04-running.md')), 'the in-flight item is not touched');
    assert.equal(cap.lines.filter((l) => l.includes('emergency halt on since')).length, 1, 'one line per episode, not per poll');
    releaseHalt(paths.root);
    await sleep(400);
    assert.deepEqual(listPending(paths), [], 'claimed after release');
    assert.ok(cap.lines.some((l) => l === '[serve] emergency halt released — claiming again'));
    process.emit('SIGTERM');
    await done;
  } finally {
    cap.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDrainSweep skips re-entry while halted (and runs without a halt)', async () => {
  const { dir, paths } = mkQueue();
  try {
    // A ready-for-review manifest with an unsafe worktree_path: the drain reports an error line for it.
    writeFileSync(
      join(paths.readyForReview, 'INIT-2026-10-04-drain.md'),
      '---\ninitiative_id: INIT-2026-10-04-drain\nproject: p\ncreated_at: 2026-10-04T00:00:00Z\niteration_budget: 10\ncost_budget_usd: 5\nclass: code\nworktree_path: /etc\n---\n',
    );
    const control = captureLogs();
    await runDrainSweep(WIRING, paths.root);
    control.restore();
    assert.ok(control.lines.some((l) => l.includes('INIT-2026-10-04-drain')), `control run reaches the manifest: ${control.lines.join('|')}`);

    writeHalt(paths.root, 'operator');
    const halted = captureLogs();
    await runDrainSweep(WIRING, paths.root);
    halted.restore();
    assert.deepEqual(halted.lines, [], 'no drain output while halted');
    assert.ok(readHalt(paths.root) !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
