#!/usr/bin/env node
/**
 * lock-state — WHO HOLDS A LOCK, as distinct from who is queued for it and who
 * merely has it open. `forge-8vfn.7.6.96`, reconciled with `7.6.93` under T1 970.
 *
 * ONE WALKER AND ONE CLASSIFIER, and the classifier is the half that matters.
 * The walk is cheap; the subtle error lives in deciding what a pid IS. A waiter
 * has the descriptor open exactly like a holder does, so no fd census can tell
 * them apart — only `/proc/locks` can, and only if its blocked-waiter rows are
 * read. `lock-guard.mjs` already does that, with doors and a `procRoot` seam, so
 * this file classifies NOTHING. It calls `lockHolders` / `lockWaiters` /
 * `lockOpeners` and adds the one instrument they cannot have.
 *
 * WHY THIS EXISTS AT ALL — the one thing the kernel's list cannot see. A lock
 * taken on an inherited descriptor (`exec 9>lock; flock -n 9`) produces NO
 * `/proc/locks` row, so `lockHolders` returns empty for a lock that is plainly
 * held. Measured 2026-09-13 15:22:06Z: probe HELD, zero rows, three openers.
 * `flock -n` is the only instrument that answers "is it held" rather than "who
 * can I name", so the probe is the FACT and the census is the ATTRIBUTION.
 *
 * WHEN THEY DISAGREE, THE DISAGREEMENT IS THE OUTPUT. Held with no nameable
 * holder prints `HELD (unnameable — inherited fd)`. It is never resolved by
 * preferring one instrument: a tiebreak would discard the only signal that says
 * which instrument went blind.
 *
 * THE PROBE COSTS SOMETHING AND THIS SAYS SO: `flock -n` acquires and releases,
 * so probing a free lock takes it for microseconds. `-n` means it never queues,
 * so this can never become the contention it is measuring — which is exactly
 * what an earlier fd-census reading did (a 25-minute QUEUE read as a 28-minute
 * HOLD, ruling 946, retracted at 948).
 *
 *   lock-state who-holds <lockpath> [--twice]   probe + the three classes
 *   lock-state held      <lockpath>             FREE / HELD, exit 0 / 3
 *   lock-state say       <lockpath> [--twice]   one line carrying both
 *   lock-state who-runs  <abs-path>             7.6.93's mode — C's filter
 *
 * EXIT: 0 the lock is FREE · 3 the lock is HELD · 2 usage. The code is the
 * machine contract, so a caller never parses prose to branch.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { lockHolders, lockWaiters, lockOpeners } from './lock-guard.mjs';

const USAGE = 'usage: lock-state who-holds|held|say <lockpath> [--twice] | lock-state who-runs <abs-path>';

/** THE FACT. `flock -n` never queues, so it cannot become what it measures. */
function isHeld(lockPath) {
  return spawnSync('flock', ['-n', lockPath, 'true'], { stdio: 'ignore' }).status !== 0;
}

/** Facts about a pid that are not classification: the reader may observe these,
 *  and the CALLER draws the inference. `reparented` is the observable behind
 *  "nobody launched this" — a claim about intent the reader cannot make. */
function pidFacts(pid) {
  let ppid = null;
  try {
    // /proc/<pid>/stat field 4, read after the LAST ')' because a comm can
    // contain spaces and parentheses and splitting from the left mis-columns it.
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    ppid = after[1] ?? null;
  } catch { /* gone between the census and this read */ }
  let etime = '(gone)';
  const ps = spawnSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8' });
  if (ps.stdout && ps.stdout.trim() !== '') etime = ps.stdout.trim();
  let cmd = '';
  try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch { /* gone */ }
  const reparented = ppid === '1' || (ppid !== null && !aliveP(ppid));
  return { ppid, etime, cmd, reparented };
}
function aliveP(pid) { try { readlinkSync(`/proc/${pid}/cwd`); return true; } catch { return false; } }

/** `null` from the census means COULD NOT READ, which is not "nobody". Kept
 *  apart all the way to the output, because collapsing them is how an
 *  unreadable /proc becomes a clean bill of health. */
const occupants = (lockPath) => ({
  holders: lockHolders(lockPath),
  waiters: lockWaiters(lockPath),
  openers: lockOpeners(lockPath),
});

function render(lockPath, twice) {
  const held = isHeld(lockPath);
  const first = occupants(lockPath);
  let stability = null;
  if (twice) {
    // A's discriminator, in the walker so two callers cannot disagree about how
    // many scans make a stable. It costs a visible delay ON PURPOSE.
    spawnSync('sleep', ['1']);
    const second = occupants(lockPath);
    const seen = (set) => new Set([...(set.holders ?? []), ...(set.waiters ?? []), ...(set.openers ?? [])].map((r) => r.pid));
    const a = seen(first); const b = seen(second);
    stability = {
      stable: [...a].filter((p) => b.has(p)),
      // REPORTED, never filtered out: a row that vanishes between scans is the
      // self-match announcing itself, and suppressing it turns the tell back
      // into silence.
      transient: [...a].filter((p) => !b.has(p)),
    };
  }
  return { held, ...first, stability };
}

function line(lockPath, r) {
  const name = lockPath.split('/').pop();
  const nameList = (rows) => (rows === null ? 'UNREADABLE' : rows.length === 0 ? 'none'
    : rows.map((x) => {
        const f = pidFacts(x.pid);
        return `${x.pid}(cwd ${x.cwd ?? '?'}, ppid ${f.ppid ?? '?'}${f.reparented ? ', reparented' : ''}, ${f.etime})`;
      }).join(' '));
  let head;
  if (!r.held) head = 'FREE';
  else if (r.holders === null) head = 'HELD (census UNREADABLE)';
  else if (r.holders.length === 0) head = 'HELD (unnameable — inherited fd)';
  else head = `HELD ${nameList(r.holders)}`;
  const waits = r.waiters === null ? 'UNREADABLE' : String(r.waiters.length); // COUNTED, not named (7.6.33)
  let out = `lock ${name} ${head} WAITING:${waits} OPEN-NOT-LOCKED:${nameList(r.openers)}`;
  if (r.stability !== null) {
    out += ` | stable across 2 scans: ${r.stability.stable.join(',') || 'none'}`;
    if (r.stability.transient.length > 0) {
      out += ` | transient — present in scan 1 only, likely the scanner or its shell: ${r.stability.transient.join(',')}`;
    }
  }
  return out;
}

const [verb, target, ...rest] = process.argv.slice(2);
if (verb === undefined || target === undefined) { console.error(USAGE); process.exit(2); }
const twice = rest.includes('--twice');

if (verb === 'who-runs') {
  // 7.6.93's mode. The FILTER is C's and is deliberately not guessed here: it
  // matches the ABSOLUTE target path in a cmdline (7.6.90 — a bare name matches
  // a sibling's copy in another worktree) and refuses a relative argument rather
  // than resolving one against the caller's cwd. Declared so the verb exists at
  // one address; refusing rather than approximating, because a census that
  // half-works is the failure this whole reconciliation is about.
  console.error('lock-state: who-runs is 7.6.93\'s mode and is not implemented here yet — use save-instrument.sh\'s own scan until C lands it');
  process.exit(2);
}
if (!['who-holds', 'held', 'say'].includes(verb)) { console.error(`lock-state: unknown verb '${verb}'\n${USAGE}`); process.exit(2); }

const r = render(target, twice);
if (verb === 'held') console.log(r.held ? (r.holders === null || r.holders.length === 0 ? 'HELD (unnameable — inherited fd)' : `HELD ${r.holders.map((h) => `${h.pid}(cwd ${h.cwd ?? '?'})`).join(' ')}`) : 'FREE');
else console.log(line(target, r));
process.exit(r.held ? 3 : 0);
