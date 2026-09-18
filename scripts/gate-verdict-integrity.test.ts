// gate-verdict-integrity.test.ts — two properties of a gate.sh VERDICT rather
// than of its steps: (1) the exit status is written into the gate's own log on
// every run path (T1 1104, D's finding); (2) the verdict is about the tree the
// gate started on (§15.540 as an assertion, forge-8vfn.7.6.129). Split out of
// gate.test.ts at the 800-line cap; the harness is copied, as every sibling
// gate-*.test.ts copies it, so this file owns the environment it asserts about.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

/** Strip the two lock exports an outer gate would hand down (T1 649): this file
 *  asserts about the gate it spawns, not about its own caller. */
function gate(...args: string[]) {
  const { FORGE_SUITE_LOCK: _suite, FORGE_RUN_LOCK: _run, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** A throwaway tree with its own ci.yml — the point is that the gate reads THIS one. */
function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-vi-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}
/** The gate voids any verdict on a tree whose `@forge/kernel` resolves outside
 *  it (§15.13), so a fixture that wants to reach the STEP loop must own its install. */
function installedInPlace(d: string) {
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
}
const CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
`;

describe('gate.sh — its exit status is written into its own log, on every path (D, T1 ruling 1104)', () => {
  // `merge-slot.sh` reads `GATE_SH_EXIT=<rc>` out of the handed gate log to
  // tell a refusal (exit 3, zero FAIL rows — a step never RAN, §15.92) from a
  // green gate. Nothing in gate.sh wrote that line; the only producer was one
  // lane's private wrapper, so for every other lane the variable was empty and
  // the refusal branch could not fire. The marker is the LAST stdout line of a
  // gate RUN — reached verdict or refusal alike — and never appended afterwards.
  const FAILING_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: A step that fails
        run: "false"
`;

  test('1104: a run that reached the verdict ends its stdout with GATE_SH_EXIT=<its rc>, and the rc is the red one', () => {
    const d = tree(FAILING_CI);
    installedInPlace(d);
    const r = gate(d);
    assert.notEqual(r.status, 0, `control: a failing step is a red gate. out: ${r.out}${r.err}`);
    assert.match(r.out, /== pins ==/, `control: the run reached the verdict section: ${r.out}`);
    const lines = r.out.trimEnd().split('\n');
    assert.equal(lines[lines.length - 1], `GATE_SH_EXIT=${r.status}`, `last stdout line: ${JSON.stringify(lines.slice(-3))}`);
  });

  test('1104: a REFUSED run (no step ran) ends its stdout with its own non-zero rc — the refusal the slot must see', () => {
    const d = tree(CI);
    installedInPlace(d);
    const r = gate(d, join(d, 'camp'), 'whatever');
    assert.notEqual(r.status, 0, 'control: a surplus argument is refused');
    assert.doesNotMatch(r.out, /== pins ==/, 'control: nothing ran');
    const lines = r.out.trimEnd().split('\n');
    assert.equal(lines[lines.length - 1], `GATE_SH_EXIT=${r.status}`, `last stdout line: ${JSON.stringify(lines.slice(-3))}`);
  });

  test('1104: the marker appears exactly once — a wrapper that also prints it would make two verdicts', () => {
    const d = tree(FAILING_CI);
    installedInPlace(d);
    const r = gate(d);
    const n = r.out.split('\n').filter((l) => /^GATE_SH_EXIT=/.test(l)).length;
    assert.equal(n, 1, `expected one marker line, saw ${n}`);
  });

  test('1104: the QUERY verbs carry no marker — --list is a step list and --lock-state a one-word answer that callers parse', () => {
    const d = tree(CI);
    installedInPlace(d);
    const list = gate('--list', d);
    assert.equal(list.status, 0, list.err);
    assert.doesNotMatch(list.out, /GATE_SH_EXIT=/, `--list must stay a step list: ${list.out}`);
    const lock = gate('--lock-state', join(d, 'no-such-lock'));
    assert.doesNotMatch(lock.out, /GATE_SH_EXIT=/, `--lock-state must stay a one-word answer: ${JSON.stringify(lock.out)}`);
  });
});

describe('gate.sh — a verdict is about the tree the gate STARTED on (§15.540 as an assertion, forge-8vfn.7.6.129)', () => {
  // Two lanes voided their own gates in one day by editing under a running
  // suite: the suite spanned the edit and reported green about a tree that
  // exists in no commit. "Do not edit during a gate" was a rule; this makes
  // the gate assert it. HEAD and a HASH of the porcelain are pinned after the
  // header and re-read before the verdict — hashed, never counted, because an
  // edit that swaps one dirty file for another keeps the count.
  const SELF_EDITING_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: A step that edits the tree it is judging
        run: touch moved-under-the-gate.txt
`;
  const QUIET_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: A step that touches nothing
        run: "true"
`;
  function gitTree(ci: string) {
    const d = tree(ci);
    installedInPlace(d);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
    spawnSync('git', ['-c', 'user.email=t@x.invalid', '-c', 'user.name=t', 'add', '-A'], { cwd: d });
    spawnSync('git', ['-c', 'user.email=t@x.invalid', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: d });
    spawnSync('git', ['update-ref', 'refs/remotes/parsoFish/main', 'HEAD'], { cwd: d });
    return d;
  }

  test('7.6.129: a tree that moved under its own gate is refused GATE_TREE_MOVED — rc 3, not the steps\' verdict', () => {
    const d = gitTree(SELF_EDITING_CI);
    const r = gate(d);
    assert.equal(r.status, 3, `rc: ${r.status}\n${r.out}${r.err}`);
    assert.match(r.out, /GATE_TREE_MOVED/, r.out);
    assert.match(r.out, /porcelain/, 'it names WHAT moved');
  });

  test('7.6.129: a tree that is not a git work tree is NAMED unpinned, never refused for movement (§15.92: a failed read is named, not an outage)', () => {
    const d = tree(QUIET_CI);
    installedInPlace(d);
    const r = gate(d);
    assert.match(r.out, /GATE_TREE_UNPINNED/, r.out);
    assert.doesNotMatch(r.out, /GATE_TREE_MOVED|GATE_TREE_UNREADABLE/, r.out);
  });

  test('7.6.129 CONTROL: a tree that did not move is not refused for movement', () => {
    const d = gitTree(QUIET_CI);
    const r = gate(d);
    assert.doesNotMatch(r.out, /GATE_TREE_MOVED/, r.out);
    assert.match(r.out, /GATE_TREE_PINNED/, 'the pin is printed so a reader can see what the verdict is about');
  });
});
