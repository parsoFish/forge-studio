/**
 * sweep-remotes.test.ts — split out of `sweep.test.ts` alongside
 * `sweep-remotes.mjs` (T1 ruling 1350's fork brief; ruling 492: an edit to
 * `sweep.mjs` owes it a split, never a baseline entry — see that module's own
 * header, and `sweep-agent-logs.mjs`'s for the precedent this follows).
 *
 * Deleting a story's GitHub remote (bead `forge-8vfn.6.11.2`, T1 ruling 255).
 *
 * `#468`'s sibling — `gh repo create` at project creation — makes a story's
 * project a real GitHub repository so C6 resolves and S2 beat 5 can read
 * `resolution-user-count: '0'`. The sweep owns every fixture a story authors
 * (#407/#412), so it owns that remote too.
 *
 * DELETION IS THE DANGEROUS HALF AND IS TREATED AS SUCH:
 *
 *   - `delete_repo` reaches EVERY repository the account owns, so the token is
 *     never the one the agents run under. It is read ONLY from an operator-root
 *     path, outside the repo and outside every agent env — never
 *     `AGENT_ENV_ALLOWLIST`, never a project `secrets.env`, never a spawned
 *     session's env.
 *   - The token is not yet issued. Absent it the sweep REFUSES LOUDLY BY NAME
 *     rather than skipping quietly: an un-swept remote that nobody is told
 *     about is how a story leaks a repository per run.
 *   - Two independent conditions gate every delete: the repo must be in the
 *     run's OWN creation manifest, AND its name must carry the story prefix.
 *     Either alone is insufficient — a manifest is written by the run and a
 *     prefix is a string, and `delete_repo` is not a permission to be one
 *     mistake away from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepStoryRemotes, describeRemoteSweep } from './sweep-remotes.mjs';

test('AT-6.11.2-5 (RED) with no token, the sweep REFUSES BY NAME and deletes nothing', () => {
  const calls: string[][] = [];
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [{ nameWithOwner: 'parsoFish/story-s2-abc123' }],
    readToken: () => null,
    runGh: (a: string[]) => { calls.push(a); return ''; },
  });
  assert.equal(res.deleted.length, 0);
  assert.deepEqual(calls, [], 'nothing outward-facing without a token');
  assert.equal(res.refusals.length, 1);
  assert.match(res.refusals[0], /FORGE_STORY_SWEEP_DELETE_TOKEN/, res.refusals[0]);
  assert.match(res.refusals[0], /story-sweep-token/, `the PATH is named too: ${res.refusals[0]}`);
});

test('AT-6.11.2-6 (RED) with a token, only manifest-listed repos carrying the story prefix are deleted', () => {
  const calls: string[][] = [];
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [{ nameWithOwner: 'parsoFish/story-s2-abc123' }],
    readToken: () => 'ghp_fake',
    runGh: (a: string[]) => { calls.push(a); return ''; },
  });
  assert.deepEqual(res.deleted, ['parsoFish/story-s2-abc123']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['repo', 'delete', 'parsoFish/story-s2-abc123']);
  assert.ok(calls[0].includes('--yes'), `non-interactive: ${calls[0].join(' ')}`);
});

test('AT-6.11.2-7 a repo NOT in the run\'s manifest is never deleted, even with the prefix', () => {
  const calls: string[][] = [];
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [],                                   // the run created nothing
    alsoSeen: ['parsoFish/story-s2-someone-elses'], // but something with the prefix exists
    readToken: () => 'ghp_fake',
    runGh: (a: string[]) => { calls.push(a); return ''; },
  });
  assert.deepEqual(res.deleted, []);
  assert.deepEqual(calls, [], 'the manifest is the authority — a prefix alone never authorises a delete');
});

test('AT-6.11.2-8 a manifest-listed repo WITHOUT the story prefix is refused, naming it', () => {
  const calls: string[][] = [];
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [{ nameWithOwner: 'parsoFish/some-real-project' }],
    readToken: () => 'ghp_fake',
    runGh: (a: string[]) => { calls.push(a); return ''; },
  });
  assert.deepEqual(res.deleted, []);
  assert.deepEqual(calls, [], 'both conditions must hold — a manifest entry alone is not enough');
  assert.match(res.refusals.join(' '), /some-real-project/, JSON.stringify(res.refusals));
});

/**
 * The trailing sweep's remote-delete reporting (bead `forge-8vfn.6.11.53`).
 *
 * Measured: "[stories] trailing sweep DELETED remote parsoFish/story-s2" then
 * "[stories] could not delete remote [object Object]: Command failed: gh repo
 * delete parsoFish/story-s2 --yes HTTP 404 … needs the "repo" scope" — the
 * delete SUCCEEDED; a second attempt against the same name 404'd because the
 * manifest carried the repo twice (a stale row from an earlier run, never
 * cleared, plus this run's own). Three defects: the target list was not
 * deduped, a 404 on delete was reported as a failure carrying a misleading
 * scope hint instead of "already gone", and the failure line interpolated the
 * whole failed-entry OBJECT rather than its name.
 */
test('AT-6.11.53-1 (RED) the same manifest-listed repo appears twice — gh is asked to delete it only ONCE', () => {
  const calls: string[][] = [];
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [
      { nameWithOwner: 'parsoFish/story-s2' },
      { nameWithOwner: 'parsoFish/story-s2' }, // stale duplicate row
    ],
    readToken: () => 'ghp_fake',
    runGh: (a: string[]) => { calls.push(a); return ''; },
  });
  assert.equal(calls.length, 1, `gh must be invoked once per distinct remote, not once per manifest row: ${JSON.stringify(calls)}`);
  assert.deepEqual(res.deleted, ['parsoFish/story-s2']);
});

test('AT-6.11.53-2 (RED) a 404 on delete is reported as already-gone, not a failure, and carries no scope hint', () => {
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [{ nameWithOwner: 'parsoFish/story-s2' }],
    readToken: () => 'ghp_fake',
    runGh: () => {
      throw new Error(
        'Command failed: gh repo delete parsoFish/story-s2 --yes HTTP 404 … needs the "repo" scope',
      );
    },
  });
  assert.deepEqual(res.failed, [], 'a 404 is not a failure — the repo is simply already gone');
  assert.deepEqual(res.deleted, [], 'not a fresh delete either — nothing was actually deleted THIS call');
  assert.deepEqual(res.alreadyGone, ['parsoFish/story-s2']);
  assert.ok(
    !JSON.stringify(res).toLowerCase().includes('scope'),
    `the misleading scope hint must not survive into the report: ${JSON.stringify(res)}`,
  );
});

test('AT-6.11.53-3 (RED) a genuine (non-404) delete failure still lands in `failed`, named by field', () => {
  const res = sweepStoryRemotes({
    storyId: 'S2',
    created: [{ nameWithOwner: 'parsoFish/story-s2' }],
    readToken: () => 'ghp_fake',
    runGh: () => { throw new Error('Command failed: gh repo delete parsoFish/story-s2 --yes HTTP 500 server error'); },
  });
  assert.deepEqual(res.alreadyGone, []);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].nameWithOwner, 'parsoFish/story-s2', JSON.stringify(res.failed));
  assert.match(res.failed[0].error, /500/);
});

test('AT-6.11.53-4 (RED) describeRemoteSweep never interpolates the failed-entry object', () => {
  const report = describeRemoteSweep({
    deleted: ['parsoFish/story-s2'],
    alreadyGone: ['parsoFish/story-s4'],
    refusals: ['[stories] REFUSING to delete parsoFish/forge-studio'],
    failed: [{ nameWithOwner: 'parsoFish/story-s7', error: 'boom' }],
  });
  const all = [...report.lines, ...report.warnLines];
  assert.ok(!all.some((l) => l.includes('[object Object]')), `object leaked into a report line: ${JSON.stringify(all)}`);
  assert.ok(report.warnLines.some((l) => l.includes('parsoFish/story-s7') && l.includes('boom')), JSON.stringify(report.warnLines));
  assert.ok(report.lines.some((l) => l.includes('DELETED remote parsoFish/story-s2')), JSON.stringify(report.lines));
  assert.ok(report.lines.some((l) => l.includes('parsoFish/story-s4') && /already gone/i.test(l)), JSON.stringify(report.lines));
});
