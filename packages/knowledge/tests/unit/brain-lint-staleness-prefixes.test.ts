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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

test('5.43 the two PRODUCT-CREATED roots stay out: `_interactive-library/` and `_skill-staging/` exist only where forge has been RUN, so a citation there would flag on an operator machine and not in CI', () => {
  for (const cited of ['_interactive-library/auth-skill/SKILL.md', '_skill-staging/auth-skill/SKILL.md']) {
    const { root, cleanup } = seedThemeCiting(cited);
    try {
      assert.deepEqual(staleCitations(root), [], `${cited} must not be staleness-checked`);
    } finally {
      cleanup();
    }
  }
  // …and the exclusion is NAMED, not an accident of the prefix set: §2's
  // coverage test can only pass because these two are on the excusal list.
  const excluded = new Set<string>(STALENESS_PREFIX_EXCLUSIONS);
  assert.ok(excluded.has('_interactive-library') && excluded.has('_skill-staging'));
});

// ---------------------------------------------------------------------------
// §2 COVERAGE — the set follows the tree, enforced rather than asserted in a
// comment. This is the assertion that would have caught the original defect at
// the moment the move happened, instead of two milestones later.
// ---------------------------------------------------------------------------

/**
 * The repo's TRACKED top-level directories, from the index — which is what this
 * section's title has always claimed and what a `readdirSync` of `FORGE_ROOT`
 * cannot answer.
 *
 * The filesystem reading needed a hardcoded skip list (`node_modules`, `.git`,
 * `_walkthrough`, `_worktrees`) and therefore asserted against every OTHER
 * untracked directory as if it were repo source. Bead `forge-8vfn.6.10.25`: it
 * reds a green tree twice over — the main checkout carries the gitignored
 * campaign directory, and a run leaves `_logs`-adjacent scratch behind — and it
 * has never once red in CI, whose checkout has none of them. A coverage check
 * that fails on the operator's machine and passes in CI teaches people to
 * ignore it.
 *
 * `git ls-files` is the same enumeration `check-identity.mjs` and
 * `check-docs-claims.mjs` already use, and it FAILS LOUD: a broken git read must
 * not read as "no directories to cover", which is §15.92's shape and would make
 * this coverage test vacuous exactly when it stopped working.
 */
export function trackedTopLevelDirs(): string[] {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: FORGE_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ls-files failed in ${FORGE_ROOT} (exit ${r.status}): ${String(r.stderr).trim()}`);
  }
  const dirs = new Set<string>();
  for (const path of r.stdout.split('\0')) {
    const slash = path.indexOf('/');
    if (slash > 0) dirs.add(path.slice(0, slash));
  }
  if (dirs.size === 0) throw new Error(`git ls-files listed no directories under ${FORGE_ROOT} — the enumeration is broken, not the tree`);
  return [...dirs].sort();
}

test('5.24 COVERAGE: the population is the INDEX, not the filesystem — an untracked directory is not repo source', () => {
  // The defect this replaces: the check `readdirSync`d FORGE_ROOT and filtered a
  // hardcoded list of four untracked names, so every OTHER untracked directory
  // was asserted against as if it were source. It red a green tree twice (the
  // main checkout carries a gitignored campaign dir; a run leaves scratch dirs)
  // and never once red in CI, whose checkout has neither.
  const dirs = trackedTopLevelDirs();
  assert.ok(dirs.includes('packages'), 'a tracked source directory must be in the population');
  assert.ok(dirs.includes('docs'), 'and so must docs');
  // `node_modules` exists on disk in every working checkout and is tracked in
  // none. Under the filesystem reading it was excluded only by being named in a
  // literal; under the index it cannot appear at all.
  assert.ok(!dirs.includes('node_modules'), 'an untracked directory that EXISTS must not be in the population');
  assert.ok(!dirs.includes('.git'), 'nor .git, which is not even a directory in a worktree');
});

test('5.24 COVERAGE: every tracked top-level source directory is either in the prefix set or in the named exclusion list', () => {
  const excluded = new Set<string>(STALENESS_PREFIX_EXCLUSIONS);
  const covered = new Set(STALENESS_PREFIXES.map((p) => p.replace(/\/$/, '')));

  const topLevelDirs = trackedTopLevelDirs();

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
