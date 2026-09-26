/**
 * Every fixture ground's SEED is pinned to a committed digest, and every file
 * on disk under it is TRACKED — row 107 (T1 1543), M7-COMMON §6.17.
 *
 * WHY BOTH. `provisionFixtureGround` compares the seed to the provisioned
 * copy, never the seed to anything committed, so a seed can drift — or lose a
 * file — without any test noticing. And `groundManifest` hashes what is ON
 * DISK: a file the host's own `.git/info/exclude` hides (it happened —
 * `AGENTS.md` in go-provider-old-contract, row 106) is hashed locally but
 * absent from every clean clone, so a digest check alone is green here and red
 * in CI. The tracked-files check catches that on the host that has the file.
 *
 * Changing a seed is a PROVENANCE event: update the ground's PROVENANCE.md and
 * this table in the same commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { groundManifest } from './ground-hash.mjs';

const REPO = join(import.meta.dirname, '..', '..');
const GROUNDS = join(REPO, 'tests', 'stories', 'grounds');

/** ground → { digest (method-C, first 16 hex), files } — the committed pin. */
const PINNED: Record<string, { digest: string; files: number }> = {
  'node-library': { digest: 'bcb1c45a7fe99b04', files: 19 },
  'node-cli-with-tests': { digest: '0d0dff0bc55c0d07', files: 100 },
  'go-provider-old-contract': { digest: '94e16fb026da34b0', files: 127 },
};

function groundsOnDisk(): string[] {
  return readdirSync(GROUNDS).filter((n) => statSync(join(GROUNDS, n)).isDirectory()).sort();
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(REPO, p));
    }
  };
  walk(dir);
  return out.sort();
}

test('every fixture ground on disk has a pinned seed digest — a new ground cannot ship unpinned', () => {
  assert.deepEqual(groundsOnDisk(), Object.keys(PINNED).sort(), 'add the new ground to PINNED with its digest and file count');
});

for (const [ground, pin] of Object.entries(PINNED)) {
  const seed = join(GROUNDS, ground, 'seed');

  test(`${ground}: every file under seed/ is TRACKED by git (§6.17 — never trust ls)`, () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files', '-z', '--', relative(REPO, seed)], { cwd: REPO, encoding: 'utf8' })
        .split('\0').filter(Boolean),
    );
    const untracked = filesUnder(seed).filter((f) => !tracked.has(f));
    assert.deepEqual(untracked, [], `on disk but not committed (a clean clone will not have them): ${untracked.join(', ')}`);
  });

  test(`${ground}: seed/ digest matches its committed pin`, () => {
    const m = groundManifest(seed);
    assert.ok(m !== null, `could not read ${seed}`);
    assert.equal(m.files.size, pin.files, 'file count drifted from the pin');
    assert.equal(m.digest, pin.digest, 'seed content drifted from the pin — a seed change is a PROVENANCE event');
  });

  test(`${ground}: PROVENANCE.md states the pinned digest`, () => {
    const prov = readFileSync(join(GROUNDS, ground, 'PROVENANCE.md'), 'utf8');
    assert.ok(prov.includes(pin.digest), `PROVENANCE.md does not state ${pin.digest}`);
  });
}
