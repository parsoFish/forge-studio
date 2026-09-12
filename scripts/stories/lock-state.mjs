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
 * WHY THIS EXISTS AT ALL — the one thing the kernel's list cannot ALWAYS see. A
 * lock taken on an inherited descriptor (`exec 9>lock; flock -n 9`) produced NO
 * `/proc/locks` row on this box: measured 2026-09-13 15:22:06Z, probe HELD, zero
 * rows, three openers. `lockHolders` returned empty for a lock that was plainly
 * held, and every wait in the campaign would have walked into it.
 *
 * AND THAT BLINDNESS IS THE BOX'S, NOT LINUX'S — CI proved it by red-ing the
 * door that asserted otherwise. The identical shape in GitHub Actions DOES name
 * its holder (`/proc/locks` row, pid 25484). So the census is blind here and
 * sighted there, which makes the probe MORE necessary rather than less: it is
 * the only instrument that answers "is it held" correctly in both, while the
 * census answers "who can I name" and is environment-dependent about it.
 *
 * The probe is the FACT; the census is the ATTRIBUTION, when it can.
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
 *
 * `who-runs` ANSWERS A THREE-STATE QUESTION AND SO HAS A THIRD CODE: 0 nobody
 * runs it · 3 someone does · **4 the census could not tell** · 2 usage. 4 exists
 * because the sentence above is the whole trap: this file printed
 * `N pid(s) UNREADABLE` under a comment reading "UNKNOWN is reported, never
 * folded into 'nobody'" — and then exited 0, which IS "nobody" to the only
 * consumer the contract admits. Reported in prose and folded in the code is not
 * a weaker version of §15.504, it is the violation with a comment denying it.
 * green · red · UNKNOWN are three states and UNKNOWN never resolves toward
 * proceeding.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lockHolders, lockWaiters, lockOpeners, ancestorPids, whoRuns, whoRunsExit } from './lock-guard.mjs';

const USAGE = 'usage: lock-state who-holds|held|say <lockpath> [--twice[=SECONDS]] | lock-state who-runs <abs-path>';

/** THE FACT. `flock -n` never queues, so it cannot become what it measures. */
function isHeld(lockPath) {
  return spawnSync('flock', ['-n', lockPath, 'true'], { stdio: 'ignore' }).status !== 0;
}

/** Facts about a pid that are not classification: the reader may observe these,
 *  and the CALLER draws the inference.
 *
 *  THE PARENT IS NAMED, NOT JUDGED — C's correction, and they found it by
 *  putting their own incident's pid through my predicate rather than reading its
 *  definition. I had `reparented = ppid === 1 || parent is gone`, which is right
 *  for classic Unix and WRONG on this box: WSL2 reparents to a SUBREAPER, and
 *  C's orphaned `flock` had **ppid 277**, which is alive, is not 1, and is
 *  `/init`. Measured here: `/proc/277/cmdline` is `/init`, `/proc/1` is systemd.
 *  So the flag computed FALSE for the one incident it existed to make legible.
 *
 *  The fix is not a cleverer predicate — "is this a subreaper" is another guess,
 *  and the next box answers differently. The parent's IDENTITY is emitted as a
 *  fact (`ppid 277 /init`) so a reader can SEE that the wrapper they launched is
 *  no longer the parent. `reparented` survives only for the unambiguous `ppid 1`
 *  case and is never the only signal. */
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
  return { ppid, parent: ppid === null ? '' : firstToken(ppid), etime, reparented: ppid === '1' };
}
/** The first token of a pid's cmdline, truncated — enough to recognise `/init`
 *  or a wrapper by name, short enough to sit inside one line of output. */
function firstToken(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const first = raw.split('\0').find((t) => t !== '') ?? '';
    return first.length > 32 ? `${first.slice(0, 31)}…` : first;
  } catch { return '(gone)'; }
}


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
  if (twice !== null) {
    // A's discriminator, in the walker so two callers cannot disagree about how
    // many scans make a stable. It costs a visible delay ON PURPOSE.
    //
    // THE DEFAULT IS A GUESS, NOT A MEASUREMENT, and says so: C's orphan was
    // stable for minutes and A's self-match is a new shell every scan, so one
    // second separates both with room — but nothing has measured where the
    // boundary actually is, which is why it is an argument.
    spawnSync('sleep', [String(twice)]);
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
        const par = f.parent === '' ? '' : ` ${f.parent}`;
        return `${x.pid}(cwd ${x.cwd ?? '?'}, ppid ${f.ppid ?? '?'}${par}${f.reparented ? ', reparented' : ''}, ${f.etime})`;
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
// `--twice` or `--twice=SECONDS`.
const twiceArg = rest.find((a) => a === '--twice' || a.startsWith('--twice='));
const twice = twiceArg === undefined ? null : (twiceArg.includes('=') ? Number(twiceArg.split('=')[1]) : 1);
if (twice !== null && (!Number.isFinite(twice) || twice < 0)) { console.error('lock-state: --twice takes a non-negative number of seconds'); process.exit(2); }

if (verb === 'who-runs') {
  if (!target.startsWith('/')) {
    console.error(`lock-state: who-runs needs an ABSOLUTE path; got '${target}'. A bare name matches a sibling's copy in another worktree (7.6.90), and resolving this against the caller's cwd would be a guess about which tree was meant.`);
    process.exit(2);
  }
  const first = whoRuns(target);
  if (!first.ok) { console.error(`lock-state: ${first.reason}`); process.exit(2); }
  let stable = null;
  if (twice !== null) {
    // A's discriminator, in the walker so two callers cannot disagree: a
    // SELF-MATCH's pid changes every scan (a new shell each time) while a real
    // orphan's is stable with a climbing elapsed. Transients are REPORTED, never
    // filtered — a row that vanishes between scans is the self-match announcing
    // itself, and suppressing it turns the tell back into silence.
    spawnSync('sleep', [String(twice)]);
    const second = whoRuns(target);
    const seen = new Set(second.rows.map((r) => r.pid));
    stable = {
      stable: first.rows.filter((r) => seen.has(r.pid)).map((r) => r.pid),
      transient: first.rows.filter((r) => !seen.has(r.pid)).map((r) => r.pid),
    };
  }
  const name = target.split('/').pop();
  if (first.rows.length === 0 && first.unknown.length === 0) {
    console.log(`who-runs ${name}: nobody`);
  } else {
    for (const r of first.rows) {
      // The WALK and the FILTER are `lock-guard.mjs`'s (pure, importable); the
      // per-pid presentation facts are this CLI's, through the same `pidFacts`
      // `who-holds` uses — one reader, one set of facts, one spelling of them.
      const f = pidFacts(r.pid);
      const mark = stable === null ? '' : (stable.stable.includes(r.pid) ? ` stable across 2 scans (${twice}s apart)` : ' transient — present in scan 1 only, likely the scanner or its shell');
      console.log(`who-runs ${name}: ${r.pid}(cwd ${r.cwd ?? '?'}, ppid ${f.ppid ?? '?'}${f.parent ? ` ${f.parent}` : ''}${f.reparented ? ', reparented' : ''}, ${f.etime})${mark}`);
    }
    // UNKNOWN is reported, never folded into "nobody" (§15.504).
    if (first.unknown.length > 0) console.log(`who-runs ${name}: ${first.unknown.length} pid(s) UNREADABLE — ${first.unknown.join(',')}`);
  }
  // 3 someone runs it · 4 the census could not read every pid, so "nobody" is
  // not a claim this run is entitled to make · 0 only when it read everything
  // and found no one. The mapping is `whoRunsExit`, in the pure module, because
  // written inline here it was untestable and wrong.
  process.exit(whoRunsExit(first));
}
if (!['who-holds', 'held', 'say'].includes(verb)) { console.error(`lock-state: unknown verb '${verb}'\n${USAGE}`); process.exit(2); }

const r = render(target, twice);
if (verb === 'held') console.log(r.held ? (r.holders === null || r.holders.length === 0 ? 'HELD (unnameable — inherited fd)' : `HELD ${r.holders.map((h) => `${h.pid}(cwd ${h.cwd ?? '?'})`).join(' ')}`) : 'FREE');
else console.log(line(target, r));
process.exit(r.held ? 3 : 0);
