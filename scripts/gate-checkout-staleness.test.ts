/**
 * `gate.sh` names its own checkout's HEAD, and refuses when that checkout is
 * behind `parsoFish/main`.
 *
 * `forge-8vfn.7.6.36`, T1 ruling 757, §15.433. THE INCIDENT: `#670` merged
 * `PIN_MANIFESTS=` into `gate.sh`, and `main` carried it —
 * `git cat-file blob parsoFish/main:…/gate.sh | grep -c` returned 1. But every
 * lane's gate invokes `/home/parso/forge/.claude/…/gate.sh` BY ABSOLUTE PATH,
 * and that shared checkout was still at `f4e25132`, one merge behind, its
 * on-disk copy `f90a7def…` with ZERO hits. A restore of `pin-precheck.sh`'s
 * matching demand on that evidence would have refused every gate log on the
 * box with no re-gate able to fix it.
 *
 * M6-C found it by paying: they rebased so their gate would emit the line,
 * verified their own worktree greps 1, launched, and watched it invoke the
 * shared checkout's copy anyway. Killed at sixty seconds.
 *
 * IT IS RUN 12'S SHAPE AT A DIFFERENT SCALE. A story INTENT said "#667 is on
 * main" and #667 WAS on main; the run executed a worktree forked before it. A
 * dependency satisfied on `main` is not a dependency satisfied in the tree that
 * RUNS. So the tree that runs says which tree it is, in its own header, and
 * refuses rather than letting a lane discover it at a merge slot.
 *
 * WHY A FAILED FETCH DOES NOT REFUSE. `gate.sh`'s idiom is that what it does
 * not run, it NAMES (§15.92, its own line 13). A network blip must not turn
 * every gate on the box into an outage — that is the "precondition introduced
 * as an outage is one that gets removed" trap, and M6-C hit its mirror image
 * designing 7.6.34's escape. So an unreadable answer is PRINTED, loudly and by
 * name, rather than either refusing or passing in silence. A statement and an
 * absence are different things; only the absence is forbidden.
 *
 * RUN: npx tsx --test scripts/gate-checkout-staleness.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

function gate(...args: string[]) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Trivial
        run: echo checkout-staleness-fixture
`;

const git = (d: string, ...a: string[]) =>
  spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });

/** A real git repo with one commit, its own ci.yml, and its own install. */
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'gate-stale-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), CI);
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 'x@example.com');
  git(d, 'config', 'user.name', 'x');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'base');
  return d;
}

describe('gate.sh — the tree that runs says which tree it is (forge-8vfn.7.6.36)', () => {
  test('the header names the checkout HEAD the gate is running FROM', () => {
    const d = repo();
    try {
      const head = git(d, 'rev-parse', 'HEAD').stdout.trim();
      const r = gate(d);
      assert.match(r.out, /^GATE_CHECKOUT=/m,
        `the header must name its own checkout; got:\n${r.out.slice(0, 400)}`);
      const named = r.out.match(/^GATE_CHECKOUT=([0-9a-f]+)/m)?.[1] ?? '';
      assert.ok(head.startsWith(named) && named.length >= 7,
        `GATE_CHECKOUT=${named} must be this checkout's HEAD (${head.slice(0, 12)})`);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a checkout BEHIND parsoFish/main is REFUSED and named — not passed, not silent', () => {
    // The shape that cost M6-C a gate: the tool on disk is older than main, so
    // whatever the gate emits is a verdict from a tool nobody merged.
    const d = repo();
    try {
      // A local `parsoFish/main` ahead of HEAD, without a network.
      writeFileSync(join(d, 'AHEAD.md'), 'a commit this checkout does not have\n');
      git(d, 'add', 'AHEAD.md');
      git(d, 'commit', '-qm', 'ahead');
      const ahead = git(d, 'rev-parse', 'HEAD').stdout.trim();
      git(d, 'update-ref', 'refs/remotes/parsoFish/main', ahead);
      git(d, 'reset', '-q', '--hard', 'HEAD~1');

      const r = gate(d);

      assert.equal(r.status, 3, `a stale checkout must exit 3; got ${r.status}`);
      assert.match(r.out + r.err, /GATE_CHECKOUT_STALE/,
        'the refusal must be named, not a bare non-zero exit');
      assert.match(r.out + r.err, new RegExp(ahead.slice(0, 8)),
        'the refusal must name the sha this checkout is missing, so the reader knows what to advance to');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a checkout CONTAINING parsoFish/main is not refused for staleness', () => {
    const d = repo();
    try {
      git(d, 'update-ref', 'refs/remotes/parsoFish/main', git(d, 'rev-parse', 'HEAD').stdout.trim());
      const r = gate(d);
      assert.doesNotMatch(r.out + r.err, /GATE_CHECKOUT_STALE/,
        'a checkout at or ahead of main must not be called stale');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('an UNREADABLE staleness answer is named, and does NOT refuse', () => {
    // No `parsoFish` remote at all: the question cannot be answered. §15.92 —
    // name it. Refusing here would make every offline gate an outage, which is
    // how a precondition gets removed rather than fixed.
    const d = repo();
    try {
      const r = gate(d);
      assert.match(r.out + r.err, /GATE_CHECKOUT_UNKNOWN/,
        'an unanswerable staleness check must say so out loud');
      assert.notEqual(r.status, 3,
        'unreadable is not stale — it must not produce the staleness refusal');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
