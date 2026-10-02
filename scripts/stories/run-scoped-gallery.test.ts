/**
 * run-scoped-gallery.test.ts — row 181 (measured twice), `forge-8vfn.8.5.17`.
 *
 * THE DEFECT. `npm run stories` runs every story in ONE invocation
 * (`run.mjs`'s `for (const story of stories) exitCode = (await runStory(...))
 * || exitCode;`). At the end of each story, `run-story.mjs` called
 * `regenerateGallery(ROOT, wroteThisRun)` where `wroteThisRun =
 * [writeStoryJson(result, ROOT)]` — ONLY that story's own id. A story's own
 * `story.json` and frames are untracked by construction the instant they are
 * written (that is what the exemption exists to tolerate), so the SECOND
 * story to finish in a multi-story run saw the FIRST story's still-untracked
 * artefacts as foreign and `regenerateGallery` THREW — before that second
 * story's own verdict line even printed. The throw propagated out of
 * `runStory`, and `run.mjs`'s `for` loop has no try/catch around the call, so
 * every story still queued after the one that threw never ran at all. In the
 * real incident this measured S2 (the third story) aborting the batch mid-run,
 * with S10's artefacts (the second story, by id order 1, 10, 2, 3...) as the
 * foreign-looking entry; S3-S9 never ran.
 *
 * THE FIX, `regenerateGalleryForRun` (gallery.mjs). `writtenThisRun` is ONE
 * array for the WHOLE invocation, owned by `run.mjs`'s loop, threaded into
 * `runStory`, and mutated (pushed onto, never replaced) by this function as
 * each story writes its own artefact — so the next story's own call sees
 * every id written so far. It NEVER throws: a regen failure is returned as a
 * reason string, which `run-story.mjs` folds into THIS story's own
 * containment verdict (the same shape every other post-beat containment gate
 * already uses) rather than letting it abort `run.mjs`'s loop.
 *
 * These doors drive the REAL functions — `writeStoryJson`, `regenerateGallery`
 * and the new `regenerateGalleryForRun` — against a real, temporary git repo.
 * `runStory` and `main` cannot be exercised as units (they drive a real
 * Playwright browser / boot a real bridge — see `run-story.test.ts` and
 * `run.test.ts`'s own headers for why), so the ordering/wiring claims below
 * are checked the same way those files already do: by reading the source.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { regenerateGallery, regenerateGalleryForRun } from './gallery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A real git repo — the exemption/refusal logic is about TRACKED state. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'run-scoped-gallery-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'door@example.invalid');
  git('config', 'user.name', 'door');
  writeFileSync(join(root, 'README'), 'scratch repo for run-scoped-gallery.test.ts\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

/** Plants one story's own artefacts on disk, UNTRACKED — exactly the state
 *  every story is in the instant its own run finishes, before anyone commits
 *  it. Mirrors the fixture shape `gallery-link-guard.test.ts` already uses. */
function plantStory(root: string, id: string): void {
  const dir = join(root, 'demos', 'stories', id);
  mkdirSync(join(dir, 'frames'), { recursive: true });
  writeFileSync(join(dir, 'frames', '01-a.png'), 'png');
  writeFileSync(join(dir, 'story.json'), JSON.stringify({
    story: { id, docs: { title: `Story ${id}` } },
    beats: [{ status: 'green', frame: 'frames/01-a.png' }],
  }));
}

describe('forge-8vfn.8.5.17 — one invocation\'s stories share their gallery exemptions', () => {
  test('a SECOND story\'s regen does not throw on a FIRST story\'s still-untracked artefacts, in the SAME invocation', () => {
    const root = repo();
    try {
      const writtenThisRun: string[] = [];

      plantStory(root, 'A');
      const failureA = regenerateGalleryForRun(root, writtenThisRun, 'A');
      assert.equal(failureA, null, 'the first story\'s own call must succeed — its own artefacts are exempt');
      assert.deepEqual(writtenThisRun, ['A']);

      // The second story, LATER in the SAME invocation. Its own call must see
      // A's still-untracked story.json/frame as something THIS RUN already
      // accounts for, not as a foreign leftover.
      plantStory(root, 'B');
      const failureB = regenerateGalleryForRun(root, writtenThisRun, 'B');
      assert.equal(
        failureB, null,
        'a second story must not fail because an EARLIER story in the same invocation left untracked artefacts — row 181',
      );
      assert.deepEqual(writtenThisRun, ['A', 'B'], 'both ids accumulate in the one shared array');

      const index = readFileSync(join(root, 'demos', 'stories', 'index.html'), 'utf8');
      assert.match(index, /Story A/, 'the index must still carry the first story — nothing here drops it');
      assert.match(index, /Story B/, 'and the second');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('REPRODUCES row 181 directly: the OLD one-element exempt set throws on an earlier story\'s own artefacts', () => {
    // Pins the defect this door exists to close. `run-story.mjs` used to call
    // `regenerateGallery(ROOT, [writeStoryJson(result, ROOT)])` — passing ONLY
    // this story's own id. If that shape ever comes back, this must red.
    const root = repo();
    try {
      plantStory(root, 'A');
      plantStory(root, 'B');
      assert.throws(
        () => regenerateGallery(root, ['B']),
        (err: Error) => {
          assert.match(err.message, /demos\/stories\/A\/story\.json/, 'names A\'s own, un-exempted artefact');
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a genuinely FOREIGN untracked target — produced by no story in this run — still refuses, as a returned reason, never a throw', () => {
    const root = repo();
    try {
      const writtenThisRun: string[] = [];

      plantStory(root, 'A');
      // A leftover nobody in THIS invocation produced — #703's actual shape:
      // on disk, untracked, and never returned by writeStoryJson this run.
      plantStory(root, 'FOREIGN');

      const failureA = regenerateGalleryForRun(root, writtenThisRun, 'A');
      assert.notEqual(failureA, null, 'a foreign untracked target must still refuse the regen');
      assert.match(failureA as string, /demos\/stories\/FOREIGN/, 'the reason must name the foreign target');
      assert.equal(
        existsSync(join(root, 'demos', 'stories', 'index.html')), false,
        'a refused regen must not have written the index — same contract regenerateGallery already has',
      );

      // THE LOOP CONTINUES. A's own id is still recorded (its own artefacts
      // were never the problem), and the NEXT story in this invocation gets
      // to run and write its own artefacts — the refusal above must not have
      // thrown, which is what let this line run at all.
      assert.deepEqual(writtenThisRun, ['A'], 'A is recorded despite the regen failing on a DIFFERENT, foreign entry');

      plantStory(root, 'B');
      const failureB = regenerateGalleryForRun(root, writtenThisRun, 'B');
      assert.notEqual(failureB, null, 'the foreign target still refuses B\'s own attempt too');
      assert.match(failureB as string, /demos\/stories\/FOREIGN/);
      assert.deepEqual(writtenThisRun, ['A', 'B'], 'B ran and recorded despite A\'s own regen having failed — the batch was not aborted');

      // Once the foreign leftover is gone, the run's own ids regenerate clean.
      rmSync(join(root, 'demos', 'stories', 'FOREIGN'), { recursive: true, force: true });
      const failureAfter = regenerateGalleryForRun(root, writtenThisRun, 'B');
      assert.equal(failureAfter, null, 'with the foreign entry gone, the SAME ids regenerate successfully');
      const index = readFileSync(join(root, 'demos', 'stories', 'index.html'), 'utf8');
      assert.match(index, /Story A/);
      assert.match(index, /Story B/);
      assert.doesNotMatch(index, /FOREIGN/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('forge-8vfn.8.5.17 — wiring: run.mjs and run-story.mjs actually share the exemption, in order', () => {
  const runSrc = () => readFileSync(join(HERE, 'run.mjs'), 'utf8');
  const runStorySrc = () => readFileSync(join(HERE, 'run-story.mjs'), 'utf8');
  const verdictSrc = () => readFileSync(join(HERE, 'run-story-verdict.mjs'), 'utf8');

  test('run.mjs declares ONE writtenThisRun array for the batch, before the story loop', () => {
    const s = runSrc();
    const declAt = s.indexOf('const writtenThisRun = [];');
    assert.notEqual(declAt, -1, 'run.mjs must declare writtenThisRun once, for the whole batch');
    const loopAt = s.indexOf('for (const story of stories)');
    assert.ok(declAt < loopAt, 'writtenThisRun must be declared before the story loop runs');
  });

  test('run.mjs threads writtenThisRun into every runStory call', () => {
    const s = runSrc();
    const callAt = s.indexOf('await runStory(');
    assert.notEqual(callAt, -1, 'run.mjs never awaits runStory( — this door\'s own anchor moved');
    const call = s.slice(callAt, s.indexOf(')', s.indexOf(';', callAt)));
    assert.match(call, /writtenThisRun/, 'runStory must be called WITH the batch\'s shared array, not a fresh one');
  });

  test('run-story.mjs prints this story\'s own verdict line BEFORE calling regenerateGalleryForRun', () => {
    const s = runStorySrc();
    const printAt = s.indexOf('row.status');
    const regenAt = s.indexOf('regenerateGalleryForRun(');
    assert.notEqual(printAt, -1, 'the verdict print must still exist');
    assert.notEqual(regenAt, -1, 'run-story.mjs must call regenerateGalleryForRun — never a bare regenerateGallery( for this purpose');
    assert.ok(printAt < regenAt, 'the verdict line must print before the gallery regen runs, so a regen failure can never suppress it');
  });

  test('run-story.mjs no longer calls the bare one-story regenerateGallery( directly', () => {
    const s = runStorySrc();
    assert.doesNotMatch(
      s, /[^F]regenerateGallery\(ROOT,/,
      'the direct call must be gone — only regenerateGalleryForRun may reach it now',
    );
  });

  test('run-story.mjs folds the regen result into containmentVerdict as galleryRegenFailure, never lets it throw past this function', () => {
    const s = runStorySrc();
    const regenAt = s.indexOf('regenerateGalleryForRun(');
    const handoffAt = s.indexOf('containmentVerdict({', regenAt);
    assert.ok(regenAt !== -1 && handoffAt !== -1 && regenAt < handoffAt);
    const handoff = s.slice(handoffAt, s.indexOf('});', handoffAt));
    assert.match(handoff, /(?<![.\w])galleryRegenFailure(?![.\w:])/, 'the SAME galleryRegenFailure must reach containmentVerdict');
  });

  test('containmentVerdict declares galleryRegenFailure and gates on it before the final green/red return', () => {
    const s = verdictSrc();
    assert.match(s, /function containmentVerdict\(\{[^}]*\bgalleryRegenFailure\b/s, 'containmentVerdict must declare the parameter');
    const gateAt = s.indexOf('if (galleryRegenFailure !== null)');
    const finalReturn = s.indexOf('return (row.status ===');
    assert.notEqual(gateAt, -1, 'the gate must exist');
    assert.notEqual(finalReturn, -1, 'the final green/red return must still exist');
    assert.ok(gateAt < finalReturn, 'the gate must run before the final return');
    assert.match(s.slice(gateAt, gateAt + 300), /return 1;/, 'a gallery regen failure must end the run non-zero');
  });
});
