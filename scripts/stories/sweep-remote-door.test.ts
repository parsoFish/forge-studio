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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweepStoryRemotesFromManifest } from './sweep-remotes.mjs';

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

test('control: NO manifest (real ENOENT) means nothing is deleted and no refusal is named — the state every run had until now', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-door-'));
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, []);
    // ROW 102b/17 control: a genuinely ABSENT manifest is not the same fact
    // as one that exists and could not be trusted — unlike the two tests
    // above, this must stay silent, exactly as before.
    assert.deepEqual(res.refusals, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 102b (RED) finding 17: an UNPARSEABLE manifest deletes nothing, and NAMES the refusal rather than silently reading as "nothing minted"', () => {
  // A corrupt manifest must not take the trailing sweep down with it, and must
  // certainly not be read as "delete everything". Fails closed — but unlike
  // every other refusal path in this file, this one used to say NOTHING: a
  // minted remote genuinely on this run's manifest would leak unflagged.
  const root = rootWithManifest('{ this is not json');
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, []);
    assert.equal(res.refusals.length, 1, `expected a named refusal for the unparseable manifest: ${JSON.stringify(res)}`);
    assert.match(res.refusals[0], /minted-remotes\.json/);
    assert.match(res.refusals[0], /REFUSING/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * ROW 210 (bead `forge-8vfn.8.5.46`) — THE APPEND-ONLY MANIFEST OUTLIVES THE
 * RUN THAT JUDGES IT.
 *
 * MEASURED. Stories run one after another in one tree, sharing
 * `_logs/minted-remotes.json` across every run that ever touched that tree —
 * `recordMintedRemote` (kernel) only ever appends, and until now nothing ever
 * removed a row. S2's three repos get minted, S2's own trailing sweep deletes
 * them through real `gh`, and their rows sit in the file regardless because
 * confirming a delete never earned a row its removal. The NEXT run's sweep —
 * S3, or any later invocation of the harness against the same tree — reads
 * the whole file, finds S2's rows still there, and REFUSES each one by name
 * because `story-s2-*` does not carry `story-s3`'s own prefix: 3 lines in a
 * small gate, 36 in a full run, and "this run's creation manifest" in the
 * refusal text is simply false for every one of them.
 *
 * TWO INDEPENDENT FIXES, same as the function's own two independent gates:
 *
 *   (1) A row CONFIRMED gone — a fresh delete or an already-gone 404 — is
 *       dropped from the manifest, atomically (temp file + rename), so a
 *       LATER run never re-reads it. A refusal or a failed delete earns no
 *       such confidence and KEEPS its row — a human or a later sweep still
 *       needs to see it.
 *   (2) The manifest is scoped to the RUN: only a row whose `at` falls at or
 *       after this run's own start (`startedMs`, `run-story.mjs`/`run.mjs`,
 *       the same value `reapCensusAndSweep`'s `sinceMs` already uses) is
 *       judged at all. A row from an earlier, separate run is neither
 *       refused-by-prefix nor deleted — it is reported ONCE, as a single
 *       named line, never one `REFUSING` line per stale row. A row with a
 *       missing or unparseable `at` is judged anyway (conservative): this
 *       sweep's job is deciding what NOT to touch, and an undatable row must
 *       still reach the ordinary manifest/prefix gate rather than being waved
 *       through silently.
 *
 * `FS_CLOCK_SLACK_MS` (`beats-queue-terminal.mjs`) is reused for the boundary
 * rather than a second constant — same host, same small coarse-clock lag this
 * harness already budgets for everywhere else it compares a wall-clock stamp
 * to a run's `sinceMs`.
 */

const RUN_STARTED_MS = Date.parse('2026-10-04T12:00:00.000Z');
const BEFORE_RUN_AT = '2026-10-03T09:00:00.000Z'; // a full day before the run — unambiguously stale
const WITHIN_RUN_AT = '2026-10-04T12:00:05.000Z'; // 5s after start — unambiguously this run's own

function readManifestRows(root: string): unknown[] {
  return JSON.parse(readFileSync(join(root, '_logs', 'minted-remotes.json'), 'utf8'));
}

test('ROW 210 (RED): S2\'s already-deleted repos, minted before this run, print ZERO "REFUSING … story prefix" lines for S3', () => {
  const s2Rows = [
    { nameWithOwner: 'parsoFish/story-s2-api', at: BEFORE_RUN_AT },
    { nameWithOwner: 'parsoFish/story-s2-cli', at: BEFORE_RUN_AT },
    { nameWithOwner: 'parsoFish/story-s2-webapp', at: BEFORE_RUN_AT },
  ];
  const root = rootWithManifest(s2Rows);
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(calls, [], 'an out-of-run row is never even handed to gh');
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(res.failed, []);
    assert.ok(
      !res.refusals.some((r) => /REFUSING to delete/.test(r) && /story prefix/.test(r)),
      `measured noise must be gone: ${JSON.stringify(res.refusals)}`,
    );
    const summary = res.refusals.find((r) => /older manifest entr/.test(r));
    assert.ok(summary, `expected a single named summary line: ${JSON.stringify(res.refusals)}`);
    assert.match(summary!, /^3 older manifest entries from earlier runs left untouched:/);
    for (const row of s2Rows) assert.ok(summary!.includes(row.nameWithOwner), summary);
    assert.equal(res.refusals.filter((r) => /older manifest entr/.test(r)).length, 1, 'reported ONCE, not per row');
    // Nothing judged this run, so nothing is dropped from the file either.
    assert.deepEqual(readManifestRows(root), s2Rows);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: an in-run mint is deleted AND its row is dropped from the manifest', () => {
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s3-fresh', at: WITHIN_RUN_AT }]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => '',
    });
    assert.deepEqual(res.deleted, ['parsoFish/story-s3-fresh']);
    assert.deepEqual(res.refusals, []);
    assert.deepEqual(readManifestRows(root), [], 'the confirmed-gone row must not survive to the next sweep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: an already-gone 404 also drops its row', () => {
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s3-gone', at: WITHIN_RUN_AT }]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => { throw new Error('Command failed: gh repo delete parsoFish/story-s3-gone --yes HTTP 404'); },
    });
    assert.deepEqual(res.alreadyGone, ['parsoFish/story-s3-gone']);
    assert.deepEqual(readManifestRows(root), [], 'confirmed gone by 404 is still confirmed gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a FAILED delete keeps its row — not confirmed gone', () => {
  const row = { nameWithOwner: 'parsoFish/story-s3-fails', at: WITHIN_RUN_AT };
  const root = rootWithManifest([row]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => { throw new Error('Command failed: gh repo delete parsoFish/story-s3-fails --yes HTTP 500 server error'); },
    });
    assert.equal(res.failed.length, 1);
    assert.deepEqual(readManifestRows(root), [row], 'a failed delete is not confirmed gone — the row stays');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a TOKEN-LESS refusal keeps its row', () => {
  const row = { nameWithOwner: 'parsoFish/story-s3-notoken', at: WITHIN_RUN_AT };
  const root = rootWithManifest([row]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: () => null,
      runGh: () => '',
    });
    assert.equal(res.refusals.length, 1);
    assert.match(res.refusals[0], /no delete/i);
    assert.deepEqual(readManifestRows(root), [row], 'no token means no confirmation — the row stays');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: an IN-RUN row with another story\'s prefix still REFUSES by prefix, as today, and keeps its row', () => {
  const row = { nameWithOwner: 'parsoFish/story-s2-mintedjustnow', at: WITHIN_RUN_AT };
  const root = rootWithManifest([row]);
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(calls, [], 'a prefix refusal never reaches gh');
    assert.equal(res.refusals.length, 1);
    assert.match(res.refusals[0], /REFUSING to delete/);
    assert.match(res.refusals[0], /story prefix/);
    assert.match(res.refusals[0], /story-s2-mintedjustnow/);
    assert.deepEqual(readManifestRows(root), [row], 'refused-by-prefix is not confirmed gone — the row stays');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a MALFORMED `at` is judged anyway (conservative in-scope default), not silently skipped', () => {
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s3-badtime', at: 'not-a-real-date' }]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => '',
    });
    assert.deepEqual(res.deleted, ['parsoFish/story-s3-badtime'], 'an undatable row must still reach the ordinary gate');
    assert.deepEqual(readManifestRows(root), [], 'and once judged and confirmed gone, it is dropped like any other');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a row with NO `at` field at all (bare string form) is judged anyway', () => {
  const root = rootWithManifest(['parsoFish/story-s3-bareentry']);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => '',
    });
    assert.deepEqual(res.deleted, ['parsoFish/story-s3-bareentry']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: the ROW 102b/17 unreadable-manifest refusal still fires with a run window supplied', () => {
  const root = rootWithManifest('{ this is not json');
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(calls, []);
    assert.equal(res.refusals.length, 1, `expected exactly the unreadable-manifest refusal: ${JSON.stringify(res)}`);
    assert.match(res.refusals[0], /REFUSING/);
    assert.match(res.refusals[0], /minted-remotes\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a row just inside the clock-skew slack is still in scope', () => {
  const justInside = new Date(RUN_STARTED_MS - 100).toISOString(); // well under FS_CLOCK_SLACK_MS (250ms)
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s3-skew', at: justInside }]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: () => '',
    });
    assert.deepEqual(res.deleted, ['parsoFish/story-s3-skew'], 'inside the slack window — judged, not skipped');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: a row clearly before the slack window is out of scope even when its prefix matches', () => {
  const clearlyBefore = new Date(RUN_STARTED_MS - 1000).toISOString(); // well past FS_CLOCK_SLACK_MS (250ms)
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s3-tooearly', at: clearlyBefore }]);
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, sinceMs: RUN_STARTED_MS, readToken: TOKEN,
      runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(calls, [], 'out of scope even though the prefix would otherwise authorise it');
    assert.deepEqual(res.deleted, []);
    assert.ok(res.refusals.some((r) => /older manifest entr/.test(r) && r.includes('story-s3-tooearly')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 210: with NO `sinceMs` supplied, behaviour is unchanged — everything is judged (backward compatible)', () => {
  const root = rootWithManifest([{ nameWithOwner: 'parsoFish/story-s2-old', at: BEFORE_RUN_AT }]);
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S3', root, readToken: TOKEN,
      runGh: () => '',
    });
    assert.equal(res.refusals.length, 1);
    assert.match(res.refusals[0], /REFUSING to delete/);
    assert.match(res.refusals[0], /story prefix/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 102b (RED) finding 17: a manifest that PARSES but is not an array deletes nothing, does not throw, and NAMES the refusal', () => {
  // Found by mutation, not by design: disabling the `Array.isArray` check left
  // every other test in this file green. Without it, `created` becomes a
  // non-iterable object, `created.length === 0` is `undefined === 0` (false),
  // and the `for…of` below THROWS — inside the trailing sweep, at the very end
  // of a run that has otherwise finished. A corrupt manifest must cost nothing
  // — and, per ROW 102b/17, must say so rather than reading as clean.
  const root = rootWithManifest('{"nameWithOwner":"parsoFish/story-s2"}');
  const calls: string[][] = [];
  try {
    const res = sweepStoryRemotesFromManifest({
      storyId: 'S2', root, readToken: TOKEN, runGh: (args: string[]) => { calls.push(args); return ''; },
    });
    assert.deepEqual(res.deleted, []);
    assert.deepEqual(calls, [], 'a malformed manifest is never read as consent to delete');
    assert.equal(res.refusals.length, 1, `expected a named refusal for the non-array manifest: ${JSON.stringify(res)}`);
    assert.match(res.refusals[0], /minted-remotes\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
