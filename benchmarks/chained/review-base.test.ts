/**
 * Deterministic regression tests for chained-bench FALSE-RED **Bug A**, proven
 * against a PRESERVED real paid-run tempdir (run-4).
 *
 * The real run proved forge works end-to-end: architect → PM → dev-loop
 * produced a working tested slugifier, review-Ralph converged to approve +
 * opened the PR. But the chained bench MISREAD the review artifacts and scored
 * review = 0. This is a harness path bug, NOT a forge bug and NOT LLM
 * stochasticity — so it is deterministically reproducible from the preserved
 * artifacts with NO SDK call and NO paid run.
 *
 *   Bug A — `score.ts` handed the review rubric `resolve(forgeSnapshotDir,
 *           '..')` = the tempdir root, where `<root>/.forge/pr-description.md`
 *           does NOT exist (the snapshot IS the `.forge/` contents) →
 *           every pr_ / demo_ criterion scored 0.
 *
 * Fixture: /tmp/forge-bench-chained-cxi6td/ (do not mutate or delete). These
 * tests COPY what they need into their own tempdir. If the fixture is absent
 * (other machine / CI / it was cleaned), the fixture-bound assertions skip —
 * the synthetic-layout assertions still run so the logic is always covered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  cleanupReviewBaseDir,
  resolveReviewBaseDir,
} from './review-base.ts';
import { caseScore as reviewCaseScore } from '../review-loop/scoring.ts';
import { readWorkItemsFromDir } from '../../orchestrator/work-item.ts';

const PRESERVED = '/tmp/forge-bench-chained-cxi6td';
const INITIATIVE_ID = 'INIT-2026-05-17-canonical-slugifier';
const FIXTURE_PRESENT = existsSync(PRESERVED);

const SKIP_MSG =
  `preserved run-4 fixture absent at ${PRESERVED} ` +
  '(fixture-bound assertion skipped; synthetic-layout coverage still runs)';

/**
 * Copy the slices of the preserved run we need into a throwaway tempdir,
 * laid out exactly as `runChain` leaves them. NEVER touches the fixture.
 */
function stagePreservedRun(): {
  worktreePath: string;
  forgeSnapshotDir: string;
  cleanup: () => void;
} {
  const tempdir = mkdtempSync(join(tmpdir(), 'forge-frA-stage-'));
  const worktreePath = resolve(tempdir, 'projects', 'slugifier');
  const forgeSnapshotDir = resolve(tempdir, '_forge-snapshot');

  mkdirSync(resolve(worktreePath, '.forge'), { recursive: true });
  cpSync(
    resolve(PRESERVED, 'projects', 'slugifier', '.forge'),
    resolve(worktreePath, '.forge'),
    { recursive: true },
  );
  cpSync(resolve(PRESERVED, '_forge-snapshot'), forgeSnapshotDir, {
    recursive: true,
  });
  return {
    worktreePath,
    forgeSnapshotDir,
    cleanup: () => rmSync(tempdir, { recursive: true, force: true }),
  };
}

const REVIEW_EXPECTED = {
  project_type: 'lib' as const,
  quality_gate_cmd: ['true'],
  is_stacked_pr: false,
};

test('Bug A repro: the OLD `forgeSnapshotDir/..` choice scores review 0 on REAL artifacts (the false-red)', () => {
  if (!FIXTURE_PRESENT) return assert.ok(true, SKIP_MSG);
  const staged = stagePreservedRun();
  try {
    const wi = readWorkItemsFromDir(
      resolve(staged.forgeSnapshotDir, 'work-items'),
    ).items;
    assert.ok(wi.length > 0, 'preserved run produced work items');

    // Exactly what score.ts USED to do: snapshot's parent = tempdir root,
    // where `<root>/.forge/pr-description.md` does not exist.
    const buggyDir = resolve(staged.forgeSnapshotDir, '..');
    const s = reviewCaseScore({
      worktreePath: buggyDir,
      initiativeId: INITIATIVE_ID,
      workItems: wi,
      expected: REVIEW_EXPECTED,
      qualityGatesPassed: true,
    });
    assert.equal(s.pr_description_present, false, 'old path → PR not found');
    assert.equal(s.score, 0, 'old path scores 0 — the documented false-red');
    assert.equal(s.criteria.demo_recording_present, 0);
    assert.equal(s.criteria.pr_description_why_not_what, 0);
    assert.equal(s.criteria.pr_links_demo, 0);
  } finally {
    staged.cleanup();
  }
});

test('Bug A fix (worktree-.forge layout): resolveReviewBaseDir → worktree; review scores > 0 on REAL artifacts', () => {
  if (!FIXTURE_PRESENT) return assert.ok(true, SKIP_MSG);
  const staged = stagePreservedRun();
  let handle = null as ReturnType<typeof resolveReviewBaseDir> | null;
  try {
    const wi = readWorkItemsFromDir(
      resolve(staged.forgeSnapshotDir, 'work-items'),
    ).items;

    handle = resolveReviewBaseDir({
      worktreePath: staged.worktreePath,
      forgeSnapshotDir: staged.forgeSnapshotDir,
    });
    // Worktree `.forge/` is intact → use it directly (no synthesis).
    assert.equal(handle.dir, staged.worktreePath);
    assert.equal(handle.synthesized, false);
    assert.equal(
      existsSync(resolve(handle.dir, '.forge', 'pr-description.md')),
      true,
      '<dir>/.forge/pr-description.md resolves',
    );

    const s = reviewCaseScore({
      worktreePath: handle.dir,
      initiativeId: INITIATIVE_ID,
      workItems: wi,
      expected: REVIEW_EXPECTED,
      qualityGatesPassed: true,
    });
    // The load-bearing assertion: the criteria the false-red zeroed are now > 0.
    assert.equal(s.criteria.demo_recording_present, 1, 'demo_recording_present > 0');
    assert.equal(
      s.criteria.pr_description_why_not_what,
      1,
      'pr_description_why_not_what > 0',
    );
    assert.equal(
      s.criteria.pr_description_length_floor,
      1,
      'pr_description_length_floor > 0',
    );
    assert.equal(s.criteria.pr_links_demo, 1, 'pr_links_demo > 0');
    assert.equal(s.pr_description_present, true);
    assert.ok(
      s.pr_body_chars >= 4000,
      `real PR body is ~4305 bytes (got ${s.pr_body_chars})`,
    );
    assert.ok(s.score > 0, 'review scores > 0 (was the false-red 0)');
    assert.equal(
      s.passed,
      true,
      'review passes its 0.7 threshold on the real artifacts',
    );
  } finally {
    cleanupReviewBaseDir(handle);
    staged.cleanup();
  }
});

test('Bug A fix (snapshot layout — worktree .forge wiped by gh-shim git clean): synthesized dir; review scores > 0', () => {
  if (!FIXTURE_PRESENT) return assert.ok(true, SKIP_MSG);
  const staged = stagePreservedRun();
  let handle = null as ReturnType<typeof resolveReviewBaseDir> | null;
  try {
    const wi = readWorkItemsFromDir(
      resolve(staged.forgeSnapshotDir, 'work-items'),
    ).items;

    // Simulate the gh-shim's post-merge `git clean -fdX` wiping the
    // gitignored worktree `.forge/` — only the durable snapshot remains.
    rmSync(resolve(staged.worktreePath, '.forge'), {
      recursive: true,
      force: true,
    });
    assert.equal(
      existsSync(resolve(staged.worktreePath, '.forge', 'pr-description.md')),
      false,
      'worktree .forge is gone (clean simulated)',
    );

    handle = resolveReviewBaseDir({
      worktreePath: staged.worktreePath,
      forgeSnapshotDir: staged.forgeSnapshotDir,
    });
    assert.equal(handle.synthesized, true, 'fell back to a synthesized dir');
    assert.notEqual(handle.dir, staged.worktreePath);
    assert.equal(
      existsSync(resolve(handle.dir, '.forge', 'pr-description.md')),
      true,
      'synthesized <dir>/.forge/pr-description.md resolves (symlink → snapshot)',
    );

    const s = reviewCaseScore({
      worktreePath: handle.dir,
      initiativeId: INITIATIVE_ID,
      workItems: wi,
      expected: REVIEW_EXPECTED,
      qualityGatesPassed: true,
    });
    assert.equal(s.criteria.demo_recording_present, 1);
    assert.equal(s.criteria.pr_description_why_not_what, 1);
    assert.equal(s.criteria.pr_links_demo, 1);
    assert.ok(s.score > 0, 'review scores > 0 via the snapshot fallback too');
    assert.equal(s.passed, true);
  } finally {
    cleanupReviewBaseDir(handle);
    staged.cleanup();
  }
});

test('resolveReviewBaseDir: synthesized handle is cleaned up; non-synthesized (worktree) is NEVER deleted', () => {
  // Synthetic — runs even without the preserved fixture.
  const root = mkdtempSync(join(tmpdir(), 'forge-frA-cleanup-'));
  try {
    // Case 1: worktree .forge present → no synthesis, worktree preserved.
    const wt = resolve(root, 'wt');
    mkdirSync(resolve(wt, '.forge'), { recursive: true });
    writeFileSync(resolve(wt, '.forge', 'pr-description.md'), '# PR\n');
    const h1 = resolveReviewBaseDir({
      worktreePath: wt,
      forgeSnapshotDir: resolve(root, '_forge-snapshot'),
    });
    assert.equal(h1.synthesized, false);
    cleanupReviewBaseDir(h1);
    assert.equal(existsSync(wt), true, 'worktree NOT deleted by cleanup');
    assert.equal(
      existsSync(resolve(wt, '.forge', 'pr-description.md')),
      true,
      'worktree .forge intact after cleanup',
    );

    // Case 2: worktree .forge absent, snapshot present → synthesized + cleaned.
    const snap = resolve(root, '_forge-snapshot');
    mkdirSync(snap, { recursive: true });
    writeFileSync(resolve(snap, 'pr-description.md'), '# PR\n');
    const h2 = resolveReviewBaseDir({
      worktreePath: resolve(root, 'no-such-wt'),
      forgeSnapshotDir: snap,
    });
    assert.equal(h2.synthesized, true);
    const synthDir = h2.dir;
    assert.equal(
      existsSync(synthDir),
      true,
      'synthesized dir exists before cleanup',
    );
    cleanupReviewBaseDir(h2);
    assert.equal(
      existsSync(synthDir),
      false,
      'synthesized dir removed by cleanup',
    );
    assert.equal(
      existsSync(snap),
      true,
      'snapshot (symlink target) NOT removed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
