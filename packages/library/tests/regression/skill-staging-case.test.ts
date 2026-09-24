/**
 * VOLUME CASE-BEHAVIOUR DETECTION acceptance tests for
 * `packages/library/skill-staging.ts` (bead forge-gp4, P2 — the verbatim
 * mirror of `packages/agents/materials-staging.ts`'s forge-qn8 fix, adapted
 * where the two modules genuinely differ; see `skill-staging.ts`'s own
 * docstring for why a straight copy-paste of the probe call site was wrong).
 *
 * The defect: `stageSkillPackage`'s within-one-call duplicate-target guard
 * keyed `seenTargets` by the LITERAL `realPath` string returned by
 * `resolveGuardedPath` — which, for a not-yet-existing leaf (the common
 * case: a fresh skill install), is reassembled literally, NOT case-folded.
 * On a case-folding volume (macOS APFS default, Windows NTFS, some SMB/NTFS
 * mounts) two entries whose targets differ only by letter case
 * (`SKILL.md` vs `skill.md`) resolve to the SAME on-disk file, but the
 * literal comparison sees two distinct keys, so the duplicate slips through
 * Phase 1 and Phase 2's second `writeFileSync` silently clobbers the first.
 *
 * THE SECOND WRINKLE gp4 flags beyond qn8: whether to have `stageSkillPackage`
 * itself create `stagingRoot` before probing it (a naive copy of the probe
 * call would throw `ENOENT`/"containment root does not exist" on a
 * not-yet-created root). RESOLVED as a PRECONDITION instead, exactly mirroring
 * `stageMaterials`'s own documented contract for `runDir`: the real production
 * caller (`bridge-studio-skills.ts`) already `mkdirSync`s `stagingRoot` before
 * every call (verified on this tree), so `stageSkillPackage` keeps Phase 1
 * genuinely zero-side-effect and simply documents the precondition rather
 * than defensively creating the root itself — the PRECONDITION test below
 * pins that a caller violating it still fails cleanly (the module's own
 * typed error, not a raw fs crash), not that it silently succeeds.
 *
 * Same honest constraint as materials-staging-case.test.ts: this dev machine
 * is WSL2/ext4 (case-sensitive), so the FOLDING branch is driven
 * deterministically via the injectable `options.probeCaseFolding` seam, and
 * the load-bearing assertion is the ALL-OR-NOTHING artifact (existsSync), not
 * merely the throw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stageSkillPackage, SkillStagingError } from '../../skill-staging.ts';
import type { CaseFoldingProbe } from '../../skill-staging.ts';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const SOURCE_ID = 'srv-stamp-1';

function freshStagingRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `skill-staging-case-${prefix}-`));
}

const FORCE_FOLDS: CaseFoldingProbe = () => true;
const FORCE_SENSITIVE: CaseFoldingProbe = () => false;

test('FOLDING (injected): two entries differing only by case ("SKILL.md", "skill.md") in ONE call are refused as duplicates when the probe reports folding', () => {
  const stagingRoot = freshStagingRoot('folding-dup');
  try {
    assert.throws(
      () => stageSkillPackage(
        stagingRoot,
        SOURCE_ID,
        [
          { path: 'SKILL.md', contentBase64: b64('FIRST-VERSION') },
          { path: 'skill.md', contentBase64: b64('SECOND-VERSION-WOULD-SILENTLY-WIN-ON-A-REAL-FOLDING-VOLUME') },
        ],
        { probeCaseFolding: FORCE_FOLDS },
      ),
      SkillStagingError,
      'expected a SkillStagingError once the probe reports this volume folds case',
    );
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test('FOLDING (injected): the artifact, not just the throw — after the folding-duplicate refusal above, NEITHER spelling landed on disk', () => {
  const stagingRoot = freshStagingRoot('folding-dup-artifact');
  try {
    assert.throws(() => stageSkillPackage(
      stagingRoot,
      SOURCE_ID,
      [
        { path: 'SKILL.md', contentBase64: b64('FIRST-VERSION') },
        { path: 'skill.md', contentBase64: b64('SECOND-VERSION') },
      ],
      { probeCaseFolding: FORCE_FOLDS },
    ), SkillStagingError);

    assert.equal(existsSync(join(stagingRoot, SOURCE_ID, 'SKILL.md')), false, 'the first spelling must not exist on disk after a refused call');
    assert.equal(existsSync(join(stagingRoot, SOURCE_ID, 'skill.md')), false, 'the second spelling must not exist on disk after a refused call');
    assert.equal(existsSync(join(stagingRoot, SOURCE_ID)), false, '<sourceId>/ itself must not have been created for an entirely-refused call');
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test('NEGATIVE: on a case-SENSITIVE volume (forced via injection), "SKILL.md" and "skill.md" are two legitimate distinct targets and BOTH stage successfully, byte-exact', () => {
  const stagingRoot = freshStagingRoot('sensitive-both-ok');
  try {
    assert.doesNotThrow(() => stageSkillPackage(
      stagingRoot,
      SOURCE_ID,
      [
        { path: 'SKILL.md', contentBase64: b64('CONTENT-UPPER') },
        { path: 'skill.md', contentBase64: b64('CONTENT-lower') },
      ],
      { probeCaseFolding: FORCE_SENSITIVE },
    ));
    assert.equal(readFileSync(join(stagingRoot, SOURCE_ID, 'SKILL.md'), 'utf8'), 'CONTENT-UPPER');
    assert.equal(readFileSync(join(stagingRoot, SOURCE_ID, 'skill.md'), 'utf8'), 'CONTENT-lower');
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test('PRECONDITION (green-lock): a stagingRoot that does not exist yet is refused with the module\'s OWN SkillStagingError, not a raw fs crash — pins the contract a violating caller fails cleanly against, since the real caller (bridge-studio-skills.ts) always mkdirSync\'s stagingRoot first rather than this function defending against it itself', () => {
  const parent = mkdtempSync(join(tmpdir(), 'skill-staging-case-precondition-'));
  const stagingRoot = join(parent, '_skill-staging');
  try {
    assert.equal(existsSync(stagingRoot), false, 'precondition: stagingRoot must not exist yet');
    assert.throws(
      () => stageSkillPackage(stagingRoot, SOURCE_ID, [
        { path: 'SKILL.md', contentBase64: b64('name: X\ndescription: y\n---\n\nbody\n') },
      ]),
      SkillStagingError,
      'a caller that violates the stagingRoot-must-exist precondition must still see the module\'s own typed error',
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
