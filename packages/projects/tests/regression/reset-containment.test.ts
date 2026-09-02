/**
 * Adversarial containment review (skill: `adversarial-containment-review`) —
 * `computeContractDrift`/`applyContractReset` treat `projectDir` as the
 * TRUSTED root (the same convention every sibling package function uses —
 * `loadProjectConfig`, `runPreflight`, `deriveContractStages`), so the attack
 * surface this module actually owns is the SEGMENTS it builds WITHIN that
 * root from data an attacker can reach by writing a malicious
 * `.forge/project.json` through the (looser) Studio PUT route:
 * `skills[]` entries (`parseSkills` only checks "array of strings" — no
 * slug-shape validation at all) and `artifactRoot` (already validated as a
 * clean relative path by `parseArtifactRoot`, but re-attacked here too for
 * defense-in-depth).
 *
 * Every case below names the ESCAPE SHAPE it attacks, and asserts the
 * FILESYSTEM STATE after the call — not merely that nothing threw/returned
 * oddly — mirroring `packages/kernel/path-guard-rename.test.ts`'s own
 * standard for `guardedRename` (the primitive every relocation in this
 * module goes through; ruling 3, no second move path is written here).
 *
 * SHAPES ATTACKED: a symlinked skill SOURCE directory pointing outside the
 * project; a symlinked `.forge/skills` DESTINATION PARENT pointing outside
 * the project; a bound skill id shaped like `..`; a skill entry that is a
 * DANGLING symlink (at both the canonical and the alternate location).
 * Every one is closed by the existing `resolveGuardedPath`/`guardedFile`/
 * `guardedRename` machinery this module routes every segment through — see
 * the per-test note for which guard check closes it. None required new
 * containment code in `reset.ts` itself; that is the intended outcome of
 * building on `@forge/kernel`'s already-reviewed primitives rather than a
 * second move/probe path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { PathGuardContainmentError } from '@forge/kernel';

function isolatedForgeRoot(): string {
  // No starters needed for these attacks (the skills mechanism doesn't
  // consult the starter at all) — an empty forgeRoot resolves `appType: null`
  // gracefully, which is itself part of what's being proven safe.
  return mkdtempSync(join(tmpdir(), 'reset-attack-forge-'));
}

function baseConfig(over: Record<string, unknown>): Record<string, unknown> {
  return { name: 'attack-fixture', testProcess: { local: { cmd: ['echo', 'ok'] } }, artifactRoot: 'forge', ...over };
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function snapshot(root: string): string[] {
  try {
    return (readdirSync(root, { recursive: true } as { recursive: true }) as string[]).sort();
  } catch {
    return [];
  }
}

test('SHAPE: a symlinked skill SOURCE directory pointing outside the project is never followed', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = mkdtempSync(join(tmpdir(), 'reset-attack-project-'));
  const outside = mkdtempSync(join(tmpdir(), 'reset-attack-outside-'));
  try {
    writeFileSync(join(outside, 'SKILL.md'), '# stolen\n', 'utf8');
    mkdirSync(join(projectDir, 'forge', 'skills'), { recursive: true });
    // 'evil' is a SYMLINK pointing outside the project, not a real dir.
    symlinkSync(outside, join(projectDir, 'forge', 'skills', 'evil'));
    writeConfig(projectDir, baseConfig({ skills: ['evil'] }));

    const drift = computeContractDrift(projectDir, { forgeRoot });
    const move = drift.skillMoves.find((m) => m.id === 'evil');
    assert.ok(move, 'the id must still be named — never silently dropped');
    assert.equal(move!.from, null, 'the guard must reject the symlinked source — reported as "no source found", never followed');

    const outsideBefore = snapshot(outside);
    const result = applyContractReset(projectDir, drift);
    assert.equal(result.skillMovesApplied.length, 0, 'nothing may be moved through a rejected source');
    assert.deepEqual(snapshot(outside), outsideBefore, 'the outside target must be completely untouched');
    assert.equal(existsSync(join(projectDir, '.forge', 'skills', 'evil')), false, 'nothing may land at the destination either');
    assert.ok(lstatSync(join(projectDir, 'forge', 'skills', 'evil')).isSymbolicLink(), 'the planted symlink itself must be untouched');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SHAPE: a symlinked `.forge/skills` DESTINATION PARENT pointing outside the project fails the whole apply closed', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = mkdtempSync(join(tmpdir(), 'reset-attack-project-'));
  const outside = mkdtempSync(join(tmpdir(), 'reset-attack-outside-'));
  try {
    // A real, drifted skill that WOULD move if the destination were legitimate.
    mkdirSync(join(projectDir, 'forge', 'skills', 'goodid'), { recursive: true });
    writeFileSync(join(projectDir, 'forge', 'skills', 'goodid', 'SKILL.md'), '# goodid\n', 'utf8');
    // `.forge` is real; `.forge/skills` is a SYMLINK pointing outside.
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    symlinkSync(outside, join(projectDir, '.forge', 'skills'));
    writeConfig(projectDir, baseConfig({ skills: ['goodid'] }));

    const drift = computeContractDrift(projectDir, { forgeRoot });
    const move = drift.skillMoves.find((m) => m.id === 'goodid');
    assert.ok(move, 'the drift is still correctly computed as pure filesystem READS (the symlinked skills dir has no real goodid entry, so the guarded probe just reports "not resolved")');
    assert.equal(move!.from, 'forge/skills/goodid');

    const outsideBefore = snapshot(outside);
    assert.throws(
      () => applyContractReset(projectDir, drift),
      PathGuardContainmentError,
      'a symlinked .forge/skills destination parent must fail the whole apply closed, never partially write through it',
    );
    assert.deepEqual(snapshot(outside), outsideBefore, 'nothing may be written through the symlinked destination parent');
    assert.equal(existsSync(join(projectDir, 'forge', 'skills', 'goodid', 'SKILL.md')), true, 'the source must be untouched — the rejection happens before any move');
    assert.ok(lstatSync(join(projectDir, '.forge', 'skills')).isSymbolicLink(), 'the planted symlink itself must be untouched');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SHAPE: a bound skill id shaped like ".." can never select a path outside .forge/skills', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = mkdtempSync(join(tmpdir(), 'reset-attack-project-'));
  try {
    // A real, sensitive file one level above .forge/skills that a traversal
    // id would target if `isSafeSegment` did not reject it outright.
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    writeFileSync(join(projectDir, '.forge', 'sensitive.txt'), 'do-not-touch', 'utf8');
    writeConfig(projectDir, baseConfig({ skills: ['..'] }));

    const before = snapshot(projectDir);
    const drift = computeContractDrift(projectDir, { forgeRoot });
    const move = drift.skillMoves.find((m) => m.id === '..');
    assert.ok(move, 'a malformed id must still be named, not silently dropped from the report');
    assert.equal(move!.from, null, 'a ".." id can never resolve as "found" at either location — isSafeSegment rejects it before any real path is touched');

    const result = applyContractReset(projectDir, drift);
    assert.equal(result.skillMovesApplied.length, 0, 'nothing is moved for an id with no resolved source');
    assert.deepEqual(snapshot(projectDir), before, 'the project tree is completely unchanged by a malformed id');
    assert.equal(readFileSync(join(projectDir, '.forge', 'sensitive.txt'), 'utf8'), 'do-not-touch');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('SHAPE: a dangling symlink at a skill location (canonical or alternate) is never mistaken for a resolved/movable skill', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = mkdtempSync(join(tmpdir(), 'reset-attack-project-'));
  try {
    mkdirSync(join(projectDir, '.forge', 'skills'), { recursive: true });
    mkdirSync(join(projectDir, 'forge', 'skills'), { recursive: true });
    // Dangling at the CANONICAL location.
    symlinkSync(join(projectDir, '.forge', 'skills', 'does-not-exist-1'), join(projectDir, '.forge', 'skills', 'dangling-canonical'));
    // Dangling at the ALTERNATE (artifactRoot) location.
    symlinkSync(join(projectDir, 'forge', 'skills', 'does-not-exist-2'), join(projectDir, 'forge', 'skills', 'dangling-alt'));
    writeConfig(projectDir, baseConfig({ skills: ['dangling-canonical', 'dangling-alt'] }));

    const before = snapshot(projectDir);
    const drift = computeContractDrift(projectDir, { forgeRoot });

    const canonical = drift.skillMoves.find((m) => m.id === 'dangling-canonical');
    assert.ok(canonical, 'a dangling entry at the canonical location must still be named (it does not count as resolved)');
    assert.equal(canonical!.from, null, 'a dangling symlink is never treated as a legitimate move source');

    const alt = drift.skillMoves.find((m) => m.id === 'dangling-alt');
    assert.ok(alt, 'a dangling entry at the alternate location must still be named');
    assert.equal(alt!.from, null, 'a dangling symlink at the alternate location is never reported as "found"');

    const result = applyContractReset(projectDir, drift);
    assert.equal(result.skillMovesApplied.length, 0);
    assert.deepEqual(snapshot(projectDir), before, 'nothing is moved, created, or deleted for either dangling entry');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
