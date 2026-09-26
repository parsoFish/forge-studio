/**
 * alignment.test.ts — forge-1rk5.2 (plan D7): does a story's `aligns` claim
 * still match what's on disk.
 *
 * `checkAlignment(repoRoot)` is pure filesystem: no git. It is exercised here
 * two ways — a synthetic mkdtemp repo (the proof: OK, then RED on one changed
 * byte, item 3) and the REAL repo (so this test carries the gate in
 * `npm test`, item 2 — today it passes trivially, since no story yet
 * authors a real `aligns` entry, M7-D being mechanism-only).
 *
 * `intakeReport(repoRoot, sinceSha)` is the `--intake` arm and DOES use git;
 * it is exercised against a synthetic git repo built with `execFileSync`,
 * the same pattern `among-rule.test.ts` uses for `trackedProjectIds`.
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
import { digest16, checkAlignment, intakeReport } from './alignment.mjs';

const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A minimal story file, written to `<dir>/tests/stories/<id>.story.mjs`. */
function writeStory(dir: string, id: string, aligns?: unknown) {
  mkdirSync(join(dir, 'tests', 'stories'), { recursive: true });
  const body = `export default ${JSON.stringify({
    id,
    ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to', title: 't' },
    beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    ...(aligns === undefined ? {} : { aligns }),
  })};\n`;
  writeFileSync(join(dir, 'tests', 'stories', `${id}.story.mjs`), body);
}

function writeAdr(dir: string, rel: string, body: string) {
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

test('digest16 is the first 16 hex chars of the sha256 of the bytes', () => {
  const d = digest16(Buffer.from('hello world'));
  assert.match(d, /^[0-9a-f]{16}$/);
  // sha256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
  assert.equal(d, 'b94d27b9934d3e08');
});

test('checkAlignment: a story with no aligns at all checks nothing and passes', async () => {
  const dir = scratch('alignment-none-');
  writeStory(dir, 'S1');
  const result = await checkAlignment(dir);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.failures, []);
});

test('checkAlignment: a correctly stamped digest passes; one changed byte REDs, naming the story and the ADR path', async () => {
  const dir = scratch('alignment-proof-');
  writeAdr(dir, 'docs/decisions/900-fixture.md', '# A fixture ADR\n\nSome content.\n');
  const digest = digest16(readFileSync(join(dir, 'docs/decisions/900-fixture.md')));
  writeStory(dir, 'S1', [{ path: 'docs/decisions/900-fixture.md', digest, why: 'S1 proves the pattern this ADR pins.' }]);

  const ok = await checkAlignment(dir);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
  assert.equal(ok.checked, 1);

  // Edit one byte of the cited ADR.
  writeAdr(dir, 'docs/decisions/900-fixture.md', '# A fixture ADR\n\nSome CONTENT.\n');
  const red = await checkAlignment(dir);
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

test('checkAlignment: a cited file that is MISSING REDs, naming the story and the path', async () => {
  const dir = scratch('alignment-missing-');
  writeStory(dir, 'S1', [{ path: 'docs/decisions/does-not-exist.md', digest: '0123456789abcdef', why: 'x' }]);
  const result = await checkAlignment(dir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].storyId, 'S1');
  assert.equal(result.failures[0].path, 'docs/decisions/does-not-exist.md');
  assert.equal(result.failures[0].current, null);
  assert.match(result.failures[0].message, /MISSING/);
  rmSync(dir, { recursive: true, force: true });
});

test('checkAlignment against the REAL repo passes — the gate this test carries into npm test', async () => {
  const result = await checkAlignment(REAL_ROOT);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
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

test('--intake: an ADR and a brain theme added since the pin, cited by nothing, both report', async () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/decisions/910-new.md', '# New ADR\n', 'add adr');
  commit(dir, 'brain/forge-dev/themes/2026-09-26-new-theme.md', '# New theme\n', 'add theme');

  const { added, unaligned } = await intakeReport(dir, since);
  assert.deepEqual(added.sort(), ['brain/forge-dev/themes/2026-09-26-new-theme.md', 'docs/decisions/910-new.md']);
  assert.deepEqual(unaligned.sort(), ['brain/forge-dev/themes/2026-09-26-new-theme.md', 'docs/decisions/910-new.md']);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: a doc a story already cites in aligns is not reported', async () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/decisions/910-new.md', '# New ADR\n', 'add adr');
  const digest = digest16(readFileSync(join(dir, 'docs/decisions/910-new.md')));
  writeStory(dir, 'S1', [{ path: 'docs/decisions/910-new.md', digest, why: 'cites it' }]);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'add story']);

  const { added, unaligned } = await intakeReport(dir, since);
  assert.deepEqual(added, ['docs/decisions/910-new.md']);
  assert.deepEqual(unaligned, []);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: a doc named in the README out-of-scope list is not reported', async () => {
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

  const { added, unaligned } = await intakeReport(dir, since);
  assert.deepEqual(added, ['docs/decisions/910-new.md']);
  assert.deepEqual(unaligned, []);

  rmSync(dir, { recursive: true, force: true });
});

test('--intake: report only — never throws for an unaligned finding, and adds nothing outside docs/decisions or brain/forge-dev/themes', async () => {
  const dir = gitRepo();
  const since = headSha(dir);
  commit(dir, 'docs/how-to/unrelated.md', '# Not in scope\n', 'add howto');
  const { added, unaligned } = await intakeReport(dir, since);
  assert.deepEqual(added, []);
  assert.deepEqual(unaligned, []);
  rmSync(dir, { recursive: true, force: true });
});
