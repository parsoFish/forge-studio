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

  /** Captures fired outside any beat (e.g. the end card) land here instead of
   *  being dropped; they render as a trailing epilogue section in the gallery. */
  const epilogueCaptures = [];

  /** @param {{kind:'frame'|'clip', file:string, caption:string, sizeBytes?:number, key?:boolean}} capture
   *  `key` flags a still frame as gallery-worthy: the gallery shows only
   *  key-flagged frames per beat (falling back to the first 3 when none are
   *  flagged); the full capture set is always retained here + in results.json. */
  function recordCapture({ kind, file, caption, sizeBytes, key }) {
    const capture = { kind, file, caption };
    if (sizeBytes !== undefined) capture.sizeBytes = sizeBytes;
    if (key) capture.key = true;
    if (!current) {
      epilogueCaptures.push(capture);
      return;
    }
    const beat = ensureBeat(current.journeyId, current.beatId);
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

    framesTotal += epilogueCaptures.filter((c) => c.kind === 'frame').length;
    clipsTotal += epilogueCaptures.filter((c) => c.kind === 'clip').length;

    return {
      generatedAt: generatedAt ?? new Date().toISOString(),
      project,
      mode,
      requestedJourneys,
      executedJourneys,
      journeys: journeysOut,
      epilogue: { captures: epilogueCaptures },
      totals: { checksTotal, checksFailed, framesTotal, clipsTotal },
      exitCode: checksFailed > 0 ? 1 : 0,
    };
  }

  return { begin, end, onCheck, recordCapture, journeyMeta, toResults };
}

/**
 * Frame captures are recorded with a BARE filename (e.g. "01-name.png" — see
 * frame() in e2e-journey.mjs) so the "frames/" prefix is applied here, once.
 * Clip captures are recorded ALREADY prefixed (e.g. "clips/name.webm" — see
 * recordClip() in e2e-journey.mjs), so the clip src is used AS-IS: prepending
 * "clips/" again here was the double-prefix bug (src="clips/clips/name.webm"
 * -> 404 -> MEDIA_ELEMENT_ERROR -> black squares in the gallery). Keeping the
 * "prefix once, at the point the string is consumed" rule for frames but "use
 * as recorded" for clips looks asymmetric, but it matches what each recorder
 * actually stores — the alternative (stripping the prefix back off in
 * e2e-journey.mjs just to re-add it here) is more moving parts for the same
 * result.
 */
function renderCapture(c) {
  if (c.kind === 'frame') {
    return `<figure><img class="capped-frame" loading="lazy" src="frames/${c.file}" onclick="this.classList.toggle('full')"/><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`;
  }
  return `<figure class="clip"><video autoplay loop muted playsinline controls src="${c.file}"></video><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`;
}

/**
 * Clips-first rendering (the demo product is looping per-capability clips, not
 * a full-session video): every beat's looping clips render before its stills.
 * Stills are then trimmed to a gallery-worthy SUBSET — only frames explicitly
 * flagged `key: true`, falling back to the beat's first 3 captured frames when
 * none are flagged. The full capture set (every clip + every frame) is always
 * retained in beat.captures / results.json regardless of what the gallery shows.
 */
function renderBeat(beat) {
  const clips = beat.captures.filter((c) => c.kind === 'clip');
  const frames = beat.captures.filter((c) => c.kind === 'frame');
  const keyFrames = frames.filter((c) => c.key);
  const shownFrames = keyFrames.length > 0 ? keyFrames : frames.slice(0, 3);
  const captures = [...clips, ...shownFrames].map(renderCapture).join('\n');
  return `<div class="beat"><h3>${beat.title}</h3><p class="narration">${beat.narration}</p>${captures}</div>`;
}

function renderJourney(j) {
  const passed = j.checksTotal - j.checksFailed;
  const badgeClass = j.checksFailed > 0 ? 'badge-fail' : 'badge-ok';
  const badge = `<span class="badge ${badgeClass}">${passed}/${j.checksTotal} checks green</span>`;
  const clipCount = Object.values(j.beats).reduce(
    (n, b) => n + b.captures.filter((c) => c.kind === 'clip').length, 0,
  );
  const beats = Object.values(j.beats).map(renderBeat).join('\n');
  return `<section><h2>${j.title}</h2><p class="story">${j.story}</p>` +
    `<p class="journey-meta">${clipCount} clip${clipCount === 1 ? '' : 's'} · ${badge}</p>` +
    `${beats}</section>`;
}

/**
 * Render the full walkthrough gallery as an HTML string: a tab bar with one
 * tab per journey (first active by default) plus a trailing "Finale" tab for
 * any epilogue captures (only when non-empty), each tab panel holding that
 * journey's checks badge + story + beats — unchanged content, just moved off
 * one long scroll into per-pillar panels. Inline vanilla JS/CSS (no external
 * deps): this is a local file:// artifact.
 *
 * @param {object} results               a toResults() output.
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 */
export function renderGallery(results, { title = 'Forge Studio — the operator walkthrough', subtitle = '' } = {}) {
  const journeyIds = results.executedJourneys.filter((jid) => results.journeys[jid]);
  const epilogueCaptures = results.epilogue?.captures ?? [];
  const hasEpilogue = epilogueCaptures.length > 0;

  const tabButtons = journeyIds.map((jid, i) => {
    const j = results.journeys[jid];
    const dot = j.pass ? '' : '<span class="tab-dot" title="failing checks"></span>';
    return `<button type="button" class="tab-btn${i === 0 ? ' active' : ''}" data-tab-target="tab-${jid}">${j.title}${dot}</button>`;
  });
  const tabPanels = journeyIds.map((jid, i) =>
    `<div class="tab-panel${i === 0 ? ' active' : ''}" id="tab-${jid}">${renderJourney(results.journeys[jid])}</div>`);

  if (hasEpilogue) {
    tabButtons.push('<button type="button" class="tab-btn" data-tab-target="tab-epilogue">Finale</button>');
    tabPanels.push(`<div class="tab-panel" id="tab-epilogue"><section><h2>Finale</h2>` +
      `${epilogueCaptures.map(renderCapture).join('\n')}</section></div>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}h2{margin-top:8px;border-bottom:1px solid #21262d;padding-bottom:6px}
video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
section{margin:0}.story{color:#8b949e;font-size:13px;margin:.2rem 0 1rem}
.journey-meta{color:#8b949e;font-size:12px;margin:0 0 1rem}
.beat{margin:24px 0}h3{margin-bottom:4px}.narration{color:#8b949e;font-size:13px;margin:.2rem 0 1rem}
figure{margin:24px 0;padding:0}
figure img.capped-frame{max-height:400px;width:auto;max-width:100%;object-fit:contain;display:block;margin:0 auto;border:1px solid #30363d;border-radius:8px;cursor:zoom-in}
figure img.capped-frame.full{max-height:none;width:100%;cursor:zoom-out}
figure.clip{max-width:720px;margin:24px auto}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:12px}
.badge-ok{background:#0d3320;color:#3fb950}.badge-fail{background:#3d0d12;color:#f85149}
.tab-bar{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0;border-bottom:1px solid #21262d;padding-bottom:14px}
.tab-btn{background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 14px;font:13px ui-sans-serif,system-ui;cursor:pointer}
.tab-btn.active{background:#1f6feb;color:#fff;border-color:#1f6feb}
.tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#f85149;margin-left:6px;vertical-align:middle}
.tab-panel{display:none}
.tab-panel.active{display:block}</style></head>
<body><h1>${title}</h1>
${subtitle ? `<p>${subtitle}</p>` : ''}
<div class="tab-bar">${tabButtons.join('\n')}</div>
<div class="tab-panels">${tabPanels.join('\n')}</div>
<script>
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var target = btn.getAttribute('data-tab-target');
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
  });
});
</script>
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
