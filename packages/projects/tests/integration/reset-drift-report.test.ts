/**
 * S3 (1.0.md §3) — `computeContractDrift` is PURE: it reports the skill
 * relocations a reset WOULD make against a real, on-disk project tree, and
 * writes NOTHING. Proven by a recursive before/after filesystem snapshot
 * (every path AND every file's content, not merely "the same file count") —
 * never by trusting the function's own return value, per the task brief.
 *
 * RULING 38, M4-projects-reset (finding, not a chore): both fixtures below
 * have no persisted `appType` and neither `computeContractDrift` call passed
 * one — before fix (a) that silently guessed a starter; it now throws
 * `AppTypeUnresolvedError` instead (`reset-app-type-required.test.ts`). This
 * file's own concern (skill-relocation mechanics) is orthogonal to which
 * starter gets matched, so both calls now pass an explicit
 * `appType: 'cli'` — the operator's informed choice a fix-(a)-era
 * caller must supply — rather than relying on the pre-fix default guess.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { runPreflight, SCRATCH_PATHS } from '../../preflight.ts';
import { projectStartersDir, PathGuardContainmentError } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-drift-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

/** A real, on-disk project tree shaped like `terraform-provider-betterado`:
 *  two bound skills, one already at the resolver's canonical location, one
 *  drifted under `<artifactRoot>/skills/`, one bound-but-truly-missing
 *  (named in neither location — still drift-report-visible with `from: null`). */
function driftedProjectTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-drift-project-'));
  mkdirSync(join(dir, '.forge', 'skills', 'already-ok'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', 'already-ok', 'SKILL.md'), '# already-ok\n', 'utf8');
  mkdirSync(join(dir, 'forge', 'skills', 'drifted-one'), { recursive: true });
  writeFileSync(join(dir, 'forge', 'skills', 'drifted-one', 'SKILL.md'), '# drifted-one\n', 'utf8');
  // A supporting file alongside SKILL.md — proves the report/move concerns
  // the whole skill DIRECTORY, not merely the one file (Q1).
  writeFileSync(join(dir, 'forge', 'skills', 'drifted-one', 'helper.sh'), '#!/bin/sh\necho hi\n', 'utf8');
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      {
        name: 'drift-report-fixture',
        artifactRoot: 'forge',
        testProcess: { local: { cmd: ['echo', 'ok'] } },
        skills: ['already-ok', 'drifted-one', 'nowhere-to-be-found'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return dir;
}

/** Every path (relative to `root`) AND, for files, their content — so
 *  "writes nothing" is proven at the byte level, not just "same file list". */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (entry.isDirectory()) {
        out.set(`${rel}/`, '<dir>');
        walk(abs);
      } else if (entry.isFile()) {
        out.set(rel, readFileSync(abs, 'utf8'));
      } else {
        out.set(rel, `<other:${statSync(abs).mode}>`);
      }
    }
  };
  walk(root);
  return out;
}

test('computeContractDrift reports the skill relocations it would make, and writes NOTHING to the project tree', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = driftedProjectTree();
  try {
    const before = snapshotTree(projectDir);

    const drift = computeContractDrift(projectDir, { forgeRoot, appType: 'cli' });

    const after = snapshotTree(projectDir);
    assert.deepEqual(after, before, 'computeContractDrift must not create, modify, or delete a single byte of the project tree');

    // The report itself: correct rows, correct relocations, correctly naming
    // an id with no source anywhere.
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.ok(skillsRow, 'expected a skills row');
    assert.equal(skillsRow!.action, 'regenerate', 'a real drift exists, so the skills row must not read unchanged');

    const byId = new Map(drift.skillMoves.map((m) => [m.id, m]));
    assert.equal(byId.size, 2, `expected 2 skill-move entries (already-ok resolves cleanly and is never listed), got: ${[...byId.keys()].join(', ')}`);
    assert.equal(byId.get('already-ok'), undefined, 'an already-resolved skill must not appear in skillMoves at all');

    const drifted = byId.get('drifted-one');
    assert.ok(drifted, 'drifted-one must be named');
    assert.equal(drifted!.from, 'forge/skills/drifted-one', 'the source path found must be named exactly');
    assert.equal(drifted!.to, '.forge/skills/drifted-one', 'the destination must be the resolver-scanned path');

    const missing = byId.get('nowhere-to-be-found');
    assert.ok(missing, 'a bound id with no source anywhere must still be named, never silently dropped');
    assert.equal(missing!.from, null, 'no source was found for this id — honestly reported as null, not a fabricated guess');
    assert.equal(missing!.to, '.forge/skills/nowhere-to-be-found');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('computeContractDrift on an undrifted project (nothing to move) reports skills unchanged and an empty skillMoves', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-drift-clean-'));
  try {
    mkdirSync(join(dir, '.forge', 'skills', 'toc-anchor-rules'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'toc-anchor-rules', 'SKILL.md'), '# toc-anchor-rules\n', 'utf8');
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'mdtoc-shaped', testProcess: { local: { cmd: ['npm', 'test'] } }, skills: ['toc-anchor-rules'] }, null, 2)}\n`,
      'utf8',
    );

    const drift = computeContractDrift(dir, { forgeRoot, appType: 'cli' });
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.equal(skillsRow!.action, 'unchanged');
    assert.deepEqual(drift.skillMoves, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── operator ruling 92 follow-up (bead forge-8vfn.8.1.2): .gitignore drift ──
//
// A bare, starter-less forgeRoot (`resolveAppType` degrades every mode to
// 'protected' and never throws — the same fixture shape
// `reset-preservation.test.ts`'s "with NO starters at all" case uses) so
// these tests isolate the .gitignore mechanism from the JSON-regeneration
// concern entirely.

/** A minimal contract-valid project (no starters needed) whose `.gitignore`
 *  is exactly `lines`. */
function projectWithGitignore(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-gitignore-project-'));
  writeFileSync(join(dir, '.gitignore'), `${lines.join('\n')}\n`);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify({ name: 'gi-fixture', testProcess: { local: { cmd: ['true'] } } }, null, 2)}\n`,
  );
  return dir;
}

/** Same fixture, but a REAL git repo — exercises `computeGitignoreDrift`'s
 *  git-truth branch (glob/negation forms a text-only scan cannot judge). */
function projectWithGitignoreGitRepo(lines: string[]): string {
  const dir = projectWithGitignore(lines);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}

test('computeContractDrift: a blanket .forge/ line proposes the SCRATCH_PATHS stanza in its place, comments preserved verbatim', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const before = ['node_modules/', '# forge scratch — DO NOT EDIT', '.forge/', 'dist/'];
  const dir = projectWithGitignore(before);
  try {
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'regenerate', `expected regenerate: ${JSON.stringify(drift.gitignoreDrift)}`);
    assert.equal(drift.gitignoreDrift.before, `${before.join('\n')}\n`);
    const afterLines = (drift.gitignoreDrift.after ?? '').split('\n');
    assert.ok(afterLines.includes('node_modules/'), 'unrelated lines survive verbatim');
    assert.ok(afterLines.includes('# forge scratch — DO NOT EDIT'), 'comments survive verbatim, even ones now describing the old policy');
    assert.ok(afterLines.includes('dist/'), 'lines after the offender survive verbatim');
    assert.ok(!afterLines.includes('.forge/'), 'the blanket-ignore line itself is gone');
    for (const p of SCRATCH_PATHS) assert.ok(afterLines.includes(p), `missing SCRATCH_PATHS entry ${p} in: ${afterLines.join(', ')}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeContractDrift: a project already on the canonical stanza reports gitignoreDrift unchanged', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignore(['node_modules/', ...SCRATCH_PATHS]);
  try {
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'unchanged');
    assert.equal(drift.gitignoreDrift.before, drift.gitignoreDrift.after);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeContractDrift: no .gitignore at all reports gitignoreDrift unchanged with before/after undefined (out of this mechanism\'s scope)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = mkdtempSync(join(tmpdir(), 'reset-gitignore-nogi-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'x', testProcess: { local: { cmd: ['true'] } } }));
  try {
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.deepEqual(drift.gitignoreDrift, { before: undefined, after: undefined, action: 'unchanged', otherSourceViolations: [] });
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyContractReset: rewrites .gitignore to the canonical stanza, and preflight C2 flips FAIL → PASS (keeps S3\'s post-reset "preflight MET" true)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignore(['node_modules/', '.forge/']);
  try {
    const before = runPreflight(dir, { forgeRoot });
    const c2Before = before.clauses.find((c) => c.clause === 'C2');
    assert.equal(c2Before?.pass, false, `fixture precondition: C2 must fail before reset — got: ${c2Before?.detail}`);

    const drift = computeContractDrift(dir, { forgeRoot });
    const result = applyContractReset(dir, drift);
    assert.equal(result.gitignoreFixed, true);

    const onDisk = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.equal(onDisk, drift.gitignoreDrift.after, 'the on-disk file must match the proposed drift exactly');

    const c2After = result.preflight.clauses.find((c) => c.clause === 'C2');
    assert.equal(c2After?.pass, true, `C2 must pass after reset: ${c2After?.detail}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyContractReset: a project already on the stanza leaves .gitignore untouched and reports gitignoreFixed: false', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignore(['node_modules/', ...SCRATCH_PATHS]);
  try {
    const giBefore = readFileSync(join(dir, '.gitignore'), 'utf8');
    const drift = computeContractDrift(dir, { forgeRoot });
    const result = applyContractReset(dir, drift);
    assert.equal(result.gitignoreFixed, false);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), giBefore, 'an already-conformant .gitignore must not be rewritten (idempotent apply)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── SEC review follow-up (forge-8vfn.8.1.2): computeGitignoreDrift hardening ──

test('SECURITY: a .gitignore symlinked to a file OUTSIDE the project throws a named containment refusal — never reads its content', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const outside = mkdtempSync(join(tmpdir(), 'reset-gitignore-outside-'));
  const SECRET = 'LEAK-CANARY-gi-symlink-7f3a';
  writeFileSync(join(outside, 'secret.txt'), `${SECRET}\n.forge/\n`);
  const dir = mkdtempSync(join(tmpdir(), 'reset-gitignore-symlink-project-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'x', testProcess: { local: { cmd: ['true'] } } }));
  symlinkSync(join(outside, 'secret.txt'), join(dir, '.gitignore'));
  try {
    let thrown: unknown;
    try {
      computeContractDrift(dir, { forgeRoot });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof PathGuardContainmentError, `expected a PathGuardContainmentError, got: ${thrown}`);
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    assert.equal(msg.includes(SECRET), false, `the refusal must never carry the symlink target's content: ${msg}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FAIL-OPEN: an unreadable (chmod 000) .gitignore is surfaced by name, never collapsed to "unchanged"', (t) => {
  if (process.getuid && process.getuid() === 0) {
    t.skip('running as root — chmod 000 does not block reads, the door cannot be exercised');
    return;
  }
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignore(['node_modules/', '.forge/']);
  try {
    chmodSync(join(dir, '.gitignore'), 0o000);
    assert.throws(
      () => computeContractDrift(dir, { forgeRoot }),
      (err: unknown) => {
        // Must NOT be the pre-fix silent "unchanged" behaviour — a throw at
        // all already proves that; also pin it is not a containment refusal
        // (permission, not containment) so the two failure modes stay distinct.
        assert.ok(!(err instanceof PathGuardContainmentError), 'an EACCES must not masquerade as a containment refusal');
        assert.match(String(err), /EACCES|permission/i, `expected the permission error to be named: ${err}`);
        return true;
      },
    );
  } finally {
    chmodSync(join(dir, '.gitignore'), 0o644);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ONE NOTION WITH C2: a `.forge/*` glob line is detected by git-truth and rewritten (a text-only scan would miss it)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignoreGitRepo(['node_modules/', '.forge/*']);
  try {
    const before = runPreflight(dir, { forgeRoot });
    assert.equal(before.clauses.find((c) => c.clause === 'C2')?.pass, false, 'fixture precondition: C2 must fail on .forge/*');

    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'regenerate', `expected regenerate: ${JSON.stringify(drift.gitignoreDrift)}`);
    assert.ok(!(drift.gitignoreDrift.after ?? '').includes('.forge/*'), 'the glob line must be gone');

    const result = applyContractReset(dir, drift);
    const c2After = result.preflight.clauses.find((c) => c.clause === 'C2');
    assert.equal(c2After?.pass, true, `C2 must pass after reset: ${c2After?.detail}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ONE NOTION WITH C2: a `.forge/**` glob line is detected by git-truth and rewritten', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignoreGitRepo(['node_modules/', '.forge/**']);
  try {
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'regenerate', `expected regenerate: ${JSON.stringify(drift.gitignoreDrift)}`);
    assert.ok(!(drift.gitignoreDrift.after ?? '').includes('.forge/**'), 'the glob line must be gone');

    const result = applyContractReset(dir, drift);
    const c2After = result.preflight.clauses.find((c) => c.clause === 'C2');
    assert.equal(c2After?.pass, true, `C2 must pass after reset: ${c2After?.detail}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ONE NOTION WITH C2: a negated re-include (`!.forge/skills/`) keeps working — skills is not treated as offending', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignoreGitRepo(['node_modules/', '.forge/*', '!.forge/skills/']);
  try {
    const drift = computeContractDrift(dir, { forgeRoot });
    // project.json/quality_gate_cmd are still ignored by `.forge/*` — regenerate expected.
    assert.equal(drift.gitignoreDrift.action, 'regenerate', `expected regenerate: ${JSON.stringify(drift.gitignoreDrift)}`);
    // The negation line for skills must survive untouched — this mechanism
    // must not blanket-strip every `.forge`-prefixed line, only the ones
    // git-truth actually names as offending.
    assert.ok((drift.gitignoreDrift.after ?? '').includes('!.forge/skills/'), 'the negated re-include line must survive');

    const result = applyContractReset(dir, drift);
    const c2After = result.preflight.clauses.find((c) => c.clause === 'C2');
    assert.equal(c2After?.pass, true, `C2 must pass after reset: ${c2After?.detail}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ONE NOTION WITH C2: an ignore from .git/info/exclude (not the project\'s own .gitignore) is named, never rewritten', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-gitignore-nostarters-'));
  const dir = projectWithGitignoreGitRepo(['node_modules/', ...SCRATCH_PATHS]);
  try {
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '.forge/\n');
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.otherSourceViolations.length > 0, true, 'the .git/info/exclude violation must be named');
    assert.match(drift.gitignoreDrift.otherSourceViolations.join('; '), /\.git\/info\/exclude/);
    // Never rewritten: this mechanism owns exactly the project's own .gitignore.
    assert.equal(drift.gitignoreDrift.action, 'unchanged', 'the project\'s own .gitignore has nothing to rewrite');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
