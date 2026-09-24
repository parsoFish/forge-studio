/**
 * `gate.sh`'s host-contention bracket — M7 findings row 15
 * (`_1.0/rulings/M7-brief-findings.md`): the suite-lock serialises gates
 * against EACH OTHER but not against CPU. A costed story run (bridge +
 * chromium + agents) held under `.run-lock` shared the box with a gate's
 * steps at load 8–12 and three unrelated tests timed out; one of those
 * surfaced as TEN misleading FAILs from a single mount timeout (ruling 528,
 * bead 7.3.4). This does not fix the contention — it NAMES it, so a reader
 * of a red (or green) gate can tell "this measured something real" from
 * "the host was starved" without re-deriving it from `_1.0/reports/`.
 *
 * `gate.sh` now brackets its run with `GATE_LOAD_START`/`GATE_LOAD_END` (the
 * host's own `load1 load5 load15`, the same shape `run-observe.mjs`'s
 * `hostState()` already uses for a story's per-beat record) and
 * `GATE_RUNLOCK_HOLDER_START`/`_END` (the story run-lock's holder, via the
 * ONE `/proc/locks` classifier this file already has, or `NOT CONFIGURED`
 * outside a campaign) — and stamps `GATE_VERDICT=PROVISIONAL` when either
 * end crossed a NAMED threshold (2x nproc,
 * `FORGE_GATE_LOAD_THRESHOLD_MULT`-overridable). The stamp is a note FOR THE
 * READER: it never changes `fail`/`refused` or the exit code, so a stamped
 * gate is never a laundered one.
 *
 * `FORGE_LOADAVG_FILE` is the test seam, same idiom as `FORGE_PROC_LOCKS`:
 * `/proc/loadavg` cannot be made to hold a chosen number, so a door proving
 * the threshold and the stamp fire correctly points here instead.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh',
);

function tree(ci: string): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-load-tree-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  // The gate voids any verdict on a tree whose @forge/kernel resolves
  // outside it (§15.13), so this fixture owns its own install.
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'work');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return d;
}

const PASSING_CI = `jobs:
  build-and-test:
    steps:
      - name: A real step
        run: node -e "process.exit(0)"
`;

const FAILING_CI = `jobs:
  build-and-test:
    steps:
      - name: A real failure
        run: node -e "process.exit(1)"
`;

function loadavgFixture(text: string): string {
  const f = join(mkdtempSync(join(tmpdir(), 'gate-loadavg-')), 'loadavg');
  writeFileSync(f, text);
  return f;
}

/** 649's rule, restated by every split of this file: strip the lock env vars
 *  this test process inherits (a live campaign's), or an outer gate's own
 *  locks would decide what this door measures. */
function gate(args: string[], extraEnv: Record<string, string>) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } });
  return r.stdout ?? '';
}

describe('gate.sh — M7 findings row 15: host contention bracket', () => {
  test('markers are present at both ends, and no PROVISIONAL stamp under threshold', () => {
    const dir = tree(PASSING_CI);
    const out = gate([dir], { FORGE_LOADAVG_FILE: loadavgFixture('0.10 0.20 0.30\n') });
    assert.match(out, /^GATE_LOAD_START=0\.10 0\.20 0\.30$/m, `Output: ${out}`);
    assert.match(out, /^GATE_LOAD_END=0\.10 0\.20 0\.30$/m, `Output: ${out}`);
    assert.match(
      out, /^GATE_RUNLOCK_HOLDER_START=NOT CONFIGURED$/m,
      `no campaign dir was named, so there is no .run-lock to name: ${out}`,
    );
    assert.match(out, /^GATE_RUNLOCK_HOLDER_END=NOT CONFIGURED$/m, `Output: ${out}`);
    assert.doesNotMatch(out, /GATE_VERDICT=PROVISIONAL/, `low load must never stamp PROVISIONAL: ${out}`);
  });

  test('a load above 2x nproc stamps GATE_VERDICT=PROVISIONAL, and names the threshold', () => {
    const dir = tree(PASSING_CI);
    const out = gate([dir], { FORGE_LOADAVG_FILE: loadavgFixture('999.10 900.20 800.30\n') });
    assert.match(out, /^GATE_VERDICT=PROVISIONAL reason=load>\d/m, `Output: ${out}`);
    assert.match(out, /threshold 2x nproc=\d+/, `the multiplier is named, not buried in a comparison: ${out}`);
  });

  test('the stamp is a note, never a launder: a real FAIL is still FAIL, and PROVISIONAL is separate', () => {
    const dir = tree(FAILING_CI);
    const out = gate([dir], { FORGE_LOADAVG_FILE: loadavgFixture('999.10 900.20 800.30\n') });
    assert.match(out, /^FAIL {2}node -e "process\.exit\(1\)"/m, `a step that ran and lost is still FAIL: ${out}`);
    assert.match(out, /^GATE_VERDICT=PROVISIONAL/m, `and the load stamp still fires alongside it: ${out}`);
  });

  test('a run-lock held by a stranger is named at both ends', async () => {
    const dir = tree(PASSING_CI);
    const camp = mkdtempSync(join(tmpdir(), 'gate-load-camp-'));
    const runLock = join(camp, '.run-lock');
    writeFileSync(runLock, '');
    // A real holder, so the guard reads the kernel rather than a fixture —
    // same idiom as `gate-suite-lock.test.ts`'s own STRANGER doors.
    const holder = spawn('flock', [runLock, 'sleep', '5'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
    try {
      const out = gate([dir, camp], { FORGE_LOADAVG_FILE: loadavgFixture('0.10 0.20 0.30\n') });
      assert.match(out, /^GATE_RUNLOCK_HOLDER_START=STRANGER:\d+$/m, `Output: ${out}`);
      assert.match(out, /^GATE_RUNLOCK_HOLDER_END=STRANGER:\d+$/m, `Output: ${out}`);
    } finally {
      try { process.kill(holder.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  test('an unheld run-lock file reads FREE, not NOT CONFIGURED, once a campaign names it', () => {
    const dir = tree(PASSING_CI);
    const camp = mkdtempSync(join(tmpdir(), 'gate-load-camp-free-'));
    writeFileSync(join(camp, '.run-lock'), '');
    const out = gate([dir, camp], { FORGE_LOADAVG_FILE: loadavgFixture('0.10 0.20 0.30\n') });
    assert.match(out, /^GATE_RUNLOCK_HOLDER_START=FREE$/m, `Output: ${out}`);
  });
});
