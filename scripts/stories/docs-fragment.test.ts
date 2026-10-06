/**
 * docs-fragment.test.ts — the usage doc, generated from the same run that
 * produced the verdict and the clip, as a page of the published docs site.
 *
 * The page is a how-to: imperative steps (the beats' acts), one sentence of
 * context each, the captured frame, and no `data-*` assertion text — that
 * stays in the story. A red step or a red story is said so on the page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWords, CEILINGS } from '../check-docs-budget.mjs';
import { renderDocFragment, docPathFor, mediaDirFor, slugFor, firstSentence, frameUrl } from './docs-fragment.mjs';
// @ts-ignore -- plain .mjs modules
import { withBase } from '../../apps/docs/src/base-links.mjs';
// @ts-ignore
import { SITE_BASE } from '../../apps/docs/src/site-base.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const result = {
  story: { id: 'smoke', docs: { kind: 'how-to', title: 'Find a project from Home' } },
  beats: [
    {
      act: 'Open Studio on Home',
      say: 'Studio opens on Home — the operator pulse across every project. It loads first.',
      status: 'green',
      failures: [],
      frame: 'frames/01-home.png',
      data: { 'page-ready': 'true' },
    },
    {
      act: 'Click through to the Projects pillar',
      say: 'The Projects pillar lists every project forge manages.',
      status: 'green',
      failures: [],
      frame: 'frames/02-projects.png',
      data: { 'page-ready': 'true', 'project-count': '3' },
    },
  ],
};
const ON = '2026-10-05';

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  assert.ok(m, 'the page starts with frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => {
    const i = l.indexOf(':');
    const v = l.slice(i + 1).trim();
    return [l.slice(0, i), v.startsWith('"') ? JSON.parse(v) : v]; // quoted values are JSON strings, valid YAML
  }));
}

test('the page lands in the site how-to directory, named by the slug of its title', () => {
  assert.equal(
    docPathFor(result.story, '/r'),
    '/r/apps/docs/src/content/docs/guides/how-to/find-a-project-from-home.md',
  );
  // A tutorial-kind story is a how-to on the site too: the site has no tutorial type.
  assert.equal(
    docPathFor({ id: 'S1', docs: { kind: 'tutorial', title: 'Onboard an existing project' } }, '/r'),
    '/r/apps/docs/src/content/docs/guides/how-to/onboard-an-existing-project.md',
  );
});

test('frames are published under the site media directory, per story', () => {
  assert.equal(mediaDirFor(result.story, '/r'), '/r/apps/docs/public/media/stories/smoke');
  assert.equal(frameUrl('smoke', 'frames/01-home.png'), '/forge-studio/media/stories/smoke/01-home.png');
});

test('slugFor: lowercase words joined by hyphens; apostrophes dropped', () => {
  assert.equal(slugFor('Find a project from Home'), 'find-a-project-from-home');
  assert.equal(slugFor("Read a ground's own toolchain output in a run report"), 'read-a-grounds-own-toolchain-output-in-a-run-report');
  assert.equal(slugFor('Run the example factory to a merged PR'), 'run-the-example-factory-to-a-merged-pr');
  assert.throws(() => slugFor('!!!'), /no slug/);
});

test('every story in the suite has a distinct page name', () => {
  const dir = join(ROOT, 'tests/stories');
  const titles = readdirSync(dir)
    .filter((f) => f.endsWith('.story.mjs'))
    .map((f) => {
      const m = /docs:\s*\{\s*kind:\s*'[^']*',\s*title:\s*'((?:[^'\\]|\\.)*)'/.exec(readFileSync(join(dir, f), 'utf8'));
      assert.ok(m, `${f} declares docs.title`);
      return m[1].replace(/\\'/g, "'");
    });
  assert.ok(titles.length >= 13, `found ${titles.length} stories`);
  const slugs = titles.map(slugFor);
  assert.equal(new Set(slugs).size, slugs.length, `duplicate page names: ${slugs.join(', ')}`);
});

test('frontmatter carries the site schema fields and names its source story', () => {
  const fm = frontmatter(renderDocFragment(result, { verifiedOn: ON }));
  assert.equal(fm.title, 'Find a project from Home');
  assert.equal(fm.type, 'how-to');
  assert.equal(fm.last_verified, ON);
  assert.equal(fm.generated_from, 'tests/stories/smoke.story.mjs');
  assert.equal(fm.covers, '[tests/stories/smoke.story.mjs]');
  assert.ok(fm.owner && fm.owner.length > 0, 'owner is set');
  assert.ok(fm.description && fm.description.length <= 160, 'description is set and at most 160 chars');
});

test('no h1 in the body: the site renders the title', () => {
  assert.doesNotMatch(renderDocFragment(result, { verifiedOn: ON }), /^# /m);
});

test('every beat becomes one numbered, imperative step, in order', () => {
  const md = renderDocFragment(result, { verifiedOn: ON });
  assert.match(md, /## 1\. Open Studio on Home/);
  assert.match(md, /## 2\. Click through to the Projects pillar/);
  assert.ok(md.indexOf('## 1.') < md.indexOf('## 2.'));
});

test('each step carries exactly one sentence of context: the first of the narration', () => {
  const md = renderDocFragment(result, { verifiedOn: ON });
  assert.match(md, /Studio opens on Home — the operator pulse across every project\./);
  assert.doesNotMatch(md, /It loads first/, 'the second sentence is cut');
  assert.match(md, /The Projects pillar lists every project forge manages\./);
});

test('firstSentence: up to the first terminal punctuation followed by a space or the end', () => {
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('Cap it at $2. Then run.'), 'Cap it at $2.');
  assert.equal(firstSentence('No stop at all'), 'No stop at all');
  assert.equal(firstSentence('Line one\ncontinues. Next.'), 'Line one continues.');
});

test('each step embeds its frame from the site media path, under the site base', () => {
  const md = renderDocFragment(result, { verifiedOn: ON });
  assert.match(md, /!\[Open Studio on Home\]\(\/forge-studio\/media\/stories\/smoke\/01-home\.png\)/);
  assert.match(md, /\/forge-studio\/media\/stories\/smoke\/02-projects\.png/);
});

test('every URL the emitter writes is already base-aware: the site rewrite plugin changes none of them', () => {
  // kills: an emitter that writes root-absolute `/media/...` and leaves the
  // raw .md twin (which the plugin never touches) pointing outside the site
  const md = renderDocFragment(result, { verifiedOn: ON });
  const urls = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, 'the page carries its frames');
  assert.deepEqual(urls.filter((u) => withBase(u, SITE_BASE) !== u), []);
  assert.equal(SITE_BASE, '/forge-studio');
});

test('no data-* attribute or asserted value reaches the page', () => {
  const md = renderDocFragment(result, { verifiedOn: ON });
  assert.doesNotMatch(md, /data-[a-z]/);
  assert.doesNotMatch(md, /project-count|page-ready/);
  assert.doesNotMatch(md, /<details>/);
});

test('a red beat is said to be red on the page, with no assertion text', () => {
  const red = {
    ...result,
    beats: [{ ...result.beats[0], status: 'red', failures: ['data-project-count: expected "3", absent from the page'] }, result.beats[1]],
  };
  const md = renderDocFragment(red, { verifiedOn: ON });
  assert.match(md, /This step is RED — not verified working/);
  assert.match(md, /This story did not pass/);
  assert.doesNotMatch(md, /data-[a-z]/);
});

test('a green story carries no red banner', () => {
  assert.doesNotMatch(renderDocFragment(result, { verifiedOn: ON }), /RED|did not pass/);
});

test('the source comment tells an editor where to make a change', () => {
  assert.match(
    renderDocFragment(result, { verifiedOn: ON }),
    /<!-- Generated by `npm run stories -- --story smoke` from tests\/stories\/smoke\.story\.mjs\. Do not hand-edit: edit the story and re-run it\. -->/,
  );
});

test('verifiedOn is required and must be a YYYY-MM-DD date', () => {
  assert.throws(() => renderDocFragment(result, {} as never), /verifiedOn/);
  assert.throws(() => renderDocFragment(result, { verifiedOn: '5 Oct' }), /verifiedOn/);
});

test('the media directory refuses a story id that is not one safe path segment', () => {
  // writeHowTo removes this directory whole before publishing frames into it.
  for (const id of ['..', '../x', 'a/b', '', '.hidden/..']) {
    assert.throws(() => mediaDirFor({ id, docs: { title: 't' } }, '/r'), /unsafe story id/, id);
  }
  assert.equal(mediaDirFor({ id: 'S10', docs: { title: 't' } }, '/r'), '/r/apps/docs/public/media/stories/S10');
});

// --- Condensed page: a story whose full render exceeds the how-to ceiling ---

const FIXTURES = join(ROOT, 'scripts/stories/fixtures');
const loadFixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

test('a story whose full render fits the ceiling renders exactly as before (S7, 26 beats)', () => {
  const s7 = loadFixture('S7-beats.json');
  const md = renderDocFragment(s7, { verifiedOn: ON });
  assert.ok(countWords(md) <= CEILINGS['how-to'], 'the S7 full render fits');
  assert.equal(md, readFileSync(join(FIXTURES, 'S7-howto.golden.md'), 'utf8'));
  assert.match(md, /^## 1\. /m);
});

test('a story over the ceiling renders the condensed page: acts, one item per beat, no say text', () => {
  const s10 = loadFixture('S10-beats.json');
  assert.equal(s10.beats.length, 61);
  const md = renderDocFragment(s10, { verifiedOn: ON });
  assert.ok(countWords(md) <= CEILINGS['how-to'], `condensed S10 is ${countWords(md)} words`);
  assert.match(md, /^## Act 1$/m);
  assert.match(md, /^## Act 2$/m);
  assert.match(md, /Each step is one recorded action; open a step's picture to see the screen\./);
  assert.equal((md.match(/^\d+\. /gm) ?? []).length, 61);
  assert.match(md, /^61\. /m); // numbering continues across acts
  assert.doesNotMatch(md, /ACT 2 —/);
  assert.doesNotMatch(md, /^## \d+\./m);
  assert.equal((md.match(/!\[/g) ?? []).length, 61);
  assert.ok(md.includes('/media/stories/S10/'), 'frames are present');
  assert.doesNotMatch(md, new RegExp(s10.beats[0].say.slice(0, 30)), 'the say sentence is omitted');
  assert.equal(frontmatter(md).type, 'how-to');
});

test('a red beat is marked on its item in the condensed page, and the red banner stays', () => {
  const s10 = loadFixture('S10-beats.json');
  const beats = s10.beats.map((b: { status: string }, i: number) => (i === 4 ? { ...b, status: 'red' } : b));
  const md = renderDocFragment({ ...s10, beats }, { verifiedOn: ON });
  assert.match(md, /^5\. .* — \*\*RED, not verified\.\*\*$/m);
  assert.equal((md.match(/RED, not verified\./g) ?? []).length, 1);
  assert.match(md, /This story did not pass/);
});

test('a long single-act story condenses under one Steps heading', () => {
  const beats = Array.from({ length: 70 }, (_, i) => ({
    act: `do the thing number ${i + 1} with some more words in it`,
    say: `Sentence one for step ${i + 1} that is long enough to matter here. Second sentence.`,
    status: 'green',
    failures: [],
    frame: `frames/${String(i + 1).padStart(2, '0')}-x.png`,
  }));
  const md = renderDocFragment({ story: result.story, beats }, { verifiedOn: ON });
  assert.match(md, /^## Steps$/m);
  assert.doesNotMatch(md, /^## Act /m);
  assert.match(md, /^1\. Do the thing number 1 /m); // first letter capitalised
  assert.equal((md.match(/^\d+\. /gm) ?? []).length, 70);
});
