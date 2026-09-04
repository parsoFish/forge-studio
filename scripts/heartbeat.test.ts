/**
 * §15.143 (library, 2026-09-04) — a two-file liveness signal written by only one automatic path
 * will always drift, and the fresh file hides the stale one: its Monitor loops stamped
 * `library.liveness` every poll while `library.log` sat 40 minutes old, and the watcher raised a
 * false stall on the log. §15.80 names the shape of the fix: when a rule is "remember to also do
 * X", make X structurally inseparable. `heartbeat.sh` is that shape — ONE `date` writes the log
 * line and re-declares the job logs, so there is nothing left to apply in only one place.
 *
 * The last test here is the one that matters: a lane that heartbeats through this helper cannot
 * produce the incident's shape, and the watcher says so.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKILL = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts');
const HEARTBEAT = join(SKILL, 'heartbeat.sh');
const WATCHER = join(SKILL, 'watch-heartbeats.sh');

function camp() {
  const d = mkdtempSync(join(tmpdir(), 'hb-'));
  mkdirSync(join(d, 'heartbeat'), { recursive: true });
  return d;
}
function beat(c: string, ...args: string[]) {
  return spawnSync('bash', [HEARTBEAT, c, ...args], { encoding: 'utf8' });
}
const hbFile = (c: string, lane: string, ext: string) => join(c, 'heartbeat', `${lane}.${ext}`);
/** The epoch second a `%FT%TZ` stamp names. */
const stampEpoch = (line: string) => Date.parse(line.slice(0, 20)) / 1000;

describe('heartbeat.sh — one date writes both files, or neither', () => {
  test('appends a stamped state line and declares the job logs, from ONE date', () => {
    const c = camp();
    try {
      const job = join(c, 'run.log');
      writeFileSync(job, 'output\n');

      const r = beat(c, 'x', 'row 2 red 0 fail 0 timeout', job);

      assert.equal(r.status, 0, r.stderr);
      const line = readFileSync(hbFile(c, 'x', 'log'), 'utf8').trim();
      assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z row 2 red 0 fail 0 timeout$/, 'the stamp is the helper\'s, and the state is the lane\'s own words');
      assert.equal(readFileSync(hbFile(c, 'x', 'liveness'), 'utf8').trim(), job, 'the declared job log is the file, one path per line');
      // ONE date: the stamp, the log's mtime and the liveness file's mtime are the same instant.
      const stamp = stampEpoch(line);
      assert.ok(Math.abs(statSync(hbFile(c, 'x', 'log')).mtimeMs / 1000 - stamp) <= 2, 'the stamp is when the line was written — this is what the watcher cross-checks');
      assert.ok(Math.abs(statSync(hbFile(c, 'x', 'liveness')).mtimeMs / 1000 - stamp) <= 2, 'and the liveness file was stamped by the same date, not a later one');
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });

  test('appends — a heartbeat never truncates the history it is adding to', () => {
    const c = camp();
    try {
      beat(c, 'x', 'first');
      beat(c, 'x', 'second');
      const lines = readFileSync(hbFile(c, 'x', 'log'), 'utf8').trim().split('\n');
      assert.equal(lines.length, 2);
      assert.match(lines[0], / first$/);
      assert.match(lines[1], / second$/);
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });

  test('with no job logs it LEAVES the declaration alone — a mid-run beat cannot undeclare a live job', () => {
    const c = camp();
    try {
      const job = join(c, 'run.log');
      writeFileSync(job, 'output\n');
      beat(c, 'x', 'launched the suite', job);
      const before = statSync(hbFile(c, 'x', 'liveness')).mtimeMs;

      beat(c, 'x', 'still waiting on it');

      assert.equal(statSync(hbFile(c, 'x', 'liveness')).mtimeMs, before, 'the liveness file is not re-stamped by a beat that declares nothing');
      assert.equal(readFileSync(hbFile(c, 'x', 'liveness'), 'utf8').trim(), job, 'and the declaration survives');
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });

  test('--clear ends the declaration explicitly, because silence must not do it', () => {
    const c = camp();
    try {
      const job = join(c, 'run.log');
      writeFileSync(job, 'output\n');
      beat(c, 'x', 'launched', job);

      beat(c, 'x', 'job finished', '--clear');

      assert.equal(readFileSync(hbFile(c, 'x', 'liveness'), 'utf8').trim(), '', 'nothing is declared any more');
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });

  test('an empty state is refused, and writes nothing', () => {
    const c = camp();
    try {
      const r = beat(c, 'x', '');

      assert.notEqual(r.status, 0, 'a heartbeat with no state is the optimistic label lane-protocol §2 forbids');
      assert.match(r.stderr, /state/, 'and the refusal says so');
      assert.ok(!existsSync(hbFile(c, 'x', 'log')), 'nothing is written');
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });

  test('a missing campaign heartbeat dir is a loud failure, never a silent no-op', () => {
    const r = spawnSync('bash', [HEARTBEAT, join(tmpdir(), 'no-such-campaign-dir-hb'), 'x', 'state'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no-such-campaign-dir-hb/, 'the failure names the path it could not find');
  });

  /**
   * The property the helper exists for: a lane that beats through it cannot produce §15.143's
   * shape. Here the declared job really has gone quiet and the log is old — the honest state —
   * and the watcher reports it as a GAP. What it can never report is the false reassurance the
   * incident produced, because `.liveness` was never stamped without `.log`.
   */
  test('a lane that beats through the helper never produces the wrong-file heartbeat', () => {
    const c = camp();
    try {
      const hb = join(c, 'heartbeat');
      const job = join(c, 'run.log');
      writeFileSync(job, 'output\n');
      writeFileSync(join(hb, 'ACTIVE'), 'x\n');
      beat(c, 'x', 'parked on the suite', job);

      // Replay that same beat 40 minutes earlier, with the job dead since: shift the stamp the
      // helper wrote AND every mtime by the same 40 minutes, so the helper's own invariant
      // (stamp == write time) is carried intact into the past. Aging only the mtimes would
      // manufacture a stamp newer than its file — a state the helper cannot produce.
      const t = Date.now() / 1000 - 40 * 60;
      const log = hbFile(c, 'x', 'log');
      const aged = readFileSync(log, 'utf8').replace(/^\S+/, new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
      writeFileSync(log, aged);
      writeFileSync(join(hb, '.armed-x'), String(Math.floor(t)));
      for (const f of [log, hbFile(c, 'x', 'liveness'), job]) utimesSync(f, t, t);
      const w = spawnSync('bash', [WATCHER, hb], { encoding: 'utf8' });

      assert.equal(w.status, 0, w.stderr);
      const flag = readFileSync(join(hb, 'STALL-x'), 'utf8');
      assert.match(flag, /^STALL x gap=/, 'a lane that really went quiet is a GAP');
      assert.doesNotMatch(flag, /liveness stamped without a live job/, 'and never the wrong-file heartbeat — the helper cannot stamp one file alone');
      assert.doesNotMatch(flag, /stamp\/mtime mismatch/, 'nor a mismatch: the helper\'s stamp always is its write time');
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  });
});
