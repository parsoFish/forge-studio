/**
 * forge-8vfn.2.14 — one lane finishing WELL silently reset the stall clock for
 * every other lane, and the watcher went blind for 79 minutes.
 *
 * Measured 2026-08-29 (`_1.0/ledger.md`, "NEW DEFECT — the stall watcher went
 * blind for 79 minutes"): m1-d finished its turn at 11:21 and sat idle; no
 * STALL-m1-d existed at 12:41; cron finally wrote it at 12:45:31 reading
 * `gap=35min ceiling=30min last_activity=2026-08-29T02:10:01Z`. The mechanism
 * was sound — crontab correct, cron running, syslog shows the job firing on the
 * dot every five minutes throughout. The REFERENCE was the wrong source of
 * truth: staleness was measured from `max(arm-time, liveness)` and arm-time was
 * a single global file re-stamped whenever the ACTIVE set changed, so M1-B
 * de-registering itself on a clean close-out at 12:10 re-armed m1-d too.
 *
 * The property under test: a lane's liveness reference must not be derivable
 * from anything another lane can write. These tests age the watcher's own epoch
 * stamps by rewriting whatever dotfiles it keeps, so they assert the CONTRACT
 * and not the name of any particular state file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WATCHER = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'watch-heartbeats.sh');
const CEILING_S = 30 * 60;

function run(hb: string) {
  const r = spawnSync('bash', [WATCHER, hb], { encoding: 'utf8' });
  assert.equal(r.status, 0, `watcher exited ${r.status}: ${r.stderr}`);
  return r;
}
function hbDir() {
  return mkdtempSync(join(tmpdir(), 'm1e-watch-'));
}
function beat(hb: string, lane: string, ageS: number) {
  const p = join(hb, `${lane}.log`);
  writeFileSync(p, `heartbeat for ${lane}\n`);
  const t = Date.now() / 1000 - ageS;
  utimesSync(p, t, t);
}
/** Age every epoch stamp the watcher keeps, whatever it chooses to call them. */
function ageWatcherState(hb: string, seconds: number) {
  for (const f of readdirSync(hb)) {
    if (!f.startsWith('.')) continue;
    const p = join(hb, f);
    const txt = readFileSync(p, 'utf8').trim();
    if (/^\d+$/.test(txt)) writeFileSync(p, String(Number(txt) - seconds));
  }
}
const stalled = (hb: string, lane: string) => existsSync(join(hb, `STALL-${lane}`));

describe('watch-heartbeats.sh — a lane\'s stall clock is its own', () => {
  test('an unrelated lane de-registering on a clean close-out does not clear the aged lane\'s flag', () => {
    const hb = hbDir();
    try {
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x m1-y\n');
      beat(hb, 'm1-x', CEILING_S + 15 * 60);   // idle 45 min
      beat(hb, 'm1-y', 60);                     // working
      run(hb);
      ageWatcherState(hb, CEILING_S + 15 * 60); // the campaign has been running a while
      run(hb);
      assert.ok(stalled(hb, 'm1-x'), 'precondition: the idle lane must be flagged');
      assert.ok(!stalled(hb, 'm1-y'), 'precondition: the working lane must not be flagged');

      // M1-B's event: a lane finishes well and drops itself from ACTIVE.
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x\n');
      rmSync(join(hb, 'STALL-m1-x'));           // T1 polled it and cleared it
      run(hb);

      assert.ok(stalled(hb, 'm1-x'), 'the still-idle lane must be re-flagged within one period, whatever another lane did');
    } finally {
      rmSync(hb, { recursive: true, force: true });
    }
  });

  test('a lane that recovers has its flag cleared, and a working lane is never flagged', () => {
    const hb = hbDir();
    try {
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x\n');
      beat(hb, 'm1-x', CEILING_S + 60);
      run(hb);
      ageWatcherState(hb, CEILING_S + 60);
      run(hb);
      assert.ok(stalled(hb, 'm1-x'), 'precondition: flagged while idle');
      beat(hb, 'm1-x', 0);                      // the lane heartbeats again
      run(hb);
      assert.ok(!stalled(hb, 'm1-x'), 'recovery must clear the flag');
    } finally {
      rmSync(hb, { recursive: true, force: true });
    }
  });

  test('a newly registered lane gets its grace period and is not flagged on sight', () => {
    const hb = hbDir();
    try {
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x\n');
      beat(hb, 'm1-x', CEILING_S + 60);
      run(hb);
      ageWatcherState(hb, CEILING_S + 60);
      run(hb);
      assert.ok(stalled(hb, 'm1-x'), 'precondition');
      // a second lane joins now, with no heartbeat of its own yet
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x m1-z\n');
      run(hb);
      assert.ok(!stalled(hb, 'm1-z'), 'a lane that has just been armed must not be flagged before its ceiling');
      assert.ok(stalled(hb, 'm1-x'), 'and arming the new lane must not re-arm the old one');
    } finally {
      rmSync(hb, { recursive: true, force: true });
    }
  });

  test('a lane that leaves ACTIVE stops being reported — its flag does not outlive it', () => {
    const hb = hbDir();
    try {
      writeFileSync(join(hb, 'ACTIVE'), 'm1-x\n');
      beat(hb, 'm1-x', CEILING_S + 60);
      run(hb);
      ageWatcherState(hb, CEILING_S + 60);
      run(hb);
      assert.ok(stalled(hb, 'm1-x'), 'precondition');
      writeFileSync(join(hb, 'ACTIVE'), 'NONE\n');
      run(hb);
      assert.ok(!stalled(hb, 'm1-x'), 'a closed lane must not leave a STALL flag behind for T1 to keep polling');
    } finally {
      rmSync(hb, { recursive: true, force: true });
    }
  });
});
