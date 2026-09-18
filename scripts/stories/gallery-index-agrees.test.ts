/**
 * The gallery index must agree with the `story.json` files it is derived from —
 * `forge-8vfn.7.6.128`.
 *
 * THE DEFECT, MEASURED. At merge `3d61c42e`, `demos/stories/index.html` on main
 * called S9 `red · 4/14 beats green` while `demos/stories/S9/story.json` said
 * `green · 16/16`. Every other row agreed: S1 11/11, S3 10/12 red, S4 13/13,
 * S6 15/15, S7 23/23, S8 19/19, proof 5/5, smoke 2/2. An S9 triple landed its
 * `story.json` and its doc without the fan-in index being regenerated with them,
 * and the index had been claiming the wrong verdict ever since.
 *
 * WHY THIS IS A DOOR AND NOT A PIN. The index is matched by no manifest. M6-C
 * dropped that pin deliberately (amendment 56) on an argument that still holds:
 * a fan-in artifact's change rate is the SUM of its inputs', so pinning it
 * charges a cross-lane stranding for every legitimate input change, forever. The
 * same amendment named what that left behind — "Nothing asserts the committed
 * index is what the generator would produce from the CURRENT inputs.
 * 'Regenerate and compare' does not exist as a door." This is that door, and it
 * is not a pin: no hash, no manifest, no owner to reconcile. A legitimate input
 * change makes it red until the author regenerates in their own PR.
 *
 * BOTH SIDES ARE READ FROM HEAD, which M6-C's warning is the reason for. A run
 * in progress writes an UNTRACKED `demos/stories/<id>/story.json` and then
 * REGENERATES `index.html` on disk. Comparing disk-to-disk hides a stale
 * committed index behind any run; comparing disk-inputs to a committed index —
 * or the reverse — reds on every in-flight run, and a refusal that fires every
 * time gets routed around. Committed-to-committed is the claim that actually
 * matters and the only one immune to both.
 *
 * IT COMPARES THE WHOLE RENDER, not only the verdict text. The verdict
 * disagreement is the instance; the class is "the committed index is not what
 * the generator would produce". A verdict-only check passes a card whose title
 * drifted and passes a card dropped entirely — `#703`'s shape, where main's
 * gallery pointed at artifacts absent from the repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  committedGalleryRows,
  committedGalleryIndex,
  renderGalleryIndex,
  regenerateGallery,
} from './gallery.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The check itself, as one expression, so every door asks exactly the question
 * the repo door asks. Returns the disagreeing lines rather than a boolean:
 * "they differ" is not something an operator can act on.
 */
function disagreements(root: string): { line: number; committed: string; derived: string }[] {
  const committedIndex = committedGalleryIndex(root);
  if (committedIndex === null) {
    throw new Error(
      `HEAD in ${root} carries no demos/stories/index.html — an absent index is not an agreeing one.`,
    );
  }
  const derived = renderGalleryIndex(committedGalleryRows(root).rows).split('\n');
  const committed = committedIndex.split('\n');
  const out: { line: number; committed: string; derived: string }[] = [];
  for (let i = 0; i < Math.max(derived.length, committed.length); i += 1) {
    if (derived[i] !== committed[i]) {
      out.push({ line: i + 1, committed: committed[i] ?? '<absent>', derived: derived[i] ?? '<absent>' });
    }
  }
  return out;
}

/** A real git repo, because a check about COMMITTED state needs commits. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'gallery-agrees-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'd@e');
  git('config', 'user.name', 'd');
  mkdirSync(join(root, 'demos', 'stories'), { recursive: true });
  return root;
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'commit', '-qm', message], { encoding: 'utf8' });
}

function writeStory(root: string, id: string, greenBeats: number, beats: number): void {
  const dir = join(root, 'demos', 'stories', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'story.json'),
    `${JSON.stringify({
      story: { id, docs: { title: `Story ${id}` } },
      beats: Array.from({ length: beats }, (_, i) => ({ status: i < greenBeats ? 'green' : 'red' })),
    })}\n`,
  );
}

function writeIndex(root: string, rows: object[]): void {
  writeFileSync(join(root, 'demos', 'stories', 'index.html'), renderGalleryIndex(rows));
}

const row = (id: string, status: string, greenBeats: number, beats: number) =>
  ({ id, title: `Story ${id}`, status, beats, greenBeats, clip: `${id}/story.webm` });

test('7.6.128: THE REPO DOOR — the committed gallery index agrees with every committed story.json', () => {
  const bad = disagreements(REPO);
  assert.deepEqual(
    bad,
    [],
    `demos/stories/index.html does not match what the generator produces from the committed story.json files.\n${bad
      .map((d) => `  line ${d.line}\n    committed: ${d.committed}\n    derived:   ${d.derived}`)
      .join('\n')}\nRegenerate the index and commit it in this PR.`,
  );
});

test('7.6.128: a verdict disagreement is caught — the exact S9 shape', () => {
  const root = repo();
  try {
    writeStory(root, 'SX', 16, 16); // the artifact says green 16/16
    writeIndex(root, [row('SX', 'red', 4, 14)]); // the index says red 4/14
    commitAll(root, 'a disagreeing pair');
    const bad = disagreements(root);
    assert.ok(bad.length > 0, 'an index claiming red over a green artifact must not agree');
    assert.ok(
      bad.some((d) => d.committed.includes('verdict red') && d.derived.includes('verdict green')),
      'and the disagreement must be reported as the verdict line it is',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: a BEAT COUNT disagreement is caught even when the colour matches', () => {
  // The subtler half of S9: red against red, but 4/14 against 1/2. A check keyed
  // on the colour word passes an index that is wrong about how much of the story
  // actually ran.
  const root = repo();
  try {
    writeStory(root, 'SX', 1, 2);
    writeIndex(root, [row('SX', 'red', 4, 14)]);
    commitAll(root, 'same colour, different counts');
    assert.ok(
      disagreements(root).some((d) => d.committed.includes('4/14') && d.derived.includes('1/2')),
      'both are red; the counts differ and that is still a disagreement',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: a card in the index with NO story.json behind it is caught — #703\'s shape', () => {
  const root = repo();
  try {
    writeIndex(root, [row('GHOST', 'green', 3, 3)]);
    commitAll(root, 'an index advertising a story that is not here');
    const bad = disagreements(root);
    assert.ok(bad.length > 0, 'an index listing a story with no artifact must not agree');
    assert.ok(bad.some((d) => d.committed.includes('GHOST')), 'and the ghost card must be named, not merely counted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: an IN-FLIGHT run is invisible — an untracked story.json does not red this check', () => {
  // M6-C's warning, and the reason both sides are read from HEAD. Run 19 wrote
  // `demos/stories/S10/` in C's tree while still running: a `story.json` that
  // exists, is NOT committed, and has no index row. A disk walk would red here
  // on every in-flight run, and a refusal that fires every time is one that gets
  // routed around within the hour.
  const root = repo();
  try {
    writeStory(root, 'SX', 2, 2);
    writeIndex(root, [row('SX', 'green', 2, 2)]);
    commitAll(root, 'a consistent committed state');
    assert.deepEqual(disagreements(root), [], 'the committed state starts out agreeing');

    // Now a run in progress: a new story's artifact appears, UNTRACKED, and the
    // run regenerates the on-disk index to include it. Neither is committed.
    writeStory(root, 'S10', 24, 24);
    regenerateGallery(root, ['S10']);
    assert.deepEqual(
      disagreements(root),
      [],
      'an uncommitted artifact is not something the COMMITTED index can be expected to list',
    );

    // And once the run's output IS committed, the check has an opinion again —
    // proving the invisibility is about commitment and not about blindness.
    commitAll(root, 'land the run output, index included');
    assert.deepEqual(disagreements(root), [], 'a committed run whose index was regenerated still agrees');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: a committed artifact with a STALE committed index still reds — the invisibility is not blindness', () => {
  // The other side of the door above: commitment is what makes it visible, so a
  // landed story.json whose index was NOT regenerated must red. Without this,
  // reading from HEAD could be hiding everything rather than only in-flight work.
  const root = repo();
  try {
    writeStory(root, 'SX', 2, 2);
    writeIndex(root, [row('SX', 'green', 2, 2)]);
    commitAll(root, 'consistent');
    writeStory(root, 'SY', 5, 5); // a second story lands, index NOT regenerated
    commitAll(root, 'landed a story without regenerating the index');
    const bad = disagreements(root);
    assert.ok(bad.length > 0, 'a committed story with no card is exactly the S9 class');
    assert.ok(bad.some((d) => d.derived.includes('SY')), 'and the missing card must be named');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: HEAD carrying no index at all REFUSES — absence is not agreement', () => {
  const root = repo();
  try {
    writeStory(root, 'SX', 1, 1);
    commitAll(root, 'a story and no index');
    assert.throws(() => disagreements(root), /an absent index is not an agreeing one/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: a git read that FAILS refuses rather than reporting agreement', () => {
  // Not a git repository at all. "git did not answer" resolving to "nothing is
  // tracked" would render an empty index as perfectly self-consistent, which is
  // the vacuous pass this whole bead is about (§15.504).
  const root = mkdtempSync(join(tmpdir(), 'gallery-agrees-nogit-'));
  try {
    mkdirSync(join(root, 'demos', 'stories'), { recursive: true });
    assert.throws(() => committedGalleryRows(root), /git ls-files exited|could not run git ls-files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.128: the check and the generator render identical bytes from one tree', () => {
  // If the check re-implemented the derivation, the two would drift and it would
  // assert its own copy. The FILE SOURCE differs on purpose — HEAD versus disk —
  // but `storyRowFrom` and `renderGalleryIndex` are shared, and on a clean tree
  // the two sources coincide, which is what this measures.
  const root = repo();
  try {
    writeStory(root, 'SX', 3, 4);
    writeIndex(root, [row('SX', 'red', 3, 4)]);
    commitAll(root, 'clean tree');
    const { html } = regenerateGallery(root, []);
    assert.equal(
      html,
      renderGalleryIndex(committedGalleryRows(root).rows),
      'generator (disk) and check (HEAD) must agree on a tree where those coincide',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
