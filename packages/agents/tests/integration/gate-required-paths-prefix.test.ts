/**
 * forge-mfv5.1.52 (lane scope-prefix): a `files_in_scope` entry ending in `/`
 * is a DIRECTORY scope and the required-paths tightening must match any diff
 * path under it. Measured on gitweave I4 (2026-10-17): WI-13 declared
 * `gitweave/ tests/ docs/`, iterations 2 and 3 edited
 * `tests/acceptance/test_gw_overlay_two_modules.py` and the demo guide under `docs/`,
 * and both gates were refused −3 `required-paths-missing` because the check
 * looked each entry up in the diff as an exact path. The fixture below is that
 * WI's shape on a real git repo, through the real gate (`makeQualityGateFromCmd`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { makeQualityGateFromCmd, type GateRunInfo } from '../../ralph/stop-conditions.ts';

const WI_13_SCOPE = ['gitweave/', 'tests/', 'docs/'] as const;
const PYTEST_GREEN = ['sh', '-c', 'echo "768 passed in 4.20s"; exit 0'];

/** A `main` baseline holding the WI-13 directories (+ a `tests_old/` decoy), then a branch that commits `changed`. */
function wi13Repo(changed: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-scope-prefix-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const put = (rel: string, body: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'forge-test');
  for (const rel of ['gitweave/__init__.py', 'tests/conftest.py', 'docs/demo-guide.md', 'tests_old/legacy.py', 'README.md']) put(rel, '# base\n');
  git('add', '.');
  git('commit', '-m', 'baseline');
  git('checkout', '-b', 'forge/wi-13');
  for (const rel of changed) put(rel, '# edited by the WI\n');
  git('add', '.');
  git('commit', '-m', 'wi-13 work');
  return dir;
}

function runGate(dir: string, requiredPaths: readonly string[]): { passed: boolean; info: GateRunInfo } {
  let info: GateRunInfo | undefined;
  const passed = makeQualityGateFromCmd(dir, PYTEST_GREEN, (i) => { info = i; }, { requiredPaths })();
  return { passed, info: info! };
}

test('WI-13 fixture: directory scopes + a diff under them → the gate passes (was −3 required-paths-missing)', () => {
  const dir = wi13Repo(['tests/acceptance/test_gw_overlay_two_modules.py', 'docs/demo-guide.md']);
  try {
    const { passed, info } = runGate(dir, WI_13_SCOPE);
    assert.equal(info.rejectReason, undefined, info.stderrTail);
    assert.equal(info.exitCode, 0);
    assert.equal(passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WI-13 fixture: a diff only OUTSIDE the scopes → −3, and the feedback lists the diff paths seen AND the entries required', () => {
  const dir = wi13Repo(['README.md', 'tests_old/legacy.py']);
  try {
    const { passed, info } = runGate(dir, WI_13_SCOPE);
    assert.equal(passed, false);
    assert.equal(info.exitCode, -3);
    assert.equal(info.rejectReason, 'required-paths-missing');
    const fb = info.stderrTail;
    for (const entry of WI_13_SCOPE) assert.match(fb, new RegExp(`- ${entry}`), `required entry ${entry} not listed`);
    assert.match(fb, /diff paths seen/i);
    assert.match(fb, /- README\.md/);
    assert.match(fb, /- tests_old\/legacy\.py/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('path boundary: "tests/" never matches "tests_old/…" (a prefix is a directory, not a substring)', () => {
  const dir = wi13Repo(['tests_old/legacy.py']);
  try {
    assert.equal(runGate(dir, ['tests/']).passed, false);
    assert.equal(runGate(dir, ['tests']).passed, false, 'a slashless entry is an exact FILE match — "tests" is no file in this diff');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control: an exact-file scope is unchanged — the named file passes, a sibling under the same directory does not', () => {
  const dir = wi13Repo(['tests/test_a.py']);
  try {
    assert.equal(runGate(dir, ['tests/test_a.py']).passed, true);
    assert.equal(runGate(dir, ['tests/test_b.py']).passed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable branch diff (no main/master) is refused BY NAME, never reported as an empty diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-scope-prefix-nogit-'));
  try {
    const { passed, info } = runGate(dir, WI_13_SCOPE);
    assert.equal(passed, false);
    assert.equal(info.rejectReason, 'required-paths-missing');
    assert.match(info.stderrTail, /could not read the branch diff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a long scope (a send-back may carry 200 entries) keeps the REJECTED header inside the 4 KB gate tail', () => {
  const dir = wi13Repo(['README.md']);
  try {
    const many = Array.from({ length: 40 }, (_, i) => `gitweave/very/long/module/path/number_${i}_${'x'.repeat(60)}.py`);
    const { passed, info } = runGate(dir, many);
    assert.equal(passed, false);
    assert.match(info.stderrTail, /\[forge gate-tightening\] REJECTED/);
    assert.match(info.stderrTail, /… 20 more/);
    assert.match(info.stderrTail, /- README\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
