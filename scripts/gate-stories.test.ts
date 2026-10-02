/**
 * The door for the costless stories step — M7 findings row 76 / T1 ruling
 * 1973cy item 76.
 *
 * `gate.sh`'s local gate used to pass with `GATE_SH_EXIT=0` and then go red
 * on CI's `stories` job, because that job's multi-line `run: |` block (the
 * two costless harness proof stories, `smoke` and `proof`) was never run
 * locally — the parser treated any multi-line block as a named SKIP and the
 * bash consumer then lumped the `stories` job under `OTHER JOB` on top of
 * that. This file pins the fix: the block is derived from ci.yml (never a
 * hard-coded pair), appears as `RUN`, runs under the campaign's run-lock
 * without re-taking a suite-lock an ancestor already holds, surfaces a
 * missing chromium as a named `REFUSED` rather than a crash, and a genuinely
 * failing story is `FAIL` like any other step.
 *
 * Split from `gate.test.ts` rather than grown inside it — that file is
 * already within sight of its own 800-line cap (gate-refusal.test.ts split
 * off the same way, for the same reason).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const SCRIPTS_DIR = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts');
const GATE = join(SCRIPTS_DIR, 'gate.sh');
const GATE_STORIES = join(SCRIPTS_DIR, 'gate-stories.sh');

/** 649/this file's own version of it: a gate must not inherit a live
 *  campaign's lock vars from the ambient shell (measured: this very box
 *  carries FORGE_RUN_LOCK/FORGE_SUITE_LOCK pointed at a real campaign) — a
 *  test that asserts an ABSENCE or a SCRATCH value owns the environment it
 *  asserts about. */
function strippedEnv(extra: Record<string, string> = {}) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...env } = process.env;
  return { ...env, ...extra };
}

function gate(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env: strippedEnv(extraEnv) });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-stories-tree-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}

function installedInPlace(d: string) {
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
}

/** A fixture `ci.yml` shaped like the real one's two jobs, with FAKE story
 *  commands (plain `echo`, never a real `npm run stories`) so the door never
 *  needs a real browser — only `gate-stories.sh`'s own chromium precondition
 *  is under test, never playwright itself. */
const CI_OK = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
  stories:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: npm ci
      - name: Run the harness proof stories
        run: |
          echo SMOKE-OK
          echo PROOF-OK
      - name: Name stale story artifacts (never red — T1 1283)
        run: node scripts/stories/artifact-staleness.mjs
`;

const CI_FAILING = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
  stories:
    runs-on: ubuntu-latest
    steps:
      - name: Run the harness proof stories
        run: |
          echo SMOKE-OK
          exit 3
`;

describe('gate.sh --list — the stories job\'s own costless stories are RUN, not OTHER JOB', () => {
  test('appears as a RUN line wrapping gate-stories.sh, never SKIP or OTHER JOB', () => {
    const d = tree(CI_OK);
    try {
      const r = gate(['--list', d]);
      assert.equal(r.status, 0, r.err);
      assert.match(r.out, /^RUN .*gate-stories\.sh /m, `expected a RUN line for the derived step; got:\n${r.out}`);
      assert.doesNotMatch(r.out, /OTHER JOB stories:.*multi-line/, 'the stories block must not still read as unrun');
      assert.doesNotMatch(r.out, /SKIP.*multi-line/, 'nor as a silently-dropped multi-line block');
      // The REST of the stories job (install, the artifact-staleness step)
      // stays exactly what it always was — a separate CI job's steps, named.
      assert.match(r.out, /^OTHER JOB stories: npm ci/m);
      assert.match(r.out, /^OTHER JOB stories: node scripts\/stories\/artifact-staleness\.mjs/m);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the derived command is the ACTUAL ci.yml text, never a hard-coded smoke/proof pair', () => {
    // A differently-worded fixture proves the parser reads ci.yml rather than
    // recognising a literal "smoke"/"proof" string.
    const CI_CUSTOM = CI_OK.replace('echo SMOKE-OK\n          echo PROOF-OK', 'echo CUSTOM-ONE\n          echo CUSTOM-TWO');
    const d = tree(CI_CUSTOM);
    try {
      const r = gate(['--list', d]);
      assert.match(r.out, /CUSTOM-ONE.*&&.*CUSTOM-TWO|CUSTOM-ONE[\s\S]*CUSTOM-TWO/, `expected the custom lines to surface verbatim; got:\n${r.out}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a multi-line block OUTSIDE the stories job is still a named SKIP — nothing else is auto-promoted', () => {
    const CI_OTHER_MULTILINE = `jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: A multi-line step
        run: |
          echo NOT-STORIES-A
          echo NOT-STORIES-B
`;
    const d = tree(CI_OTHER_MULTILINE);
    try {
      const r = gate(['--list', d]);
      assert.match(r.out, /^SKIP .*multi-line/m);
      assert.doesNotMatch(r.out, /gate-stories\.sh/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — running the derived stories step', () => {
  test('a failing stub story is FAIL, with a log, and feeds a nonzero gate exit', () => {
    const d = tree(CI_FAILING);
    installedInPlace(d);
    try {
      const r = gate([d], { FORGE_CHROMIUM_EXECUTABLE: '/bin/true' });
      assert.match(r.out, /^FAIL .*gate-stories\.sh.*→ /m, `expected a FAIL row with a log path; got:\n${r.out}`);
      assert.notEqual(r.status, 0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a green stub story is PASS and its log shows it actually ran', () => {
    const d = tree(CI_OK);
    installedInPlace(d);
    const campaign = mkdtempSync(join(tmpdir(), 'gate-stories-camp-'));
    try {
      const r = gate([d, campaign], { FORGE_CHROMIUM_EXECUTABLE: '/bin/true' });
      assert.match(r.out, /^PASS .*gate-stories\.sh/m, `expected a PASS row; got:\n${r.out}`);
      const logs = readdirSync(join(campaign, 'reports')).filter((f) => f.includes(basename(d)));
      const body = logs.map((f) => readFileSync(join(campaign, 'reports', f), 'utf8')).join('\n');
      assert.match(body, /SMOKE-OK/);
      assert.match(body, /PROOF-OK/);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });

  test('missing chromium is REFUSED by name, never a silent skip or a crash', () => {
    const d = tree(CI_OK);
    installedInPlace(d);
    const campaign = mkdtempSync(join(tmpdir(), 'gate-stories-camp-'));
    try {
      // No FORGE_CHROMIUM_EXECUTABLE override, and this throwaway tree has no
      // real node_modules/playwright-core — chromium_path() resolves nothing.
      const r = gate([d, campaign], { FORGE_CHROMIUM_EXECUTABLE: '/no/such/chromium-binary' });
      assert.match(r.out, /^REFUSED .*gate-stories\.sh.*chromium is not installed/m, `expected a named REFUSED row; got:\n${r.out}`);
      // The step's OWN log — never gate.sh's summary line, which echoes the
      // command text (containing the story names) on every row regardless of
      // whether it ran — is what proves execution never happened.
      const logs = readdirSync(join(campaign, 'reports')).filter((f) => f.includes(basename(d)));
      const body = logs.map((f) => readFileSync(join(campaign, 'reports', f), 'utf8')).join('\n');
      assert.match(body, /^\[stories-guard\]/m);
      assert.doesNotMatch(body, /^SMOKE-OK$/m, 'a refused step must never have executed the story command');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });

  test('runs under the run-lock, and releases it — the campaign stays usable afterwards', () => {
    // WHY THIS ASSERTS ON THE PASS LINE AND THE LOG, NOT `status` — same
    // reason gate.test.ts's REFUSING_CI/FAILING_CI doors do: this synthetic
    // tree is not a real forge checkout, so `prod-lines.mjs` alone makes the
    // overall exit nonzero for a reason that has nothing to do with this step.
    const d = tree(CI_OK);
    installedInPlace(d);
    const campaign = mkdtempSync(join(tmpdir(), 'gate-stories-camp-'));
    try {
      const r = gate([d, campaign], { FORGE_CHROMIUM_EXECUTABLE: '/bin/true' });
      assert.match(r.out, /^PASS .*gate-stories\.sh/m, `expected the stories step to pass; got:\n${r.out}`);
      const logs = readdirSync(join(campaign, 'reports')).filter((f) => f.includes(basename(d)));
      const body = logs.map((f) => readFileSync(join(campaign, 'reports', f), 'utf8')).join('\n');
      assert.match(body, /with-locks: \.run-lock taken/, 'the step must actually take the run-lock, not merely be told its name');
      assert.match(body, /with-locks: command exited 0; releasing/, 'and release it on the way out');
      // Released means takeable again right now.
      const stillLocked = spawnSync('flock', ['-n', join(campaign, '.run-lock'), 'true']).status !== 0;
      assert.equal(stillLocked, false, '.run-lock outlived the step that took it');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });

  test('under an ancestor-held suite-lock (heavy-slot\'s own shape), the step still completes — never a re-take, never a deadlock', () => {
    const d = tree(CI_OK);
    installedInPlace(d);
    const campaign = mkdtempSync(join(tmpdir(), 'gate-stories-camp-'));
    writeFileSync(join(campaign, '.suite-lock'), '');
    try {
      // `gate.sh`'s own ancestor-detection (suite_lock_state) is exercised by
      // its sibling doors; this one is narrower and asks only the question
      // THIS bead adds: does the stories step, nested two processes under
      // that hold, still finish promptly rather than waiting out the
      // suite-lock bound on a lock its own ancestor holds.
      const argv = [GATE, d, campaign].map((a) => JSON.stringify(a)).join(' ');
      const cmd =
        `exec 8>${JSON.stringify(join(campaign, '.suite-lock'))}; flock -n 8 || { echo NOFLOCK; exit 9; }; ` +
        `bash ${argv} 8>&-`;
      const r = spawnSync('bash', ['-c', cmd], {
        encoding: 'utf8',
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true' }),
        timeout: 20_000,
      });
      assert.notEqual(r.status, null, `the gate under ancestor hold timed out: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout ?? '', /^PASS .*gate-stories\.sh/m, `expected the stories step to pass; got:\n${r.stdout}${r.stderr}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });
});

describe('gate-stories.sh — called directly', () => {
  function runIt(cmd: string, env: Record<string, string> = {}) {
    const r = spawnSync('bash', [GATE_STORIES, cmd], { encoding: 'utf8', env: strippedEnv(env) });
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  }

  test('runs the joined command when chromium is present and no campaign is named', () => {
    const r = runIt('echo AAA && echo BBB', { FORGE_CHROMIUM_EXECUTABLE: '/bin/true' });
    assert.equal(r.status, 0, r.out + r.err);
    assert.match(r.out, /AAA/);
    assert.match(r.out, /BBB/);
  });

  test('exits 75 and names the guard when chromium is missing — never runs the command', () => {
    const r = runIt('echo SHOULD-NOT-RUN', { FORGE_CHROMIUM_EXECUTABLE: '/no/such/path' });
    assert.equal(r.status, 75);
    assert.match(r.out, /^\[stories-guard\]/m);
    assert.doesNotMatch(r.out, /SHOULD-NOT-RUN/);
  });

  test('a real failure in the joined command propagates its own exit code, not 75', () => {
    const r = runIt('echo ok && exit 7', { FORGE_CHROMIUM_EXECUTABLE: '/bin/true' });
    assert.equal(r.status, 7);
  });
});
