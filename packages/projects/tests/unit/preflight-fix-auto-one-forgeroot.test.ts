/**
 * C4's auto-fix writes to TWO roots, and they must be the same one
 * (bead `forge-8vfn.6.11.26`, T1 ruling 309 — "ONE forgeRoot for every Brain 3
 * write").
 *
 * WHAT HAPPENED. S1 run 5 (M5-B session 8) called `fixArchContext` ONCE and it
 * wrote to two different trees:
 *
 *   roadmap.md -> join(projectDir, 'roadmap.md')          -> the lane's ground   (right)
 *   profile.md -> projectBrainDir(forgeRoot, projectName) -> the MAIN checkout   (wrong)
 *
 * `/home/parso/forge/brain/projects/gitweave/profile.md` appeared at 22:09:21Z
 * inside the run's window, in a tree the run does not own. Its own content
 * named the writer: "Stub scaffolded by forge preflight auto-fix (Brain 3 —
 * forge-owned central project brain, ADR 035)". The story runner's fence
 * reported `fence: clean` in that same run, because the fence only ever
 * inspected its own worktree.
 *
 * WHY A PAIR CHECK AND NOT A CALLER FIX. `roadmap.md` lives INSIDE the project;
 * Brain 3 is CENTRAL (ADR 035) and lives under `forgeRoot`. So the two
 * arguments are only coherent when `forgeRoot` is the root that actually
 * manages `projectDir`. Rather than guess which of the several callers passed
 * the mismatched pair — the CLI `chdir`s to `FORGE_ROOT` at startup, so the
 * obvious cwd explanation does NOT hold, and the writer is still unattributed —
 * this makes the incoherent pair impossible to write from, and say so by name.
 * A guard that refuses the shape catches every caller, including the one that
 * has not been identified.
 *
 * The skip is surfaced, not swallowed: `applyPreflightAutoFixes` already routes
 * `ok: false` into `skipped[]` with its reason, which the CLI and the bridge
 * both print.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPreflightAutoFixes } from '../../preflight-fix-auto.ts';
import type { ClauseResult } from '../../preflight.ts';

/** The one failing AUTO clause this test drives. */
const C4_FAILING: ClauseResult[] = [
  {
    clause: 'C4',
    title: 'Machine-readable architecture context',
    hard: true,
    pass: false,
    detail: 'missing brain/projects/p/profile.md',
  },
];

/** A forge root with `projects/<name>` under it, and the project dir. */
function makeRoot(name: string): { forgeRoot: string; projectDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-root-'));
  const projectDir = join(forgeRoot, 'projects', name);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'README.md'), '# p\n');
  return { forgeRoot, projectDir };
}

test('309: a forgeRoot that does not manage the project cannot receive its Brain 3 stub', () => {
  const owner = makeRoot('p');
  // A second, unrelated forge install — the main checkout, in the incident.
  const stranger = mkdtempSync(join(tmpdir(), 'forge-stranger-'));

  const result = applyPreflightAutoFixes({
    projectDir: owner.projectDir,
    forgeRoot: stranger,
    clauses: C4_FAILING,
  });

  // Nothing scattered into the tree that does not own the project.
  assert.equal(existsSync(join(stranger, 'brain', 'projects', 'p', 'profile.md')), false);

  // And it REFUSED out loud rather than quietly doing nothing — the skip names
  // both roots, so the next incident is attributable from one log line.
  assert.equal(result.applied.find((a) => a.clause === 'C4'), undefined);
  const skip = result.skipped.find((s) => s.clause === 'C4');
  assert.ok(skip, 'C4 must be reported as skipped');
  assert.ok(skip.reason.includes(stranger), 'the skip names the foreign forgeRoot');
  assert.ok(skip.reason.includes(owner.projectDir), 'the skip names the project it refused');
});

test('309: the owning forgeRoot still gets the stub — the guard refuses mismatches, not the fix', () => {
  const owner = makeRoot('p');

  const result = applyPreflightAutoFixes({
    projectDir: owner.projectDir,
    forgeRoot: owner.forgeRoot,
    clauses: C4_FAILING,
  });

  const profile = join(owner.forgeRoot, 'brain', 'projects', 'p', 'profile.md');
  assert.ok(existsSync(profile), 'the coherent pair must still scaffold Brain 3');
  assert.ok(readFileSync(profile, 'utf8').includes('p'));

  // roadmap.md is the project-local half and lands either way.
  assert.ok(existsSync(join(owner.projectDir, 'roadmap.md')));

  assert.ok(result.applied.find((a) => a.clause === 'C4'), 'C4 applied');
  assert.equal(result.skipped.find((s) => s.clause === 'C4'), undefined);
});
