/**
 * alignment.test.ts — forge-1rk5.2 (plan D7), redesigned under T1 ruling
 * 1593: does a story's SIDECAR (`tests/stories/<id>.aligns.json`) claim on an
 * ADR or brain theme still match what's on disk.
 *
 * WHY A SIDECAR AND NOT A STORY-FILE FIELD (the thing this test file replaced
 * a version of). `artifact-staleness.mjs` hashes a story file's raw bytes to
 * decide whether its demo artifacts are stale; an `aligns` field living
 * inside the story file meant re-stamping a digest staled demos that no beat
 * had touched. The sidecar is its own tracked file for exactly that reason,
 * and `story-file.mjs` now carries no knowledge of `aligns` at all — this
 * module is the only place its shape is validated.
 *
 * `validateAlignsSidecar` is exercised directly (unit, no IO).
 * `checkAlignment(repoRoot)` is pure filesystem otherwise: no git. It is
 * exercised against synthetic mkdtemp repos (missing sidecar, malformed
 * sidecar, the digest-drift proof) and against the REAL repo, so this test
 * carries the gate in `npm test`.
 * `intakeReport(repoRoot, sinceSha)` is the `--intake` arm and DOES use git;
 * exercised against a synthetic git repo, the same pattern
 * `among-rule.test.ts` uses for `trackedProjectIds`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  digest16, validateAlignsSidecar, checkAlignment, intakeReport,
} from './alignment.mjs';

const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeStorySkeleton(dir: string, id: string) {
  mkdirSync(join(dir, 'tests', 'stories'), { recursive: true });
  const body = `export default ${JSON.stringify({
    id,
    ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to', title: 't' },
    beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
  })};\n`;
  writeFileSync(join(dir, 'tests', 'stories', `${id}.story.mjs`), body);
}

function writeSidecar(dir: string, id: string, body: unknown) {
  mkdirSync(join(dir, 'tests', 'stories'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'stories', `${id}.aligns.json`), JSON.stringify(body, null, 2));
}

function writeAdr(dir: string, rel: string, body: string) {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

// ── digest16 ────────────────────────────────────────────────────────────

test('digest16 is the first 16 hex chars of the sha256 of the bytes', () => {
  const d = digest16(Buffer.from('hello world'));
  assert.match(d, /^[0-9a-f]{16}$/);
  assert.equal(d, 'b94d27b9934d3e08');
});

// ── validateAlignsSidecar (shape, no IO) ───────────────────────────────────

const validEntry = {
  path: 'docs/decisions/001-claude-agent-sdk.md',
  digest: '0123456789abcdef',
  why: 'S1 demonstrates the pattern this ADR pins.',
};

test('a well-formed entries sidecar validates and comes back frozen', () => {
  const v = validateAlignsSidecar({ aligns: [validEntry] }, 'S1');
  assert.equal(v.kind, 'entries');
  assert.deepEqual(v.entries, [validEntry]);
  assert.ok(Object.isFrozen(v.entries));
  assert.ok(Object.isFrozen(v.entries[0]));
});

test('a well-formed "none" sidecar validates and comes back frozen', () => {
  const v = validateAlignsSidecar({ aligns: 'none', reason: 'harness self-check, no product decision' }, 'smoke');
  assert.deepEqual(v, { kind: 'none', reason: 'harness self-check, no product decision' });
  assert.ok(Object.isFrozen(v));
});

test('a non-object sidecar is refused, naming the story', () => {
  assert.throws(() => validateAlignsSidecar('x', 'S1'), /"S1"/);
  assert.throws(() => validateAlignsSidecar(null, 'S1'), /"S1"/);
  assert.throws(() => validateAlignsSidecar([], 'S1'), /"S1"/);
});

test('"none" with no reason is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: 'none' }, 'smoke'), /reason/);
});

test('"none" with an empty reason is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: 'none', reason: '' }, 'smoke'), /reason/);
});

test('"none" with a reason over 200 chars is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: 'none', reason: 'x'.repeat(201) }, 'smoke'), /reason/);
});

test('"none" with a multi-line reason is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: 'none', reason: 'a\nb' }, 'smoke'), /reason/);
});

test('an empty aligns array is refused — an empty declaration asserts nothing', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: [] }, 'S1'), /aligns/);
});

test('a non-array, non-"none" aligns is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: 42 }, 'S1'), /aligns/);
});

test('an entry that is not an object is refused, naming the index and the story', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: ['x'] }, 'S1'), /aligns\[0\]/);
  assert.throws(() => validateAlignsSidecar({ aligns: ['x'] }, 'S1'), /"S1"/);
});

test('an absolute entry path is refused', () => {
  assert.throws(
    () => validateAlignsSidecar({ aligns: [{ ...validEntry, path: '/docs/decisions/001-claude-agent-sdk.md' }] }, 'S1'),
    /aligns\[0\]\.path/,
  );
});

test('an entry path with .. traversal is refused', () => {
  assert.throws(
    () => validateAlignsSidecar({ aligns: [{ ...validEntry, path: 'docs/../secrets.md' }] }, 'S1'),
    /aligns\[0\]\.path/,
  );
});

test('an entry path under _1.0/ is refused, naming the field and the story', () => {
  // SCHEMA MUTATION TARGET: a validator that forgot this refusal would let a
  // permanent artifact (the sidecar) cite a path inside the gitignored
  // campaign dir, which CLAUDE.md forbids outright.
  assert.throws(
    () => validateAlignsSidecar({ aligns: [{ ...validEntry, path: '_1.0/reports/x.md' }] }, 'S1'),
    /aligns\[0\]\.path/,
  );
});

test('a digest that is not exactly 16 lowercase hex chars is refused', () => {
  for (const bad of ['0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', 'not-hex-at-all!!', '']) {
    assert.throws(
      () => validateAlignsSidecar({ aligns: [{ ...validEntry, digest: bad }] }, 'S1'),
      /aligns\[0\]\.digest/,
      `expected a refusal for digest ${JSON.stringify(bad)}`,
    );
  }
});

test('an empty why is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: [{ ...validEntry, why: '' }] }, 'S1'), /aligns\[0\]\.why/);
});

test('a why over 200 chars is refused', () => {
  assert.throws(() => validateAlignsSidecar({ aligns: [{ ...validEntry, why: 'x'.repeat(201) }] }, 'S1'), /aligns\[0\]\.why/);
});

test('a why exactly 200 chars is accepted', () => {
  const v = validateAlignsSidecar({ aligns: [{ ...validEntry, why: 'x'.repeat(200) }] }, 'S1');
  assert.equal(v.entries[0].why.length, 200);
});

test('a why containing a newline is refused', () => {
  assert.throws(
    () => validateAlignsSidecar({ aligns: [{ ...validEntry, why: 'line one\nline two' }] }, 'S1'),
    /aligns\[0\]\.why/,
  );
});

test('multiple entries all survive validation, in order', () => {
  const two = { ...validEntry, path: 'brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md', digest: 'fedcba9876543210' };
  const v = validateAlignsSidecar({ aligns: [validEntry, two] }, 'S1');
  assert.deepEqual(v.entries, [validEntry, two]);
});

// ── checkAlignment ──────────────────────────────────────────────────────

test('checkAlignment: a story sidecar declaring "none" checks nothing and passes', () => {
  const dir = scratch('alignment-none-');
  writeStorySkeleton(dir, 'S1');
  writeSidecar(dir, 'S1', { aligns: 'none', reason: 'harness proof story, no product decision' });
  const result = checkAlignment(dir);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.failures, []);
  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment: a story with NO sidecar at all REDs, naming the story — absent is never "unaligned"', () => {
  // §6.15 DOOR / MUTATION TARGET (mut-3): disabling this door must make this
  // test RED.
  const dir = scratch('alignment-absent-');
  writeStorySkeleton(dir, 'S1');
  const result = checkAlignment(dir);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].storyId, 'S1');
  assert.match(result.failures[0].message, /S1/);
  assert.match(result.failures[0].message, /NO aligns sidecar/);
  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment: a malformed sidecar (e.g. "none" with no reason) REDs, naming the story', () => {
  const dir = scratch('alignment-malformed-');
  writeStorySkeleton(dir, 'S1');
  writeSidecar(dir, 'S1', { aligns: 'none' });
  const result = checkAlignment(dir);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].storyId, 'S1');
  assert.match(result.failures[0].message, /S1/);
  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment: a correctly stamped digest passes; one changed byte REDs, naming the story and the ADR path', () => {
  const dir = scratch('alignment-proof-');
  writeStorySkeleton(dir, 'S1');
  writeAdr(dir, 'docs/decisions/900-fixture.md', '# A fixture ADR\n\nSome content.\n');
  const digest = digest16(readFileSync(join(dir, 'docs/decisions/900-fixture.md')));
  writeSidecar(dir, 'S1', { aligns: [{ path: 'docs/decisions/900-fixture.md', digest, why: 'S1 proves the pattern this ADR pins.' }] });

  const ok = checkAlignment(dir);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
  assert.equal(ok.checked, 1);

  // Edit one byte of the cited ADR.
  writeAdr(dir, 'docs/decisions/900-fixture.md', '# A fixture ADR\n\nSome CONTENT.\n');
  const red = checkAlignment(dir);
  assert.equal(red.ok, false);
  assert.equal(red.failures.length, 1);
  assert.equal(red.failures[0].storyId, 'S1');
  assert.equal(red.failures[0].path, 'docs/decisions/900-fixture.md');
  assert.equal(red.failures[0].pinned, digest);
  assert.notEqual(red.failures[0].current, digest);
  assert.match(red.failures[0].message, /S1/);
  assert.match(red.failures[0].message, /docs\/decisions\/900-fixture\.md/);
  assert.match(red.failures[0].message, /re-stamp the digest/);

  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment: a cited file that is MISSING REDs, naming the story and the path', () => {
  const dir = scratch('alignment-missing-');
  writeStorySkeleton(dir, 'S1');
  writeSidecar(dir, 'S1', { aligns: [{ path: 'docs/decisions/does-not-exist.md', digest: '0123456789abcdef', why: 'x' }] });
  const result = checkAlignment(dir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].storyId, 'S1');
  assert.equal(result.failures[0].path, 'docs/decisions/does-not-exist.md');
  assert.equal(result.failures[0].current, null);
  assert.match(result.failures[0].message, /MISSING/);
  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment against the REAL repo passes — every story has a sidecar, 59 entries, 0 drifted', () => {
  const result = checkAlignment(REAL_ROOT);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.checked, 59);
});

// ── --intake ────────────────────────────────────────────────────────────

function gitRepo(): string {
  const dir = scratch('alignment-intake-');
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'f@x.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'f']);
  mkdirSync(join(dir, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'decisions', '.gitkeep'), '');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'base']);
  return dir;
}

function commit(dir: string, rel: string, body: string, msg: string) {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
  execFileSync('git', ['-C', dir, 'add', '--', rel]);
  execFileSync('git', ['-C', dir, 'commit', '-qm', msg]);
}

function headSha(dir: string): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

test('--intake: an ADR and a brain theme added since the pin, cited by nothing, both report', () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/decisions/910-new.md', '# New ADR\n', 'add adr');
  commit(dir, 'brain/forge-dev/themes/2026-09-26-new-theme.md', '# New theme\n', 'add theme');

  const { added, unaligned } = intakeReport(dir, since);
  assert.deepEqual(added.sort(), ['brain/forge-dev/themes/2026-09-26-new-theme.md', 'docs/decisions/910-new.md']);
  assert.deepEqual(unaligned.sort(), ['brain/forge-dev/themes/2026-09-26-new-theme.md', 'docs/decisions/910-new.md']);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: a doc a sidecar already cites is not reported', () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/decisions/910-new.md', '# New ADR\n', 'add adr');
  const digest = digest16(readFileSync(join(dir, 'docs/decisions/910-new.md')));
  writeStorySkeleton(dir, 'S1');
  writeSidecar(dir, 'S1', { aligns: [{ path: 'docs/decisions/910-new.md', digest, why: 'cites it' }] });
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'add story + sidecar']);

  const { added, unaligned } = intakeReport(dir, since);
  assert.deepEqual(added, ['docs/decisions/910-new.md']);
  assert.deepEqual(unaligned, []);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: a doc named in the README out-of-scope list is not reported', () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/decisions/910-new.md', '# New ADR\n', 'add adr');
  mkdirSync(join(dir, 'tests', 'stories', 'grounds'), { recursive: true });
  writeFileSync(
    join(dir, 'tests', 'stories', 'grounds', 'README.md'),
    '# Fixture grounds\n\n## Out of story scope\n\n'
    + '- `docs/decisions/910-new.md` — deliberately out of scope for this test.\n',
  );
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'readme']);

  const { added, unaligned } = intakeReport(dir, since);
  assert.deepEqual(added, ['docs/decisions/910-new.md']);
  assert.deepEqual(unaligned, []);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: authoring targets from the README are reported, minus any a sidecar already cites', () => {
  const dir = gitRepo();
  const since = headSha(dir);
  writeAdr(dir, 'docs/decisions/920-target-a.md', '# Target A\n');
  writeAdr(dir, 'docs/decisions/921-target-b.md', '# Target B\n');
  mkdirSync(join(dir, 'tests', 'stories', 'grounds'), { recursive: true });
  writeFileSync(
    join(dir, 'tests', 'stories', 'grounds', 'README.md'),
    '# Fixture grounds\n\n## Alignment authoring targets\n\n'
    + '- `docs/decisions/920-target-a.md` — not yet cited.\n'
    + '- `docs/decisions/921-target-b.md` — not yet cited either.\n',
  );
  writeStorySkeleton(dir, 'S1');
  const digestA = digest16(readFileSync(join(dir, 'docs/decisions/920-target-a.md')));
  writeSidecar(dir, 'S1', { aligns: [{ path: 'docs/decisions/920-target-a.md', digest: digestA, why: 'now cited' }] });
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'targets + one now cited']);

  const { targets } = intakeReport(dir, since);
  assert.deepEqual(targets.map((t) => t.paths), [['docs/decisions/921-target-b.md']]);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake against the real repo prints the tracked authoring targets, report-only (exit 0)', () => {
  const { targets } = intakeReport(REAL_ROOT, 'HEAD~1');
  // Mechanism only: the six targets T1 1593 names are tracked in the README
  // and none is cited by a real sidecar yet, so all should still show up.
  const allPaths = targets.flatMap((t) => t.paths);
  assert.ok(allPaths.includes('docs/decisions/033-studio-first-flow-ux.md'));
  assert.ok(allPaths.includes('docs/decisions/029-runtime-adapters.md'));
});
