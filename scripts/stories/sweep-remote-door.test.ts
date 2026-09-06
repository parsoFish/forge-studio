/**
 * The RUNNER'S DOOR to the remote delete — bead `forge-8vfn.6.11.29`,
 * T1 ruling 326. `6.11.2` was reopened for exactly this.
 *
 * WHAT WAS ACTUALLY MISSING. `sweepStoryRemotes` shipped correct and
 * unreachable: `grep -rn sweepStoryRemotes` found only its own definition and
 * its own tests. **And nothing wrote the `created` manifest it requires**, so
 * its first of two independent conditions was a list that could never hold
 * anything — its "refuse an unlisted repo" guard was being proven against a
 * permanently empty input. Both the caller AND its only real input were absent.
 *
 * The cost was measured, not theoretical: S2 run 5 minted
 * `parsoFish/story-s2` — verified live, PRIVATE, created 05:17:12Z — and the
 * sweep removed nothing. That repository is still on the operator's account.
 *
 * WHY THIS TEST DRIVES THE DOOR AND NOT THE FUNCTION. `sweepStoryRemotes`'s own
 * tests already pass and always did; they call it directly with `created` handed
 * in. The step that was missing is **"a manifest on disk becomes a delete"**, so
 * that is what is tested here — a real file, the runner's entry point, `gh`
 * injected. Testing one layer up is the whole lesson of `6.11.27`, where a unit
 * test against a fake let an unreachable capability be closed twice.
 *
 * `gh` is never real: a test that had to reach GitHub to prove a delete would be
 * the same mistake wearing different clothes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweepStoryRemotesFromManifest } from './sweep.mjs';

/** A forge root carrying a minted-remotes manifest with `rows`. */
function rootWithManifest(rows: unknown[] | string): string {
  const root = mkdtempSync(join(tmpdir(), 'sweep-door-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  writeFileSync(
    join(root, '_logs', 'minted-remotes.json'),
    typeof rows === 'string' ? rows : `${JSON.stringify(rows, null, 2)}\n`,
  );
  return root;
}

const TOKEN = () => 'ghp_fake_delete_token';

test('6.11.29: a manifest-listed, prefix-matching repo IS deleted through the runner door', () => {
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s2', at: '2026-09-06T05:17:12Z' }]);
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });

    assert.deepEqual(res.refusals, [], 'a listed, prefix-matching repo is not refused');
    assert.deepEqual(res.failed, []);
    assert.deepEqual(res.deleted, ['parsoFish/story-s2']);
    assert.ok(
      calls.some((a) => a.includes('delete') || a.includes('repo')),
      `gh must actually be asked to delete; calls: ${JSON.stringify(calls)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('6.11.29: a repo NOT carrying the story prefix is refused, even though it is listed', () => {
  // The second independent condition. The manifest is the authority and the
  // prefix is the check on it — `delete_repo` reaches every repository the
  // account owns, so one mistake in the manifest must not be sufficient.
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/forge-studio', at: 'now' }]);
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });

    assert.deepEqual(res.deleted, [], 'nothing outside the story prefix is deleted');
    assert.equal(res.refusals.length, 1);
    assert.match(res.refusals[0], /forge-studio/);
    assert.deepEqual(calls, [], 'and gh is never invoked at all for a refused row');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('6.11.29: NO manifest means nothing is deleted — the state every run had until now', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-door-'));
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('6.11.29: an UNPARSEABLE manifest deletes nothing rather than throwing', () => {
  // A corrupt manifest must not take the trailing sweep down with it, and must
  // certainly not be read as "delete everything". Fails closed.
  const root = rootWithManifest('{ this is not json');
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('6.11.29: a manifest that PARSES but is not an array deletes nothing, and does not throw', () => {
  // Found by mutation, not by design: disabling the `Array.isArray` check left
  // every other test in this file green. Without it, `created` becomes a
  // non-iterable object, `created.length === 0` is `undefined === 0` (false),
  // and the `for…of` below THROWS — inside the trailing sweep, at the very end
  // of a run that has otherwise finished. A corrupt manifest must cost nothing.
  const root = rootWithManifest('{"nameWithOwner":"parsoFish/story-s2"}');
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, [], 'a malformed manifest is never read as consent to delete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
