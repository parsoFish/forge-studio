#!/usr/bin/env node
/**
 * render-docs.mjs — re-render story how-tos from the recorded run, spending nothing.
 *
 * `run-story.mjs` writes a how-to as the last act of a funded run. When only the
 * RENDERING changes (D-42), the recorded result is already on disk —
 * `demos/stories/<id>/story.json` is the run result `{ story, beats, ... }` and
 * `demos/stories/<id>/frames/` its pictures — so the page can be regenerated
 * with no story run. The page's `last_verified` is the date the PRODUCT was
 * last checked against that run: a re-render checks nothing new, so it keeps
 * the date already on the page and never stamps today's.
 *
 * Refuses, naming the story, when: the id is not one safe path segment, the
 * recorded result is missing or unreadable, it names a different story, the
 * page it would replace does not exist, or that page carries no valid
 * `last_verified`. All stories are planned before any is written, so a refusal
 * leaves the tree untouched.
 *
 * Usage: node scripts/stories/render-docs.mjs <story-id>... | --all  [--root <dir>]
 * Exit: 0 rendered · 1 refused or unreadable · 2 bad usage.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSafeStoryId } from './sweep.mjs';
import { docPathFor, writeHowTo } from './docs-fragment.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORIES_DIR = join('demos', 'stories');

/** Every story id with a recorded result under `demos/stories/`. */
export function recordedStoryIds(root) {
  const dir = join(root, STORIES_DIR);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'story.json')))
    .map((e) => e.name)
    .sort();
}

/** The `last_verified` date the page already carries, or a named refusal. */
function lastVerifiedOf(pagePath, id) {
  if (!existsSync(pagePath)) {
    throw new Error(`render-docs: ${id}: no existing page at ${pagePath} — nothing to take last_verified from`);
  }
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(pagePath, 'utf8'));
  const date = m && /^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(m[1]);
  if (!date) throw new Error(`render-docs: ${id}: ${pagePath} has no YYYY-MM-DD last_verified in its frontmatter`);
  return date[1];
}

/** Read and check one story's recorded result and the page date it renders under. */
function planStory(root, id) {
  assertSafeStoryId(id);
  const file = join(root, STORIES_DIR, id, 'story.json');
  if (!existsSync(file)) throw new Error(`render-docs: ${id}: no recorded result at ${file}`);
  let result;
  try {
    result = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`render-docs: ${id}: ${file} is not valid JSON: ${err.message}`);
  }
  if (result?.story?.id !== id || typeof result.story.docs?.title !== 'string' || !Array.isArray(result.beats)) {
    throw new Error(`render-docs: ${id}: ${file} is not a story run result (needs story.id === "${id}", story.docs.title and beats[])`);
  }
  const verifiedOn = lastVerifiedOf(docPathFor(result.story, root), id);
  return { id, result, now: new Date(`${verifiedOn}T00:00:00Z`) };
}

/**
 * Re-render the pages of `ids` (all recorded stories when `ids` is null).
 * Returns the written page paths.
 */
export function renderDocs(root, ids = null) {
  const wanted = ids ?? recordedStoryIds(root);
  if (wanted.length === 0) throw new Error('render-docs: no story to render');
  const plans = wanted.map((id) => planStory(root, id));
  return plans.map(({ result, now }) => writeHowTo(result, root, now));
}

function main(argv) {
  const args = [...argv];
  let root = REPO;
  const r = args.indexOf('--root');
  if (r !== -1) {
    root = resolve(args[r + 1] ?? '');
    args.splice(r, 2);
  }
  const all = args.includes('--all');
  const ids = args.filter((a) => a !== '--all');
  if (all === (ids.length > 0) || ids.some((a) => a.startsWith('-'))) {
    process.stderr.write('usage: render-docs.mjs <story-id>... | --all  [--root <dir>]\n');
    return 2;
  }
  try {
    for (const page of renderDocs(root, all ? null : ids)) process.stdout.write(`render-docs: wrote ${page}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
