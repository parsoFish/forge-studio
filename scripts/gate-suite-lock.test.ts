/**
 * `gate.sh` holds the suite-lock itself — bead `forge-8vfn.7.6.48`, T1 ruling 841.
 *
 * THE MEASUREMENT THAT CHANGED THE BEAD. `grep -c flock` on `gate.sh` was
 * **0**: the tool only ever EXPORTED `FORGE_SUITE_LOCK` (`:176`) so the repo's
 * `npm test` guard could read the name, and every caller was trusted to take
 * it. Twenty campaign wrappers did. Lane D had no wrapper at all and invoked
 * `gate.sh` directly, so its gates ran every heavy step unserialised — which
 * is the contention ruling 778 measured at 3.2x with nine timeouts while BOTH
 * runs believed they held the lock.
 *
 * WHY THE OBVIOUS FIX WOULD HAVE DEADLOCKED. "Take the lock unconditionally"
 * hangs all twenty: `flock` in a child opens its OWN fd, so an inner acquire
 * under an outer holder blocks until its `-w` expires. The tool must therefore
 * distinguish three states, and the middle one is the whole point:
 *
 *   FREE            take it; the guarantee is the TOOL's, not the caller's
 *   ANCESTOR:<pid>  a caller up our own process chain holds it — proceed,
 *                   never re-take
 *   STRANGER:<pids> a sibling lane holds it — wait
 *
 * THE DOORS BELOW ASSERT THE PROPERTY, NOT THE LOG LINE: each fixture's own CI
 * step reads `/proc/locks` and records whether the lock was held WHILE IT RAN.
 * A gate that printed "suite-lock: TAKEN" and ran its steps unlocked would pass
 * a message assertion and fail these.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

/**
 * The step records EXCLUSION, not a /proc/locks row — and the difference is a
 * measured property, not a style choice.
 *
 * A lock held through an INHERITED fd (`exec 9>file; flock 9`, which is how
 * this gate must hold it — see the implementation's comment) is genuinely held
 * and has ZERO rows in /proc/locks: the listing attributes a lock to the
 * process that created it, and that `flock(1)` has already exited. Measured
 * both ways: another opener is blocked, and the inode has no row. A door that
 * counted rows would therefore report "not held" for a correctly held lock and
 * fail a working gate.
 *
 * `flock -n` from the step opens its OWN descriptor, so it answers the only
 * question that matters: could anything else have run a suite beside me?
 */
const LOCK_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Record whether the suite lock excluded anyone else while this step ran
        run: bash -c 'if flock -n "$FORGE_SUITE_LOCK" true 2>/dev/null; then echo FREE > held.txt; else echo HELD > held.txt; fi'
`;

function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gatelock-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
  return d;
}
const camp = () => mkdtempSync(join(tmpdir(), 'gatelock-camp-'));

/** This file's subject is a lock the gate takes, so it must not inherit one. */
function env(extra: Record<string, string> = {}) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...rest } = process.env;
  return { ...rest, ...extra };
}
function gate(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env: env(extra) });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** Run the gate beneath `depth` nested shells, all under one outer `flock`. */
function gateUnderFlock(lock: string, depth: number, args: string[], extra: Record<string, string> = {}) {
  const inner = `bash ${JSON.stringify(GATE)} ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  let cmd = inner;
  for (let i = 0; i < depth; i++) cmd = `bash -c ${JSON.stringify(cmd)}`;
  const r = spawnSync('flock', ['-w', '60', lock, 'bash', '-c', cmd], { encoding: 'utf8', env: env(extra) });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** What the STEP observed: 'HELD', 'FREE', or 'NEVER RAN'. */
function lockSeenByStep(d: string): string {
  const f = join(d, 'held.txt');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : 'NEVER RAN';
}

describe('gate.sh — the suite-lock is the TOOL\'s guarantee, not the caller\'s', () => {
  test('FREE: the gate takes the lock, and the step runs while it is HELD', () => {
    const d = tree(LOCK_CI);
    const c = camp();

    const r = gate([d, c]);

    assert.equal(
      lockSeenByStep(d),
      'HELD',
      'the step must run while the lock EXCLUDES others — the property. A gate that printed ' +
        '"TAKEN" and ran its steps unlocked passes a message assertion and fails this one.',
    );
    assert.match(r.out, /^suite-lock: TAKEN/m, 'and it says so, because a lock taken silently is one nobody can audit');
  });

  test('ANCESTOR: a caller already holding it is not re-taken — the deadlock case', () => {
    const d = tree(LOCK_CI);
    const c = camp();

    const r = gateUnderFlock(join(c, '.suite-lock'), 1, [d, c]);

    assert.equal(lockSeenByStep(d), 'HELD', 'the step still runs excluded — the caller is holding it');
    assert.match(
      r.out,
      /^suite-lock: held by ancestor pid \d+/m,
      'and the gate names why it did not take it, so a reader can tell this from the FREE case',
    );
  });

  test('ANCESTOR, doubly nested: the walk is the whole chain, not the parent', () => {
    const d = tree(LOCK_CI);
    const c = camp();

    const r = gateUnderFlock(join(c, '.suite-lock'), 2, [d, c]);

    assert.match(r.out, /^suite-lock: held by ancestor pid \d+/m, `two shells deep is still an ancestor: ${r.out}${r.err}`);
    assert.equal(lockSeenByStep(d), 'HELD');
  });

  test('STRANGER: a sibling\'s hold is WAITED for, never ignored', () => {
    const d = tree(LOCK_CI);
    const c = camp();
    const lock = join(c, '.suite-lock');
    // A holder that is nobody's ancestor, outliving the gate's short bound.
    // WAITED FOR, NOT ASSUMED: `spawnSync` returns when the shell exits, which
    // is before the backgrounded `flock` has necessarily acquired — the first
    // version of this test raced and the gate reported TAKEN, i.e. the fixture
    // proved nothing while looking like a product failure.
    // `setsid`, because a plain `&` inside `spawnSync`'s shell dies with it:
    // the second version of this fixture polled for a holder that had already
    // been reaped, and failed as "the holder must hold" rather than racing.
    spawnSync('bash', ['-c', `setsid flock ${JSON.stringify(lock)} sleep 8 < /dev/null > /dev/null 2>&1 &`], {
      encoding: 'utf8',
    });
    const acquired = spawnSync(
      'bash',
      ['-c', `for i in $(seq 1 100); do flock -n ${JSON.stringify(lock)} true || exit 0; sleep 0.05; done; exit 1`],
      { encoding: 'utf8' },
    );
    assert.equal(acquired.status, 0, 'the fixture holder must actually hold the lock before the gate runs');

    const r = gate([d, c], { FORGE_SUITE_LOCK_WAIT: '1' });

    assert.match(
      r.out,
      /^suite-lock: WAITING on stranger pid|^suite-lock: NOT TAKEN/m,
      'a stranger\'s hold must be named — the failure this bead exists for is a gate that ran anyway',
    );
    assert.notEqual(
      lockSeenByStep(d),
      'FREE',
      'the step must never observe a FREE lock: either it waited for the stranger or it never ran',
    );
  });

  test('NO campaign: the unconfigured state is NAMED, never silently unlocked (§15.92)', () => {
    const d = tree(LOCK_CI);

    const r = gate([d]);

    assert.match(
      r.out,
      /^suite-lock: NOT CONFIGURED/m,
      'a gate outside a campaign is legitimate and unserialised — but "nothing to report" and ' +
        '"no lock was taken" must not look the same',
    );
  });
});
