/**
 * `checkStaleness`'s prefix set must FOLLOW THE TREE — bead `forge-8vfn.5.24`.
 *
 * The defect: the prefix set was an inline literal
 * (`docs/|orchestrator/|skills/|loops/`), correct when written. The M2–M4 moves
 * then put most of forge's source under `packages/` and `apps/`, and every
 * citation to a path there stopped being staleness-checked — with nothing red,
 * because a check that never looks reports no findings and a check that reports
 * no findings looks like a passing check. 25 of the 35 flags on the tree at the
 * time were legacy citations the check could still see; the ones it could not
 * see were invisible by construction.
 *
 * Two kinds of assertion here, and the difference matters:
 *   - POSITIVE CONTROL (§1): a citation under `packages/` that MUST be flagged.
 *     Run it against the pre-fix prefix set and it fails. That is the whole
 *     point — a path-keyed ratchet that cannot be made to fire is not a ratchet.
 *   - COVERAGE (§2): the set is checked against the ACTUAL top-level directories
 *     of the repo, so the next move cannot silently re-open the same hole. This
 *     is what "follows the tree" means operationally: not a wider literal, but a
 *     literal a test refuses to let fall behind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkStaleness,
  STALENESS_PREFIXES,
  STALENESS_PREFIX_EXCLUSIONS,
} from '../../brain-lint.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

/**
 * A forge sub-wiki theme (`brain/cycles/themes/…`) citing `cited`. Only a FORGE
 * theme's citation is treated as a forge path, so the fixture has to be one —
 * a project theme would be skipped before the prefix set is ever consulted.
 */
function seedThemeCiting(cited: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-staleness-prefix-'));
  const themes = join(root, 'brain', 'cycles', 'themes');
  mkdirSync(themes, { recursive: true });
  writeFileSync(
    join(themes, 'a-theme.md'),
    [
      '---',
      'title: A theme',
      'description: cites a path',
      'category: pattern',
      'created_at: 2026-01-01',
      'updated_at: 2026-01-01',
      '---',
      '',
      `The interesting bit lives in \`${cited}\`.`,
      '',
    ].join('\n'),
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function staleCitations(root: string): string[] {
  return checkStaleness(root)
    .filter((f) => f.check === 'checkStaleness')
    .map((f) => f.message.replace(/^stale citation \(missing\): /, ''));
}

// ---------------------------------------------------------------------------
// §1 THE POSITIVE CONTROL — this is the case the pre-fix prefix set could not
// see. Restore `['docs/','orchestrator/','skills/','loops/']` in brain-lint.ts
// and this test fails; that failure is the proof the ratchet fires.
// ---------------------------------------------------------------------------

test('5.24 POSITIVE CONTROL: a missing `packages/` citation IS flagged (the pre-fix prefix set reported nothing here)', () => {
  const { root, cleanup } = seedThemeCiting('packages/knowledge/no-such-file.ts');
  try {
    assert.deepEqual(staleCitations(root), ['packages/knowledge/no-such-file.ts']);
  } finally {
    cleanup();
  }
});

test('5.24 POSITIVE CONTROL: a missing `apps/` citation IS flagged', () => {
  const { root, cleanup } = seedThemeCiting('apps/forge/no-such-file.ts');
  try {
    assert.deepEqual(staleCitations(root), ['apps/forge/no-such-file.ts']);
  } finally {
    cleanup();
  }
});

test('5.24 NEGATIVE CONTROL: a `packages/` citation that EXISTS is not flagged — the widened set catches staleness, not everything', () => {
  const { root, cleanup } = seedThemeCiting('packages/knowledge/brain-lint.ts');
  try {
    // Resolved against the fixture root, where the file does not exist…
    assert.deepEqual(staleCitations(root), ['packages/knowledge/brain-lint.ts']);
    // …and against the real forge root, where it does. Same citation, opposite
    // verdict: the check is testing existence, not matching a prefix.
    const realFindings = checkStaleness(FORGE_ROOT)
      .filter((f) => f.check === 'checkStaleness')
      .map((f) => f.message);
    assert.ok(
      !realFindings.some((m) => m.endsWith('packages/knowledge/brain-lint.ts')),
      'a citation to a file that exists must not be flagged',
    );
  } finally {
    cleanup();
  }
});

test('5.24 a wildcard citation is a PATTERN, never existence-checked — `scripts/*.mjs` names a set and would flag forever', () => {
  const { root, cleanup } = seedThemeCiting('scripts/*.mjs');
  try {
    assert.deepEqual(staleCitations(root), []);
  } finally {
    cleanup();
  }
});

test('5.24 `projects/` stays out: a managed-project clone is absent on a cold checkout, so flagging it would depend on the machine', () => {
  const { root, cleanup } = seedThemeCiting('projects/gitpulse/src/index.ts');
  try {
    assert.deepEqual(staleCitations(root), []);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// §2 COVERAGE — the set follows the tree, enforced rather than asserted in a
// comment. This is the assertion that would have caught the original defect at
// the moment the move happened, instead of two milestones later.
// ---------------------------------------------------------------------------

test('5.24 COVERAGE: every tracked top-level source directory is either in the prefix set or in the named exclusion list', () => {
  const excluded = new Set<string>(STALENESS_PREFIX_EXCLUSIONS);
  const covered = new Set(STALENESS_PREFIXES.map((p) => p.replace(/\/$/, '')));

  const topLevelDirs = readdirSync(FORGE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // Not part of the repo's own source: dependency and build output, and the
    // scratch dirs a run leaves behind.
    .filter((n) => !['node_modules', '.git', '_walkthrough', '_worktrees'].includes(n));

  const uncovered = topLevelDirs.filter((n) => !covered.has(n) && !excluded.has(n));
  assert.deepEqual(
    uncovered,
    [],
    `top-level director${uncovered.length === 1 ? 'y' : 'ies'} neither covered nor excluded: ${uncovered.join(', ')}. ` +
      'A citation under a directory in neither list is never staleness-checked — add it to FORGE_INTERNAL_PREFIXES, ' +
      'or to STALENESS_PREFIX_EXCLUSIONS with the reason it cannot be checked.',
  );
});

test('5.24 COVERAGE: the two lists are disjoint, so no directory is both claimed and excused', () => {
  const excluded = new Set<string>(STALENESS_PREFIX_EXCLUSIONS);
  const both = STALENESS_PREFIXES.map((p) => p.replace(/\/$/, '')).filter((n) => excluded.has(n));
  assert.deepEqual(both, []);
});
