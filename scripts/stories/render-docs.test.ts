/**
 * render-docs.test.ts — a re-render of the story how-tos from the recorded run.
 *
 * The recorded result (`demos/stories/<id>/story.json`) is all a page needs, so
 * a rendering change regenerates every page with no story run. The page's
 * `last_verified` is the date the product was last checked: a re-render keeps
 * the one already on the page and refuses, by name, when it has none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocs, recordedStoryIds } from './render-docs.mjs';
import { docPathFor } from './docs-fragment.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'render-docs.mjs');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function story(id: string, title: string) {
  return { id, docs: { kind: 'how-to', title } };
}

/** A temp repo root holding a recorded run for `id` and (optionally) its existing page. */
function fixtureRoot(opts: { id?: string; title?: string; page?: string | null } = {}) {
  const { id = 'smoke', title = 'Find a project from Home', page = '2026-10-01' } = opts;
  const root = mkdtempSync(join(tmpdir(), 'render-docs-'));
  const dir = join(root, 'demos', 'stories', id);
  mkdirSync(join(dir, 'frames'), { recursive: true });
  writeFileSync(join(dir, 'frames', '01-home.png'), PNG);
  writeFileSync(join(dir, 'story.json'), JSON.stringify({
    story: story(id, title),
    beats: [{ act: 'Open Studio on Home', say: 'Studio opens.', status: 'green', failures: [], frame: 'frames/01-home.png' }],
    reap: {},
  }));
  const pagePath = docPathFor(story(id, title), root);
  if (page !== null) {
    mkdirSync(dirname(pagePath), { recursive: true });
    writeFileSync(pagePath, page === '' ? '---\ntitle: "x"\n---\nold\n' : `---\ntitle: "x"\nlast_verified: ${page}\n---\nold body\n`);
  }
  return { root, pagePath, id };
}

test('re-renders the page from the recorded run and keeps the page\'s own last_verified date', () => {
  const { root, pagePath } = fixtureRoot({ page: '2026-10-01' });
  try {
    const written = renderDocs(root, ['smoke']);
    assert.deepEqual(written, [pagePath]);
    const md = readFileSync(pagePath, 'utf8');
    assert.match(md, /^last_verified: 2026-10-01$/m, 'the date on the page, never today\'s');
    assert.match(md, /class="story-hero"/, 'the new rendering');
    assert.doesNotMatch(md, /old body/);
    assert.ok(existsSync(join(root, 'apps/docs/public/media/stories/smoke/01-home.png')), 'frames are published');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a missing page by name, writing nothing', () => {
  const { root, pagePath } = fixtureRoot({ page: null });
  try {
    assert.throws(() => renderDocs(root, ['smoke']), /render-docs: smoke: no existing page/);
    assert.equal(existsSync(pagePath), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a page with no last_verified by name', () => {
  const { root } = fixtureRoot({ page: '' });
  try {
    assert.throws(() => renderDocs(root, ['smoke']), /render-docs: smoke: .* no YYYY-MM-DD last_verified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a story with no recorded result, an unsafe id, and a result for a different story', () => {
  const { root } = fixtureRoot();
  try {
    assert.throws(() => renderDocs(root, ['nope']), /render-docs: nope: no recorded result/);
    assert.throws(() => renderDocs(root, ['../x']), /unsafe story id/);
    writeFileSync(join(root, 'demos/stories/smoke/story.json'), JSON.stringify({ story: story('other', 't'), beats: [] }));
    assert.throws(() => renderDocs(root, ['smoke']), /render-docs: smoke: .* is not a story run result/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a refusal on one story leaves every story untouched (plan all, then write)', () => {
  const a = fixtureRoot({ id: 'smoke', page: '2026-10-01' });
  try {
    const b = join(a.root, 'demos/stories/proof');
    mkdirSync(join(b, 'frames'), { recursive: true });
    writeFileSync(join(b, 'story.json'), JSON.stringify({ story: story('proof', 'Onboard a thing'), beats: [] })); // no page for it
    assert.throws(() => renderDocs(a.root, ['smoke', 'proof']), /render-docs: proof: no existing page/);
    assert.match(readFileSync(a.pagePath, 'utf8'), /old body/, 'smoke was not rewritten');
  } finally { rmSync(a.root, { recursive: true, force: true }); }
});

test('--all renders every story with a recorded result', () => {
  const { root } = fixtureRoot();
  try {
    assert.deepEqual(recordedStoryIds(root), ['smoke']);
    const run = spawnSync(process.execPath, ['--experimental-strip-types', CLI, '--all', '--root', root], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /render-docs: wrote .*find-a-project-from-home\.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the CLI exits 1 on a refusal naming the story, and 2 on bad usage', () => {
  const { root } = fixtureRoot({ page: null });
  try {
    const refused = spawnSync(process.execPath, ['--experimental-strip-types', CLI, 'smoke', '--root', root], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /render-docs: smoke: no existing page/);
    for (const argv of [[], ['--all', 'smoke'], ['--bogus']]) {
      const bad = spawnSync(process.execPath, ['--experimental-strip-types', CLI, ...argv, '--root', root], { encoding: 'utf8' });
      assert.equal(bad.status, 2, JSON.stringify(argv));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
