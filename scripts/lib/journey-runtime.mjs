/**
 * journey-runtime — journeys-as-data runtime for forge's e2e harness.
 *
 * MODEL. A JOURNEY is a user story (e.g. "author a flow from scratch"). A BEAT
 * is one story beat — simultaneously a demo scene (narration + captures) AND a
 * named test case (checks). `defineJourney()` declares the story shape once;
 * beats aren't hand-declared a second time in a parallel data structure. As a
 * beat's `drive(ctx)` function actually runs, the runtime OBSERVES its checks
 * and captures via `createBeatTracker()` — wired into `createAssertions({
 * onCheck })` (journey-assertions.mjs) for checks, and called directly for
 * frame/clip captures — rather than the driver hand-authoring a results tree.
 *
 * This module is pure data + writers: no Playwright imports, no page handles.
 * The harness (e2e-journey.mjs) drives the browser and imports this module to
 * declare its journeys and to render the results/gallery once a run completes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Shared pacing constants, mirroring the journey's TEMPO model
 * (e2e-journey.mjs's READ/WORK/ACT/THINK):
 *  - act      short settle after a click/action.
 *  - think    brief gap during live bursts / between decisions.
 *  - scroll   dwell while watching autonomous work happen.
 *  - dwell    a page the operator reads carefully.
 *  - holdTail trailing hold appended to every clip so a loop settles on its
 *             final state before looping back — every information-reveal
 *             gets viewer processing time (operator pacing mandate).
 */
export const PACE = Object.freeze({ act: 1500, think: 1000, scroll: 3200, dwell: 4200, holdTail: 2600 });

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`defineJourney: ${label} must be a non-empty string (got ${JSON.stringify(value)})`);
  }
}

/**
 * Declare a journey. Validates fail-fast with descriptive errors; stamps each
 * beat's `journey = spec.id`; freezes beats (and the beats array) + the spec
 * itself so a declared journey can't be mutated after the fact.
 *
 * @param {object}   spec
 * @param {string}   spec.id       kebab-case, e.g. "author-flow".
 * @param {string}   spec.title
 * @param {string}   spec.story    the user story this journey demonstrates.
 * @param {object[]} spec.beats    non-empty; each { id, title, narration, drive(ctx), holdMs? }.
 * @param {string[]} [spec.deps]   ids of journeys this one assumes already ran.
 * @param {function} [spec.seed]
 * @param {function} [spec.cleanup]
 * @returns {object} the frozen, validated spec.
 */
export function defineJourney(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('defineJourney: spec must be an object');
  }
  requireNonEmptyString(spec.id, 'spec.id');
  if (!KEBAB_RE.test(spec.id)) {
    throw new Error(`defineJourney: spec.id "${spec.id}" must be kebab-case (e.g. "author-flow")`);
  }
  requireNonEmptyString(spec.title, 'spec.title');
  requireNonEmptyString(spec.story, 'spec.story');

  if (!Array.isArray(spec.beats) || spec.beats.length === 0) {
    throw new Error(`defineJourney("${spec.id}"): beats must be a non-empty array`);
  }

  const seenBeatIds = new Set();
  const beats = spec.beats.map((beat, index) => {
    const where = `beats[${index}]`;
    if (!beat || typeof beat !== 'object') {
      throw new Error(`defineJourney("${spec.id}"): ${where} must be an object`);
    }
    requireNonEmptyString(beat.id, `${where}.id`);
    if (seenBeatIds.has(beat.id)) {
      throw new Error(`defineJourney("${spec.id}"): duplicate beat id "${beat.id}"`);
    }
    seenBeatIds.add(beat.id);
    requireNonEmptyString(beat.title, `${where} ("${beat.id}").title`);
    requireNonEmptyString(beat.narration, `${where} ("${beat.id}").narration`);
    if (typeof beat.drive !== 'function') {
      throw new Error(`defineJourney("${spec.id}"): ${where} ("${beat.id}").drive must be a function`);
    }
    if (beat.holdMs !== undefined && typeof beat.holdMs !== 'number') {
      throw new Error(`defineJourney("${spec.id}"): ${where} ("${beat.id}").holdMs must be a number`);
    }
    return Object.freeze({ ...beat, journey: spec.id });
  });

  if (spec.deps !== undefined && (!Array.isArray(spec.deps) || spec.deps.some((d) => typeof d !== 'string'))) {
    throw new Error(`defineJourney("${spec.id}"): deps must be a string[]`);
  }
  if (spec.seed !== undefined && typeof spec.seed !== 'function') {
    throw new Error(`defineJourney("${spec.id}"): seed must be a function`);
  }
  if (spec.cleanup !== undefined && typeof spec.cleanup !== 'function') {
    throw new Error(`defineJourney("${spec.id}"): cleanup must be a function`);
  }

  return Object.freeze({ ...spec, beats: Object.freeze(beats) });
}

/**
 * Create a tracker that observes checks + captures against a "current beat"
 * one-slot pointer, and rolls them up into a results tree.
 */
export function createBeatTracker() {
  /** @type {Map<string, { title: string, story: string, beats: Map<string, object> }>} */
  const journeys = new Map();
  let current = null; // { journeyId, beatId }

  function ensureJourney(journeyId) {
    let j = journeys.get(journeyId);
    if (!j) {
      j = { title: journeyId, story: '', beats: new Map() };
      journeys.set(journeyId, j);
    }
    return j;
  }

  function ensureBeat(journeyId, beatId) {
    const j = ensureJourney(journeyId);
    let b = j.beats.get(beatId);
    if (!b) {
      b = { title: beatId, narration: '', checks: [], captures: [] };
      j.beats.set(beatId, b);
    }
    return b;
  }

  function begin(journeyId, beatId) {
    if (current) {
      console.warn(`[journey-runtime] begin(${journeyId}/${beatId}) called while ` +
        `${current.journeyId}/${current.beatId} is still active — ending it first`);
    }
    ensureBeat(journeyId, beatId);
    current = { journeyId, beatId };
  }

  function end() {
    if (!current) {
      console.warn('[journey-runtime] end() called with no active beat');
      return;
    }
    current = null;
  }

  /** Wire this straight into createAssertions({ onCheck }). */
  function onCheck({ msg, pass }) {
    if (!current) {
      console.warn(`[journey-runtime] onCheck fired with no active beat (msg: "${msg}")`);
      return;
    }
    const beat = ensureBeat(current.journeyId, current.beatId);
    beat.checks.push({ msg, pass: !!pass });
  }

  /** @param {{kind:'frame'|'clip', file:string, caption:string, sizeBytes?:number}} capture */
  function recordCapture({ kind, file, caption, sizeBytes }) {
    if (!current) {
      console.warn(`[journey-runtime] recordCapture fired with no active beat (file: "${file}")`);
      return;
    }
    const beat = ensureBeat(current.journeyId, current.beatId);
    const capture = { kind, file, caption };
    if (sizeBytes !== undefined) capture.sizeBytes = sizeBytes;
    beat.captures.push(capture);
  }

  /** Register title/story/beat metadata for a journey as it executes, so
   *  results carry titles/narration even for beats whose drive() never fired. */
  function journeyMeta(journey) {
    const j = ensureJourney(journey.id);
    j.title = journey.title;
    j.story = journey.story;
    for (const beat of journey.beats) {
      const b = ensureBeat(journey.id, beat.id);
      b.title = beat.title;
      b.narration = beat.narration;
    }
  }

  function toResults({ project, mode, requestedJourneys, executedJourneys, generatedAt }) {
    let checksTotal = 0;
    let checksFailed = 0;
    let framesTotal = 0;
    let clipsTotal = 0;
    const journeysOut = {};

    for (const jid of executedJourneys) {
      const j = journeys.get(jid);
      if (!j) continue;
      const beatsOut = {};
      let jChecksTotal = 0;
      let jChecksFailed = 0;
      for (const [bid, b] of j.beats) {
        const pass = b.checks.every((c) => c.pass);
        beatsOut[bid] = { title: b.title, narration: b.narration, checks: b.checks, captures: b.captures, pass };
        jChecksTotal += b.checks.length;
        jChecksFailed += b.checks.filter((c) => !c.pass).length;
        framesTotal += b.captures.filter((c) => c.kind === 'frame').length;
        clipsTotal += b.captures.filter((c) => c.kind === 'clip').length;
      }
      journeysOut[jid] = {
        title: j.title,
        story: j.story,
        beats: beatsOut,
        pass: jChecksFailed === 0,
        checksTotal: jChecksTotal,
        checksFailed: jChecksFailed,
      };
      checksTotal += jChecksTotal;
      checksFailed += jChecksFailed;
    }

    return {
      generatedAt: generatedAt ?? new Date().toISOString(),
      project,
      mode,
      requestedJourneys,
      executedJourneys,
      journeys: journeysOut,
      totals: { checksTotal, checksFailed, framesTotal, clipsTotal },
      exitCode: checksFailed > 0 ? 1 : 0,
    };
  }

  return { begin, end, onCheck, recordCapture, journeyMeta, toResults };
}

function renderCapture(c) {
  if (c.kind === 'frame') {
    return `<figure><img loading="lazy" src="frames/${c.file}"/><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`;
  }
  return `<figure><video autoplay loop muted playsinline src="clips/${c.file}"></video><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`;
}

function renderBeat(beat) {
  const captures = beat.captures.map(renderCapture).join('\n');
  return `<div class="beat"><h3>${beat.title}</h3><p class="narration">${beat.narration}</p>${captures}</div>`;
}

function renderJourney(j) {
  const passed = j.checksTotal - j.checksFailed;
  const badgeClass = j.checksFailed > 0 ? 'badge-fail' : 'badge-ok';
  const badge = `<span class="badge ${badgeClass}">${passed}/${j.checksTotal} checks green</span>`;
  const beats = Object.values(j.beats).map(renderBeat).join('\n');
  return `<section><h2>${j.title}</h2><p class="story">${j.story}</p>${badge}${beats}</section>`;
}

/**
 * Render the full walkthrough gallery as an HTML string. Style adapted from
 * e2e-journey.mjs's writeIndex() so the gallery doesn't regress visually.
 *
 * @param {object} results               a toResults() output.
 * @param {object} [opts]
 * @param {string} [opts.videoName]      relative path to the full-run video; omit to skip the header video.
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 */
export function renderGallery(results, { videoName, title = 'Forge Studio — the operator walkthrough', subtitle = '' } = {}) {
  const journeysHtml = results.executedJourneys
    .map((jid) => (results.journeys[jid] ? renderJourney(jid, results.journeys[jid]) : ''))
    .join('\n');

  const videoCaption = results.mode === 'full'
    ? 'Full walkthrough'
    : `Partial walkthrough — journeys: ${results.executedJourneys.join(', ')}`;
  const videoHtml = videoName
    ? `<h2>${videoCaption}</h2><video src="${videoName}" controls autoplay muted loop></video>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}h2{margin-top:8px;border-bottom:1px solid #21262d;padding-bottom:6px}
video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
section{margin:40px 0}.story{color:#8b949e;font-size:13px;margin:.2rem 0 1rem}
.beat{margin:24px 0}h3{margin-bottom:4px}.narration{color:#8b949e;font-size:13px;margin:.2rem 0 1rem}
figure{margin:24px 0;padding:0}figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:12px;margin:6px 0}
.badge-ok{background:#0d3320;color:#3fb950}.badge-fail{background:#3d0d12;color:#f85149}</style></head>
<body><h1>${title}</h1>
${subtitle ? `<p>${subtitle}</p>` : ''}
${videoHtml}
${journeysHtml}
</body></html>`;
}

/** Write the JSON results tree, creating parent directories as needed. */
export function writeResultsFile(path, results) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(results, null, 2));
}

/** Write the rendered gallery HTML, creating parent directories as needed. */
export function writeGalleryFile(path, html) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
