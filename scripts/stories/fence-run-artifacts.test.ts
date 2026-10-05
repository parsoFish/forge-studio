/**
 * fence-run-artifacts.test.ts — what a story run may leave behind as its own
 * output: frames + story.json, the gallery index, its generated how-to page on
 * the docs site and the frames published for that page. Everything else it
 * wrote is an escape the fence restores or removes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fenceBreaches, parseGitPorcelain } from './sweep.mjs';

const porcelainZ = (...entries: string[]) => `${entries.join('\0')}\0`;

const S8_PAGE = 'apps/docs/src/content/docs/guides/how-to/install-library-components-from-the-community.md';

test('the run\'s OWN artifacts are never a breach, wherever the fence is called', () => {
  // The frames and story.json, the gallery index, the generated how-to page and
  // the frames published for it are the run's output. Listing all of them makes
  // the fence independent of where in the run it is called — there is no
  // ordering left to remember (S15.80).
  const after = parseGitPorcelain(
    porcelainZ('?? demos/stories/S8/', ' M demos/stories/index.html', ` M ${S8_PAGE}`, '?? apps/docs/public/media/stories/S8/'),
  );
  assert.deepEqual(fenceBreaches([], after, 'S8', null, { docPage: S8_PAGE }), { restore: [], remove: [], defer: [], unknown: [] });
});

test('another story\'s artifact IS a breach — the allowance is this run\'s id and page, not the gallery', () => {
  const after = parseGitPorcelain(porcelainZ(
    ' M demos/stories/S2/story.json',
    ' M apps/docs/src/content/docs/guides/how-to/create-a-new-agent.md',
    '?? apps/docs/public/media/stories/S2/01-a.png',
  ));
  assert.deepEqual(fenceBreaches([], after, 'S8', null, { docPage: S8_PAGE }), {
    restore: ['demos/stories/S2/story.json', 'apps/docs/src/content/docs/guides/how-to/create-a-new-agent.md'],
    remove: ['apps/docs/public/media/stories/S2/01-a.png'],
    defer: [],
    unknown: [],
  });
});

test('the retired docs/how-to and docs/tutorials pages are no longer a run\'s artifacts', () => {
  const after = parseGitPorcelain(porcelainZ('?? docs/how-to/S8.md', '?? docs/tutorials/S8.md'));
  assert.deepEqual(fenceBreaches([], after, 'S8', null, { docPage: S8_PAGE }).remove, ['docs/how-to/S8.md', 'docs/tutorials/S8.md']);
});

test('a COLLAPSED untracked ancestor of this run\'s artifacts is expanded and judged file by file', () => {
  // On the first run nothing under apps/docs/public/ is tracked, so git reports
  // the top-most untracked directory. Judged whole, the run's own frames would
  // be an escape; deferred whole, a foreign file beside them would ride along.
  const after = [{ xy: '??', path: 'apps/docs/public/' }];
  const expand = (p: string) => {
    assert.equal(p, 'apps/docs/public/');
    return ['apps/docs/public/media/stories/S8/01-a.png', 'apps/docs/public/stray.txt'];
  };
  assert.deepEqual(fenceBreaches([], after, 'S8', null, { docPage: S8_PAGE, expand }), {
    restore: [], remove: ['apps/docs/public/stray.txt'], defer: [], unknown: [],
  });
});

test('a failed expansion of an artifact ancestor HOLDS it as unknown, never removes it', () => {
  const after = [{ xy: '??', path: 'apps/docs/src/content/docs/guides/' }];
  const expand = () => { throw new Error('git status failed'); };
  const b = fenceBreaches([], after, 'S8', null, { docPage: S8_PAGE, expand });
  assert.deepEqual([b.restore, b.remove, b.defer], [[], [], []]);
  assert.deepEqual(b.unknown.map((u: { path: string }) => u.path), ['apps/docs/src/content/docs/guides/']);
});
