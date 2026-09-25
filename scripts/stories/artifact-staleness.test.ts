/**
 * artifact-staleness.test.ts — staleArtifacts NAMES a committed demo artifact
 * whose story file has moved on; it never reds.
 *
 * Findings row 56 + row 14, T1 ruling 1283 (option B). Every artifact
 * committed before this bead has no `storyDigest` at all, so a gate here
 * would fail every existing story at once for a change nobody made — hence
 * "never a gate, only a name", proven by the CLI exit-code test below run
 * against this actual checkout, which today has exactly that shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { staleArtifacts, shortDigest } from './artifact-staleness.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artifact-staleness-'));
  mkdirSync(join(root, 'tests', 'stories'), { recursive: true });
  return root;
}

function plantStory(root, id, bytes) {
  writeFileSync(join(root, 'tests', 'stories', `${id}.story.mjs`), bytes);
}

function plantArtifact(root, id, data) {
  mkdirSync(join(root, 'demos', 'stories', id), { recursive: true });
  writeFileSync(join(root, 'demos', 'stories', id, 'story.json'), JSON.stringify(data));
}

test('a story file whose committed artifact has NO digest is named — recorded before provenance', () => {
  const root = fixture();
  try {
    plantStory(root, 'SX', 'export default { id: "SX" };\n');
    plantArtifact(root, 'SX', { story: { id: 'SX' } }); // no storyDigest at all
    const stale = staleArtifacts(root);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, 'SX');
    assert.match(stale[0].reason, /no digest — recorded before provenance/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a story file whose digest no longer matches its committed artifact is named stale', () => {
  const root = fixture();
  try {
    const bytes = 'export default { id: "SX", beats: [{}] };\n'; // CHANGED since the artifact was written
    plantStory(root, 'SX', bytes);
    plantArtifact(root, 'SX', { story: { id: 'SX' }, storyDigest: 'deadbeef00000000', git: { sha: 'abc1234' } });
    const stale = staleArtifacts(root);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, 'SX');
    assert.equal(stale[0].reason, 'stale since abc1234');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a story file whose digest matches its committed artifact is NOT named', () => {
  const root = fixture();
  try {
    const bytes = 'export default { id: "SX" };\n';
    plantStory(root, 'SX', bytes);
    plantArtifact(root, 'SX', { story: { id: 'SX' }, storyDigest: shortDigest(bytes), git: { sha: 'abc1234' } });
    assert.deepEqual(staleArtifacts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a story file with no committed artifact yet is not a finding — nothing to compare', () => {
  const root = fixture();
  try {
    plantStory(root, 'BRAND-NEW', 'export default { id: "BRAND-NEW" };\n');
    assert.deepEqual(staleArtifacts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a root with no tests/stories/ at all reports nothing, rather than throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-staleness-empty-'));
  try {
    assert.deepEqual(staleArtifacts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stale sha of "unknown" is used when the artifact carries no git.sha', () => {
  const root = fixture();
  try {
    const bytes = 'export default { id: "SX", beats: [{}] };\n';
    plantStory(root, 'SX', bytes);
    plantArtifact(root, 'SX', { story: { id: 'SX' }, storyDigest: 'deadbeef00000000' }); // no git field
    assert.equal(staleArtifacts(root)[0].reason, 'stale since unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI always exits 0, even against this real checkout — which today has stale rows', () => {
  // Every artifact committed before this bead has no storyDigest — this repo,
  // right now, is exactly that case. A gate here would fail every existing
  // story at once for a change nobody made; T1 ruling 1283 says name it
  // instead. This proves the CLI keeps that promise against the real,
  // currently-stale tree, not only a synthetic fixture built to be clean.
  const out = execFileSync('node', ['scripts/stories/artifact-staleness.mjs'], { cwd: REPO, encoding: 'utf8' });
  assert.match(out, /artifact-staleness/);
});
