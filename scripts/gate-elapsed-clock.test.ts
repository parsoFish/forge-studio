/**
 * `gate.sh`'s elapsed-time reporting — flake register row `scripts/
 * gate-refusal.test.ts:132` ("699: a step REFUSED by the lock guard is not
 * recorded as FAIL", whose `\(\d+s\)` door intermittently saw `?s` instead).
 *
 * `_1.0/reports/m7-c-clockprobe-1.log` measured this host's CLOCK_REALTIME
 * stepping BACKWARDS ~2.85–2.98s every ~29.6s, regardless of load. `gate.sh`
 * computed every step's elapsed time from `date +%s` differences (`secs()`,
 * previously ~L317): a step landing across that host step read a negative
 * delta and printed `?s (clock stepped)` rather than a duration.
 * `build-guard.mjs` hit the SAME clock on the SAME host and fixed it by
 * reading `performance.now()` instead of `Date.now()`
 * (forge-8vfn.7.6.50, `build-guard.test.ts`) — this is that fix's bash
 * shape, reading `/proc/uptime` (monotonic since boot, never adjusted by
 * NTP or a manual step) instead of `date +%s`.
 *
 * THE SEAM: a fake `date` placed first on PATH, the same idiom as
 * `gh-slot.test.ts`'s fake `gh` and `pin-glob-check.test.ts`'s fake `grep` —
 * `date +%s` cannot be made to answer a chosen, decreasing sequence any
 * other way, and the original mechanism (two `date +%s` reads straddling a
 * real host step) is otherwise unreachable on demand rather than waited
 * ~29.6s for. Only the exact invocation `date +%s` is intercepted; every
 * other `date` call gate.sh makes (the header timestamp, the suite-lock
 * sidecar's `since=`) execs the real binary unchanged, so this fixture does
 * not have to understand every format gate.sh asks for.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh',
);

const REAL_DATE = (spawnSync('which', ['date'], { encoding: 'utf8' }).stdout || '/usr/bin/date').trim();

/**
 * A fake `date` that answers `date +%s` — and ONLY that exact invocation,
 * checked by argument count and value rather than by a substring match, so
 * `date '+%FT%T%z'` and `date -u +%FT%TZ` (gate.sh's other two call shapes)
 * both fall through — from `sequence`, one element per call, clamped at the
 * last value once the sequence is exhausted. Same clamp-at-end shape as
 * `build-guard.test.ts`'s `fakeDateNowPreload`.
 */
function fakeDateOnPath(sequence: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-clock-bin-'));
  const state = join(dir, 'calls');
  writeFileSync(state, '0');
  const script = `#!/usr/bin/env bash
if [ "$#" -eq 1 ] && [ "$1" = "+%s" ]; then
  seq=(${sequence.join(' ')})
  n=$(cat '${state}')
  idx=$n
  [ "$idx" -ge "\${#seq[@]}" ] && idx=$((\${#seq[@]} - 1))
  echo "\${seq[$idx]}"
  echo $((n + 1)) > '${state}'
  exit 0
fi
exec '${REAL_DATE}' "$@"
`;
  const bin = join(dir, 'date');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return dir;
}

function tree(): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-clock-tree-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), `jobs:
  build-and-test:
    steps:
      - name: A quick step
        run: node -e "process.exit(0)"
`);
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

/** 649's rule, restated by every split of this file: strip the lock env vars
 *  this test process inherits (a live campaign's), or an outer gate's own
 *  locks would decide what this door measures. The fake `date` goes first on
 *  PATH so gate.sh's own `date +%s` calls resolve to it. */
function gateWithFakeDate(dir: string, bin: string): string {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...env } = process.env;
  const r = spawnSync('bash', [GATE, dir], {
    encoding: 'utf8',
    env: { ...env, PATH: `${bin}:${env.PATH ?? ''}` },
  });
  return r.stdout ?? '';
}

describe('gate.sh — elapsed time survives a backward wall-clock step (m7-c-clockprobe-1.log)', () => {
  test('a date +%s step landing mid-command must not print "?s (clock stepped)"', () => {
    // The measured shape: t0 read, then ~2.85–2.98s LOST off the wall clock
    // before the step's own read — reproduced on demand via the fixture
    // rather than waited ~29.6s for on the real host.
    const t0 = 2_000_000;
    const bin = fakeDateOnPath([t0, t0 - 3]);
    const dir = tree();
    const out = gateWithFakeDate(dir, bin);
    assert.match(
      out, /^PASS {2}node -e "process\.exit\(0\)" {2}\(\d+s\)$/m,
      `elapsed must be plain digits even under a stepped wall clock:\n${out}`,
    );
    assert.doesNotMatch(
      out, /\?s/,
      `the "?s (clock stepped)" fallback must never fire again — Date.now()/date +%s is not the source any more:\n${out}`,
    );
  });
});
