/**
 * docs-fragment.mjs — the usage doc, rendered from the run that just produced
 * the verdict and the clip.
 *
 * 1.0.md §3: one script yields three artifacts so the tests, the demos and the
 * docs cannot drift from each other. A doc hand-written beside a test goes
 * stale silently; a doc derived from the passing run cannot.
 *
 * Shape: a how-to page of the published site. Each beat is one numbered step —
 * the `act` is the (imperative) heading, the first sentence of `say` is the
 * one line of context, and the captured frame is the picture. The asserted
 * `data-*` state stays in the story: it is the test's contract, not the
 * reader's.
 *
 * A story whose full page exceeds the how-to word ceiling renders the condensed
 * page instead (`renderCondensed`): the acts as headings, one line per beat.
 *
 * A RED beat is marked red, and a story with any red beat says so at the top.
 * A story that failed must never emit a confident how-to telling an operator
 * to do something that does not work.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { assertSafeStoryId } from './sweep.mjs';
import { CEILINGS, countWords } from '../check-docs-budget.mjs';

/** The site directory every generated how-to lands in. */
export const HOWTO_DIR = 'apps/docs/src/content/docs/guides/how-to';
/** The site directory a story's frames are published under (served at /media/stories/). */
export const MEDIA_DIR = 'apps/docs/public/media/stories';
/** The owner the site footer names on every generated page. */
export const GENERATED_OWNER = 'parsoFish';

/** A page name from a story title: lowercase words joined by hyphens. */
export function slugFor(title) {
  const slug = String(title).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug === '') throw new Error(`docs.title ${JSON.stringify(title)} yields no slug`);
  return slug;
}

/** Where this story's how-to page belongs. Every story kind is a how-to on the site. */
export function docPathFor(story, root) {
  return join(root, HOWTO_DIR, `${slugFor(story.docs.title)}.md`);
}

/** Where this story's frames are copied for the site. */
export function mediaDirFor(story, root) {
  assertSafeStoryId(story.id); // the directory is removed whole by writeHowTo
  return join(root, MEDIA_DIR, story.id);
}

/** The site URL of a beat's captured frame (`frames/01-x.png` → `/media/stories/<id>/01-x.png`). */
export function frameUrl(storyId, frame) {
  return `/media/stories/${storyId}/${basename(frame)}`;
}

/** The first sentence of a beat's narration, on one line. */
export function firstSentence(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  return m ? m[0] : flat;
}

function renderBeat(storyId, beat, index) {
  const lines = [`## ${index + 1}. ${beat.act}`, '', firstSentence(beat.say), ''];
  if (beat.status === 'red') {
    lines.push('> **This step is RED — not verified working.** The run did not see the page this step describes.', '');
  }
  if (beat.frame) lines.push(`![${beat.act}](${frameUrl(storyId, beat.frame)})`, '');
  return lines.join('\n');
}

const ACT_PREFIX = /^ACT (\d+) — /;
const CONDENSED_INTRO = "Each step is one recorded action; open a step's picture to see the screen.";

/** The act text without its `ACT n — ` prefix, first letter capitalised. */
function condensedAct(act) {
  const text = String(act).replace(ACT_PREFIX, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Split beats into acts by the `ACT n — ` prefix; beats before the first marker are act 1. */
function groupByAct(beats) {
  const groups = [];
  let current = null;
  beats.forEach((beat, index) => {
    const m = ACT_PREFIX.exec(String(beat.act));
    if (current === null || (m && Number(m[1]) !== current.n)) {
      current = { n: m ? Number(m[1]) : 1, items: [] };
      groups.push(current);
    }
    current.items.push({ beat, index });
  });
  return groups;
}

function condensedItem(storyId, beat, index) {
  const text = condensedAct(beat.act);
  const mark = beat.status === 'red' ? ' — **RED, not verified.**' : '';
  const lines = [`${index + 1}. ${text}${mark}`];
  if (beat.frame) lines.push(`   ![${text}](${frameUrl(storyId, beat.frame)})`);
  return lines.join('\n');
}

function renderCondensed(head, storyId, beats) {
  const groups = groupByAct(beats);
  const out = [head, CONDENSED_INTRO, ''];
  for (const g of groups) {
    out.push(groups.length >= 2 ? `## Act ${g.n}` : '## Steps', '');
    out.push(g.items.map(({ beat, index }) => condensedItem(storyId, beat, index)).join('\n'), '');
  }
  return out.join('\n');
}

/**
 * Render the whole page. Pure — the caller writes it and copies the frames.
 * `verifiedOn` (YYYY-MM-DD) is the run's date: the page was checked against
 * the product by that run.
 */
export function renderDocFragment(result, { verifiedOn } = {}) {
  if (typeof verifiedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) {
    throw new Error(`renderDocFragment: verifiedOn must be a YYYY-MM-DD date, got ${JSON.stringify(verifiedOn)}`);
  }
  const { story, beats } = result;
  const source = `tests/stories/${story.id}.story.mjs`;
  const anyRed = beats.some((b) => b.status === 'red');
  const head = [
    '---',
    `title: ${JSON.stringify(story.docs.title)}`,
    `description: ${JSON.stringify(`${story.docs.title}, step by step, as recorded by a run of forge's story suite.`)}`,
    'type: how-to',
    `owner: ${GENERATED_OWNER}`,
    `last_verified: ${verifiedOn}`,
    `covers: [${source}]`,
    `generated_from: ${source}`,
    '---',
    '',
    `<!-- Generated by \`npm run stories -- --story ${story.id}\` from ${source}. Do not hand-edit: edit the story and re-run it. -->`,
    '',
  ];
  if (anyRed) {
    head.push(
      '> **This story did not pass.** The steps marked RED describe what the flow is meant to do, not what it does today.',
      '',
    );
  }
  const headText = head.join('\n');
  const full = `${headText}\n${beats.map((b, i) => renderBeat(story.id, b, i)).join('\n')}`;
  // The ceiling and the count are check-docs-budget's: one source. Over it, the page condenses.
  return countWords(full) > CEILINGS['how-to'] ? renderCondensed(headText, story.id, beats) : full;
}

/**
 * Write the run's how-to page and publish the frames it shows. The story's
 * media directory is its own (`mediaDirFor`), so it is replaced whole: a frame
 * a renamed beat no longer captures must not linger on the site.
 */
export function writeHowTo(result, root, now = new Date()) {
  const { story, beats } = result;
  const media = mediaDirFor(story, root);
  rmSync(media, { recursive: true, force: true });
  mkdirSync(media, { recursive: true });
  for (const beat of beats) {
    if (beat.frame) copyFileSync(join(root, 'demos', 'stories', story.id, beat.frame), join(media, basename(beat.frame)));
  }
  const page = docPathFor(story, root);
  mkdirSync(dirname(page), { recursive: true });
  writeFileSync(page, renderDocFragment(result, { verifiedOn: now.toISOString().slice(0, 10) }));
  return page;
}
