/**
 * The gallery cannot point at artifacts the repo does not have —
 * `forge-8vfn.7.6.81`, T1 ruling 1009.
 *
 * WHAT SHIPPED. #703 committed an updated `demos/stories/index.html` whose new
 * entry's `story.json` and frames were UNTRACKED. Main's gallery linked to
 * artifacts absent from the repo and every gate read rc=0 — because an
 * untracked file is invisible to `check-file-size`, to every pin, and to
 * `sha256sum -c`: a file that is not listed cannot fail. It was caught only by
 * a post-merge porcelain read, by eye.
 *
 * THE CLIP IS EXEMPT AND THAT IS THE WHOLE NARROWING. Every `href`/`src` in the
 * rendered index is a `.webm`, and `.gitignore:192-195` ignores
 * `demos/stories/**\/*.webm` in as many words: "Frames, story.json and the
 * generated doc ARE deterministic and stay tracked" (operator ruling
 * 2026-08-30). So a guard reading the HTML's own links would red on all twelve
 * entries BY DESIGN, and be deleted within the day. The subjects are the ones
 * the operator said stay tracked: `story.json` and each beat's `frame:`.
 *
 * TWO DOORS, DELIBERATELY DIFFERENT IN KIND:
 *   - the COMMITTED-TREE door runs over this repository as it actually is. It
 *     is what catches #703, and it costs a funded run nothing because it lives
 *     under `npm test`.
 *   - the REFUSAL door plants an untracked frame in a scratch repo and asserts
 *     the message NAMES it. A guard that refuses without naming the path sends
 *     the reader looking.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { untrackedGalleryTargets, regenerateGallery } from './gallery.mjs';

const REPO = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

/** Every story id the real gallery derives its index from. */
function galleryEntryIds(root: string): string[] {
  const base = join(root, 'demos', 'stories');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, 'story.json')))
    .map((e) => e.name)
    .sort();
}

describe('7.6.81 — the gallery verifies its own links', () => {
  test('THE COMMITTED TREE: every gallery entry\'s story.json and frames are tracked', () => {
    // The #703 door. It reads the repository, not a fixture — `git ls-files`
    // sees the checkout's tracked set in CI exactly as it does here.
    const ids = galleryEntryIds(REPO);
    assert.ok(ids.length > 0,
      'refusing to report a vacuous pass: no gallery entries were found at all, which means this door ' +
      'is asserting over an empty set rather than over the gallery');

    const untracked = untrackedGalleryTargets(REPO, ids);
    assert.deepEqual(untracked, [],
      `the gallery index is derived from every story.json on disk, so an untracked one becomes a live ` +
      `link to a file nobody cloning this repo will have:\n` +
      untracked.map((t) => `  ${t.entry} -> ${t.path}`).join('\n'));
  });

  test('the clip is NOT a subject — the check must not red on the twelve webm links', () => {
    // Stated as its own case because it is the difference between a guard that
    // ships and one that is reverted: webm is ignored by the operator's rule,
    // and all twelve index links are webm.
    const targets = untrackedGalleryTargets(REPO, galleryEntryIds(REPO));
    assert.equal(targets.filter((t) => t.path.endsWith('.webm')).length, 0);
  });

  test('A PLANTED UNTRACKED FRAME is refused BY NAME', () => {
    const root = mkdtempSync(join(tmpdir(), 'gallery-guard-'));
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
      git('init', '-q');
      git('config', 'user.email', 'door@example.invalid');
      git('config', 'user.name', 'door');

      // A committed entry — the honest case that must stay silent.
      const good = join(root, 'demos', 'stories', 'good');
      mkdirSync(join(good, 'frames'), { recursive: true });
      writeFileSync(join(good, 'frames', '01-a.png'), 'png');
      writeFileSync(join(good, 'story.json'), JSON.stringify({
        story: { id: 'good', docs: { title: 'Good' } },
        beats: [{ status: 'green', frame: 'frames/01-a.png' }],
      }));
      git('add', '-A');
      git('commit', '-q', '-m', 'a story whose artifacts are in the repo');

      // #703's shape: an entry on disk whose artifacts were never committed.
      const bad = join(root, 'demos', 'stories', 'stale');
      mkdirSync(join(bad, 'frames'), { recursive: true });
      writeFileSync(join(bad, 'frames', '01-planted.png'), 'png');
      writeFileSync(join(bad, 'story.json'), JSON.stringify({
        story: { id: 'stale', docs: { title: 'Stale' } },
        beats: [{ status: 'green', frame: 'frames/01-planted.png' }],
      }));

      assert.throws(
        () => regenerateGallery(root),
        (err: Error) => {
          assert.match(err.message, /demos\/stories\/stale\/frames\/01-planted\.png/,
            `the refusal must NAME the path — a guard that refuses without naming it sends the reader ` +
            `looking:\n${err.message}`);
          assert.match(err.message, /stale/, 'and name the entry');
          assert.doesNotMatch(err.message, /demos\/stories\/good/,
            'and must not implicate the entry that is correctly committed');
          return true;
        },
      );

      // AND THE INDEX MUST NOT HAVE BEEN WRITTEN. A guard that throws after
      // writing has published the bad state and merely complained about it.
      assert.equal(existsSync(join(root, 'demos', 'stories', 'index.html')), false,
        'the refusal happens BEFORE the write, so a refused run leaves no index at all');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('AN ENTRY THIS RUN WROTE IS EXEMPT — a new story\'s first run must not fail at its last step', () => {
    // 1009(c). Without this, the first run of any story that has never been
    // committed throws after every beat has executed. On a funded run that
    // means paying for a complete run and losing it at the final render.
    const root = mkdtempSync(join(tmpdir(), 'gallery-guard-exempt-'));
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
      git('init', '-q');
      git('config', 'user.email', 'door@example.invalid');
      git('config', 'user.name', 'door');
      writeFileSync(join(root, 'README'), 'a repo with no stories yet\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'init');

      const fresh = join(root, 'demos', 'stories', 'brand-new');
      mkdirSync(join(fresh, 'frames'), { recursive: true });
      writeFileSync(join(fresh, 'frames', '01-a.png'), 'png');
      writeFileSync(join(fresh, 'story.json'), JSON.stringify({
        story: { id: 'brand-new', docs: { title: 'Brand new' } },
        beats: [{ status: 'green', frame: 'frames/01-a.png' }],
      }));

      const r = regenerateGallery(root, ['brand-new']);
      assert.equal(r.rows.length, 1, 'the run completes and the index is written');
      assert.ok(existsSync(join(root, 'demos', 'stories', 'index.html')));

      // The exemption is NARROW: the same tree, without the id, refuses.
      assert.throws(() => regenerateGallery(root, []), /brand-new/,
        'exempt means "this run produced it", not "new stories are fine" — an entry nobody produced ' +
        'and nobody committed is exactly #703');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The path-segment guard, found by this bead's own security review rather
  // than by the bead. `entryIds` and each `frame` segment become part of a
  // filesystem path; today's ids come from readdirSync (which cannot return a
  // name containing `/`), but the function is EXPORTED and `frame` is read out
  // of story.json content — only as trustworthy as whatever wrote that file.
  for (const bad of ['../../etc', '..', '.', 'null', 'undefined', 'NaN', '', 'a'.repeat(129)]) {
    test(`a story id of ${JSON.stringify(bad)} is REFUSED, not folded into a path`, () => {
      assert.throws(() => untrackedGalleryTargets(REPO, [bad]), /refusing a story id/,
        'an unchecked segment makes this guard answer a question about a file it was never asked about');
    });
  }

  test('a frame path escaping its story dir is REFUSED', () => {
    const root = mkdtempSync(join(tmpdir(), 'gallery-guard-traverse-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q']);
      const d = join(root, 'demos', 'stories', 'evil');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'story.json'), JSON.stringify({
        story: { id: 'evil', docs: { title: 'Evil' } },
        beats: [{ status: 'green', frame: '../../../../etc/passwd' }],
      }));
      assert.throws(() => untrackedGalleryTargets(root, ['evil']), /refusing a frame segment/,
        'story.json is DATA — a frame naming a path outside its own story dir is refused at the boundary');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // C's 11-case probe, the six that assert a REFUSAL. Two of these are the
  // reason the length bound is now commented as load-bearing: `/etc/passwd`
  // and `frames//x.png` are caught by the EMPTY leading/middle segment failing
  // `{1,128}`, not by anything here reasoning about absolute paths.
  for (const frame of [
    '/etc/passwd',            // absolute — leading empty segment
    'frames//x.png',          // double slash — empty middle segment
    'frames/',                // trailing slash — empty final segment
    '..\\..\\x.png',            // windows backslash
    'frames/../../x.png',     // traversal MID-path, not merely leading
    `frames/${'a'.repeat(129)}.png`, // over the cap
  ]) {
    test(`a frame of ${JSON.stringify(frame)} is REFUSED`, () => {
      const root = mkdtempSync(join(tmpdir(), 'gallery-guard-frame-'));
      try {
        execFileSync('git', ['-C', root, 'init', '-q']);
        const d = join(root, 'demos', 'stories', 'x');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'story.json'), JSON.stringify({
          story: { id: 'x', docs: { title: 'X' } }, beats: [{ status: 'green', frame }],
        }));
        assert.throws(() => untrackedGalleryTargets(root, ['x']), /refusing a frame segment/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  // ...and the two C accepts deliberately, asserted so a later tightening that
  // breaks real frames reds here rather than in a run. `...` is a legal
  // filename, and a leading `-` is only dangerous where a segment reaches argv
  // — it does not here: the git call is a fixed arg array terminated by `--`,
  // and guarded segments are only ever compared against the tracked set.
  for (const frame of ['frames/01-open-studio-on-the-projects-pillar.png', 'frames/...png', 'frames/-rf.png']) {
    test(`a frame of ${JSON.stringify(frame)} is ACCEPTED`, () => {
      const root = mkdtempSync(join(tmpdir(), 'gallery-guard-ok-'));
      try {
        execFileSync('git', ['-C', root, 'init', '-q']);
        const d = join(root, 'demos', 'stories', 'x');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'story.json'), JSON.stringify({
          story: { id: 'x', docs: { title: 'X' } }, beats: [{ status: 'green', frame }],
        }));
        const out = untrackedGalleryTargets(root, ['x']);
        assert.equal(out.length, 2, 'story.json plus the frame, both untracked in this scratch repo');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('a malformed story.json names the FILE, not just a SyntaxError', () => {
    const root = mkdtempSync(join(tmpdir(), 'gallery-guard-badjson-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q']);
      const d = join(root, 'demos', 'stories', 'broken');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'story.json'), '{ not json');
      assert.throws(() => untrackedGalleryTargets(root, ['broken']), /broken\/story\.json is not readable JSON/,
        'a bare SyntaxError names no path, so one bad artifact reds a run without saying which of twelve');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a story.json of literal `null` is refused, not a TypeError on null.beats', () => {
    // `??` guards undefined, not null — C's finding. `null` parses fine.
    const root = mkdtempSync(join(tmpdir(), 'gallery-guard-null-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q']);
      const d = join(root, 'demos', 'stories', 'nul');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'story.json'), 'null');
      assert.throws(() => untrackedGalleryTargets(root, ['nul']), /parsed to null, not an object/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a git failure REFUSES rather than reporting everything as tracked', () => {
    // §15.504. The failure direction matters: "could not check" resolving to
    // "all clear" is how a guard reports absence of evidence as evidence of
    // absence — the same shape as the bug it guards.
    const notARepo = mkdtempSync(join(tmpdir(), 'gallery-guard-norepo-'));
    try {
      mkdirSync(join(notARepo, 'demos', 'stories', 'x'), { recursive: true });
      writeFileSync(join(notARepo, 'demos', 'stories', 'x', 'story.json'),
        JSON.stringify({ story: { id: 'x', docs: { title: 'X' } }, beats: [] }));
      assert.throws(() => untrackedGalleryTargets(notARepo, ['x']), /Refusing/,
        'a failed read is not a state');
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
