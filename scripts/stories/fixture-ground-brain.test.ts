/**
 * fixture-ground-brain.test.ts — a fixture ground's OPTIONAL Brain 3 profile
 * (M7-D, bead `forge-1rk5.1`, T1 ruling on S3's `go-provider-old-contract`
 * ground). `packages/projects/preflight.ts`'s C4 clause requires
 * `brain/projects/<name>/profile.md` in the FORGE repo, keyed by the
 * project's own DIRECTORY NAME — a plain `projects/<project>` copy has no way
 * to carry that, because Brain 3 lives outside `projects/` entirely. A
 * fixture ground MAY declare its own `tests/stories/grounds/<fixture>/brain/`
 * (profile.md and nothing more, unless a preflight/reset check starts reading
 * more); `provisionFixtureGround` copies it to `brain/projects/<project>/`
 * and `teardownFixtureGround` removes it, so no story ever leaves a Brain 3
 * profile behind for the next run to trip over.
 *
 * RESIDUE DOOR, mirrored from the ground's own: `projects/<project>` already
 * refuses to provision over an existing destination (`fixture-ground.test.ts`,
 * "refuses when the destination already exists"). `brain/projects/<project>`
 * gets the identical door — refused BEFORE any write, naming the path, same
 * as every other preflight check in `provisionFixtureGround`.
 *
 * `sweep.mjs`'s `productFixturePathsFor` already lists
 * `brain/projects/<name>` for every `storyFixtureNames(storyId)` (M5-B s1's
 * own finding, "a green `proof` run left `brain/projects/story-proof` behind
 * twice in one session") — this file does not re-test the sweep, only that
 * provision/teardown themselves never leave or need it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { provisionFixtureGround, teardownFixtureGround } from './fixture-ground.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fixture-ground-brain-'));

/** Plant `tests/stories/grounds/<name>/{seed/…, PROVENANCE.md}`, and — only
 *  when `brain` is given — `tests/stories/grounds/<name>/brain/…` beside it. */
function seedFixture(root: string, opts: { name?: string; brain?: Record<string, string> } = {}): void {
  const name = opts.name ?? 'demo-seed';
  const seedDir = join(root, 'tests', 'stories', 'grounds', name, 'seed');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(join(seedDir, 'README.md'), '# demo seed\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', name, 'PROVENANCE.md'), '# provenance\n');
  if (opts.brain !== undefined) {
    const brainDir = join(root, 'tests', 'stories', 'grounds', name, 'brain');
    mkdirSync(brainDir, { recursive: true });
    for (const [rel, content] of Object.entries(opts.brain)) {
      mkdirSync(join(brainDir, rel, '..'), { recursive: true });
      writeFileSync(join(brainDir, rel), content);
    }
  }
}

test('a fixture with a brain/ directory has it copied to brain/projects/<project> on provision', () => {
  const root = scratch();
  seedFixture(root, { brain: { 'profile.md': '# terraform-provider-betterado\n\nCaptured knowledge.\n' } });

  const result = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  const brainDest = join(root, 'brain', 'projects', 'story-s8');
  assert.equal(existsSync(join(brainDest, 'profile.md')), true, 'the fixture\'s brain/profile.md must land at brain/projects/<project>/profile.md');
  assert.equal(
    readFileSync(join(brainDest, 'profile.md'), 'utf8'),
    '# terraform-provider-betterado\n\nCaptured knowledge.\n',
    'the copy must be byte-identical to the fixture\'s own brain/ source',
  );
  assert.equal(result.brainDir, brainDest, 'the provisioning record names where the brain profile landed');
});

test('teardown removes the brain profile alongside the ground', () => {
  const root = scratch();
  seedFixture(root, { brain: { 'profile.md': '# profile\n' } });
  provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  const brainDest = join(root, 'brain', 'projects', 'story-s8');
  assert.equal(existsSync(brainDest), true, 'precondition: the brain profile was provisioned');

  const result = teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });
  assert.equal(result.removed, true);
  assert.equal(existsSync(brainDest), false, 'the brain profile must not survive teardown');
  assert.equal(existsSync(join(root, 'projects', 'story-s8')), false, 'the ground itself is still removed too');
});

test('a fixture with NO brain/ directory creates nothing under brain/projects/<project>', () => {
  const root = scratch();
  seedFixture(root); // no `brain` option — the fixture declares none

  const result = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  assert.equal(result.brainDir, null, 'a fixture with no brain/ source names no destination');
  assert.equal(existsSync(join(root, 'brain', 'projects', 'story-s8')), false, 'nothing may appear under brain/projects for a ground that declares no profile');
  assert.equal(existsSync(join(root, 'brain')), false, 'not even the brain/ directory itself should be created');
});

test('refuses to provision when brain/projects/<project> already exists (residue), writing nothing at all', () => {
  const root = scratch();
  seedFixture(root, { brain: { 'profile.md': '# fresh profile\n' } });
  const brainDest = join(root, 'brain', 'projects', 'story-s8');
  mkdirSync(brainDest, { recursive: true });
  writeFileSync(join(brainDest, 'profile.md'), '# stale leftover from a prior run\n');

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
    (err: unknown) => {
      const message = String((err as Error)?.message ?? err);
      assert.ok(message.includes(brainDest), `the refusal must name ${brainDest}. Got: ${message}`);
      return true;
    },
  );

  assert.equal(existsSync(join(root, 'projects', 'story-s8')), false, 'a refused provision must write nothing — not even the ground itself');
  assert.equal(
    readFileSync(join(brainDest, 'profile.md'), 'utf8'),
    '# stale leftover from a prior run\n',
    'the pre-existing residue must be left completely untouched',
  );
  assert.deepEqual(readdirSync(brainDest), ['profile.md'], 'nothing else was added to the residue directory');
});

test('teardown removes a leftover brain profile even if the ground directory is already gone', () => {
  const root = scratch();
  const brainDest = join(root, 'brain', 'projects', 'story-s8');
  mkdirSync(brainDest, { recursive: true });
  writeFileSync(join(brainDest, 'profile.md'), '# orphaned profile, no ground beside it\n');

  const result = teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });
  assert.equal(result.removed, true);
  assert.equal(existsSync(brainDest), false, 'an orphaned brain profile is still this story\'s own residue to clear');
});
