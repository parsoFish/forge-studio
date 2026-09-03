/**
 * Ruling 85 (T1, 2026-09-04) — nested `_logs/` runtime state is never tracked.
 *
 * PR #341 committed four files under `packages/flows/_logs/`: the output of the
 * four flows tests that resolve their event-log root against the PROCESS CWD
 * (bead `forge-8vfn.5.53`, known-flakes #8). They reached the tree because
 * `.gitignore`'s `_logs/*` row contains a slash and is therefore anchored to
 * the repository root — `packages/<x>/_logs/` matched nothing at all.
 *
 * The ignore rows are the fix; this file is what keeps them honest. It is a
 * RATCHET, not a one-time check: clause 3 enumerates the index and fails on any
 * nested `_logs/` path, so the next cwd-relative run cannot re-commit residue
 * even if the rows are later edited or reordered. Clause 2 is the negative
 * control that the fix did not overreach — the root `_logs/.gitkeep` is a
 * TRACKED structural file and must stay visible to git.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `git check-ignore` exits 1 when the path is NOT ignored — that is data, not an error. */
function isIgnored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', relPath], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err;
  }
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('nested _logs runtime state is ignored and untracked (ruling 85)', () => {
  test('a workspace-scoped run\'s _logs output is ignored under every workspace glob', () => {
    // The exact shape bead 5.53 produces, plus one for the apps/* workspace glob.
    for (const planted of [
      'packages/flows/_logs/TEST-p4-arch-1385995-1788442447280/events.jsonl',
      'packages/flows/_logs/TEST-p4-legacy-1385995-1788442447290/report.md',
      'packages/sessions/_logs/anything/at/all.jsonl',
      'apps/studio/_logs/whatever.jsonl',
    ]) {
      assert.equal(isIgnored(planted), true, `${planted} must be ignored`);
    }
  });

  test('the root _logs structural files are NOT ignored and stay tracked', () => {
    assert.equal(isIgnored('_logs/.gitkeep'), false, '_logs/.gitkeep must remain visible to git');
    assert.equal(isIgnored('_logs/README.md'), false, '_logs/README.md must remain visible to git');
    // ...and the root row still ignores root runtime state.
    assert.equal(isIgnored('_logs/some-cycle/events.jsonl'), true);

    assert.ok(
      trackedFiles().includes('_logs/.gitkeep'),
      '_logs/.gitkeep must still be tracked — the ignore rows must not have swept it',
    );
  });

  test('RATCHET: no nested _logs path is tracked in the index', () => {
    const nested = trackedFiles().filter(
      (path) => path.includes('/_logs/') && !path.startsWith('_logs/'),
    );
    assert.deepEqual(
      nested,
      [],
      'nested _logs residue is committed — a workspace-scoped test run wrote it (bead forge-8vfn.5.53); ' +
        'git rm the paths rather than widening this assertion',
    );
  });
});
