/**
 * forge-mfv5.1.52: `scopeEntryWorktreeErrors` — a submitted `files_in_scope`
 * entry judged against a real worktree on disk, per door (Kickoff carries
 * `creates`; a typed send-back does not). The containment cases plant a
 * symlink to a directory OUTSIDE the worktree: the kernel path guard must make
 * it read exactly as an absent path (no existence oracle across the root).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createsEntryWorktreeErrors, scopeEntryWorktreeErrors } from '../../scope-entry-worktree.ts';

function withWorktree(fn: (wt: string, outside: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'scope-entry-wt-'));
  const wt = join(root, 'wt'), outside = join(root, 'outside');
  for (const d of [join(wt, 'tests', 'acceptance'), join(wt, 'docs'), join(outside, 'secret')]) mkdirSync(d, { recursive: true });
  for (const f of [join(wt, 'tests', 'conftest.py'), join(wt, 'pyproject.toml'), join(outside, 'secret', 'key.txt')]) writeFileSync(f, 'x\n');
  symlinkSync(outside, join(wt, 'escape'));
  try { fn(wt, outside); } finally { rmSync(root, { recursive: true, force: true }); }
}

const KICKOFF = { door: 'kickoff' as const, creates: [] as string[] };
const SEND_BACK = { door: 'send-back' as const };

test('existing file and directory-with-slash pass at both doors; lexically unsafe entries are left to scopeEntryErrors', () => withWorktree((wt) => {
  for (const door of [KICKOFF, SEND_BACK]) {
    assert.deepEqual(scopeEntryWorktreeErrors(wt, ['tests/', 'docs/', 'tests/acceptance/', 'tests/conftest.py', 'pyproject.toml'], door), []);
    assert.deepEqual(scopeEntryWorktreeErrors(wt, ['../outside/', '/etc/passwd', 'a b'], door), [], 'named by the lexical check, not twice');
  }
}));

test('a directory without its slash, a file with one, and non-normalised forms are refused with the corrected form', () => withWorktree((wt) => {
  const errs = scopeEntryWorktreeErrors(wt, ['tests', 'pyproject.toml/', './docs/', 'tests//conftest.py', '.'], SEND_BACK);
  assert.deepEqual(errs, [
    'files_in_scope entry "tests" refused: is a directory — did you mean "tests/"?',
    'files_in_scope entry "pyproject.toml/" refused: is a file, not a directory — did you mean "pyproject.toml"?',
    'files_in_scope entry "./docs/" refused: is not a normalised path — did you mean "docs/"?',
    'files_in_scope entry "tests//conftest.py" refused: is not a normalised path — did you mean "tests/conftest.py"?',
    'files_in_scope entry "." refused: names the worktree root — name a directory inside it as "d/"',
  ]);
}));

test('Kickoff: an absent file passes only when listed under creates', () => withWorktree((wt) => {
  assert.match(scopeEntryWorktreeErrors(wt, ['tests/test_new.py'], KICKOFF)[0]!, /not in the worktree — list a file this work item creates under creates too, or name its existing directory as "tests\/"/);
  assert.deepEqual(scopeEntryWorktreeErrors(wt, ['tests/test_new.py'], { door: 'kickoff', creates: ['tests/test_new.py'] }), []);
  assert.match(scopeEntryWorktreeErrors(wt, ['newdir/'], { door: 'kickoff', creates: ['newdir/'] })[0]!, /"newdir\/" refused: not in the worktree — name an existing directory/, 'creates never vouches for a directory');
}));

test('send-back: an absent file passes when its parent directory exists (incl. the root); otherwise the deepest existing directory is named', () => withWorktree((wt) => {
  assert.deepEqual(scopeEntryWorktreeErrors(wt, ['tests/acceptance/test_new.py', 'requirements.txt'], SEND_BACK), []);
  assert.deepEqual(scopeEntryWorktreeErrors(wt, ['tests/unit/test_x.py', 'gone/deeper/x.py', 'tests/unit/'], SEND_BACK), [
    'files_in_scope entry "tests/unit/test_x.py" refused: not in the worktree and neither is its directory — name its existing directory as "tests/"',
    'files_in_scope entry "gone/deeper/x.py" refused: not in the worktree and neither is its directory — name an existing directory with a trailing slash',
    'files_in_scope entry "tests/unit/" refused: not in the worktree — name its existing directory as "tests/"',
  ]);
}));

test('containment: a symlink out of the worktree reads exactly as an absent path — no existence oracle, no pass', () => withWorktree((wt) => {
  for (const door of [KICKOFF, SEND_BACK]) {
    const viaLink = scopeEntryWorktreeErrors(wt, ['escape/', 'escape/secret/', 'escape/secret/key.txt'], door);
    const absent = scopeEntryWorktreeErrors(wt, ['nolink/', 'nolink/secret/', 'nolink/secret/key.txt'], door);
    assert.equal(viaLink.length, 3, 'every entry through the link is refused');
    assert.deepEqual(viaLink.map((e) => e.replaceAll('escape', 'nolink')), absent, 'byte-identical to an absent path');
  }
}));

test('a wildcard is refused at both doors (the gate would honour it; the door asks for a directory or the files)', () => withWorktree((wt) => {
  for (const door of [KICKOFF, SEND_BACK]) {
    assert.deepEqual(scopeEntryWorktreeErrors(wt, ['tests/*.py'], door), ['files_in_scope entry "tests/*.py" refused: is a wildcard — name a directory as "d/" or each file']);
  }
}));

test('Kickoff creates: a directory, a non-normalised path or a wildcard is refused — creates is read by the gate first', () => withWorktree((wt) => {
  assert.deepEqual(createsEntryWorktreeErrors(wt, ['tests/test_new.py', 'pyproject.toml']), []);
  assert.deepEqual(createsEntryWorktreeErrors(wt, ['tests', 'newdir/', './x.py', 'a//b.py', 'tests/*.py']), [
    'creates entry "tests" refused: is a directory — creates names the files the work item writes',
    'creates entry "newdir/" refused: is a directory — creates names the files the work item writes',
    'creates entry "./x.py" refused: is not a normalised path — did you mean "x.py"?',
    'creates entry "a//b.py" refused: is not a normalised path — did you mean "a/b.py"?',
    'creates entry "tests/*.py" refused: is a wildcard — creates names each file',
  ]);
}));
