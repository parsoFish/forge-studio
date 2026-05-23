/**
 * Pure renderer for the before/after comparison demo (F-44).
 *
 * Produces a single self-contained `comparison.html`: screenshots are
 * inlined as base64 data URIs so the visual story is intact when the file
 * is moved/opened anywhere; videos are referenced as sibling files (too
 * large to inline sanely).
 *
 * Framing discipline (per the demonstrability spec): the *before* panel is
 * the project's PRIOR behaviour — a valid working state, NOT an error or a
 * regression. The *after* panel is the behaviour with this initiative
 * applied. The demo captures the behavioural delta that is the essence of
 * the initiative; it is not a failure hunt. The only place build/run
 * failure is surfaced is the explicit build-status banner.
 *
 * This module is intentionally pure (string in → string out). The fs reads
 * that turn screenshot files into data URIs live in `demo.ts`'s model
 * builder, so this renderer is trivially testable.
 */

/**
 * One measured metric, paired before vs after, for a `kind: 'harness'`
 * checkpoint. Values are the raw scraped strings (null = not captured on
 * that side). `deltaPct` is computed only for numeric metrics. `parity` is
 * the per-row verdict the renderer colours.
 */
export type HarnessMetricRow = {
  label: string;
  unit?: string;
  before: string | null;
  after: string | null;
  /** (after-before)/|before|*100, numeric metrics only; null otherwise. */
  deltaPct: number | null;
  /**
   * `match` — equal (numeric exact, or string identical).
   * `within` — numeric, differs but |Δ%| ≤ tolerance.
   * `diverged` — numeric over tolerance, or string mismatch.
   * `incomplete` — missing on one side.
   */
  parity: 'match' | 'within' | 'diverged' | 'incomplete';
};

export type DemoCheckpoint = {
  /** Stable identifier; pairs the before capture with the after one. */
  label: string;
  /**
   * `screenshot` — a static UI state (inlined as a base64 data URI; truly
   * self-contained). `video` — a dynamic/temporal behaviour clip
   * (referenced as a sibling file under `before/` / `after/`, too large to
   * inline). Choose video for anything time-dependent (a running
   * simulation, an animation): a single still of a moving system cannot
   * demonstrate parity. `harness` — behaviour only measurable at the
   * Node/test layer (a headless simulation): the orchestrator reruns the
   * project's own measurement test in each tree and this checkpoint renders
   * the scraped metrics as a before/after table + parity verdict, NOT
   * imagery. Default `screenshot`.
   */
  kind: 'screenshot' | 'video' | 'harness';
  /** For `kind: 'harness'` — paired metric rows; null/empty otherwise. */
  metrics?: HarnessMetricRow[] | null;
  /**
   * Agent-authored caption: what behaviour this checkpoint demonstrates
   * (e.g. "Selecting a node opens the inspector panel"). Describes the
   * behaviour, not "what's broken".
   */
  caption: string;
  /**
   * For `kind: 'screenshot'` — PNG bytes as `data:image/png;base64,...`,
   * or null if not captured. Unused for video checkpoints.
   */
  beforeImage: string | null;
  afterImage: string | null;
  /**
   * For `kind: 'video'` — relative sibling path (e.g. `before/<label>.webm`),
   * or null if not captured. Unused for screenshot checkpoints. Must be a
   * relative path, never a scheme-bearing URL (esc() neutralises HTML
   * delimiters but does not validate URL schemes).
   */
  beforeVideoSrc?: string | null;
  afterVideoSrc?: string | null;
  /**
   * Optional one-liner clarifying the baseline state at this checkpoint —
   * e.g. "This control did not exist yet" — phrased as prior behaviour,
   * never as an error.
   */
  beforeNote?: string;
  afterNote?: string;
};

export type DemoBuildStatus = {
  ok: boolean;
  /** Short human detail, e.g. "npm ci + vite build succeeded" or the failure tail. */
  detail?: string;
};

export type DemoComparisonModel = {
  /** Headline — the essence of the initiative, one line. */
  title: string;
  initiativeId?: string;
  project: string;
  baseRef: string;
  changedRef: string;
  /**
   * Narrative paragraph: what behaviour this initiative changes and why it
   * matters. Agent-authored from ACs + technical diff. This is the "essence".
   */
  essence: string;
  generatedAt: string;
  baselineBuild: DemoBuildStatus;
  changedBuild: DemoBuildStatus;
  checkpoints: DemoCheckpoint[];
  /**
   * Sibling-file names (relative to the html), or null when no video.
   * Callers MUST pass only relative paths or `file:`/`./` refs — never a
   * scheme-bearing URL from untrusted input. `esc()` neutralises HTML
   * delimiters but does not validate the URL scheme. (v1 orchestrator
   * always leaves these null.)
   */
  beforeVideo?: string | null;
  afterVideo?: string | null;
  /** `git diff --stat baseRef..changedRef` text, shown as a collapsible appendix. */
  diffStat?: string;
  /** Acceptance criteria the demo is grounded in, for traceability. */
  acceptanceCriteria?: string[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function buildBanner(model: DemoComparisonModel): string {
  const b = model.baselineBuild;
  const c = model.changedBuild;
  if (b.ok && c.ok) return '';
  // A build failure is the ONE place we surface failure framing — and even
  // then it's informational ("baseline did not build, so the before column
  // shows the build error"), not a value judgement on the change.
  const parts: string[] = [];
  if (!b.ok) {
    parts.push(
      `<strong>Baseline (<code>${esc(model.baseRef)}</code>) did not build.</strong> ` +
        `The "before" column shows the build/run failure rather than prior behaviour. ` +
        (b.detail ? `<br><span class="muted">${esc(b.detail)}</span>` : ''),
    );
  }
  if (!c.ok) {
    parts.push(
      `<strong>Changed (<code>${esc(model.changedRef)}</code>) did not build.</strong> ` +
        (c.detail ? `<br><span class="muted">${esc(c.detail)}</span>` : ''),
    );
  }
  return `<div class="banner">${parts.join('<hr>')}</div>`;
}

function mediaCell(cp: DemoCheckpoint, side: 'before' | 'after'): string {
  // src is esc()'d defensively: in-tree callers always pass base64 data
  // URIs / relative sibling paths (safe), but renderComparisonHtml is
  // exported and a hand-built DemoCheckpoint could carry an
  // attribute-breaking string.
  if (cp.kind === 'video') {
    const src = side === 'before' ? cp.beforeVideoSrc : cp.afterVideoSrc;
    return src
      ? `<video controls preload="metadata" playsinline src="${esc(src)}"></video>`
      : `<div class="missing">no capture</div>`;
  }
  const img = side === 'before' ? cp.beforeImage : cp.afterImage;
  return img
    ? `<img src="${esc(img)}" alt="${side}: ${esc(cp.label)}" loading="lazy">`
    : `<div class="missing">no capture</div>`;
}

/** Overall harness verdict from the per-row parities. */
function harnessVerdict(
  rows: HarnessMetricRow[],
): { word: string; cls: string } {
  if (rows.length === 0) return { word: 'NO METRICS', cls: 'incomplete' };
  if (rows.some((r) => r.parity === 'incomplete'))
    return { word: 'INCOMPLETE', cls: 'incomplete' };
  if (rows.some((r) => r.parity === 'diverged'))
    return { word: 'DIVERGED', cls: 'diverged' };
  return { word: 'PARITY', cls: 'within' };
}

function harnessTable(cp: DemoCheckpoint): string {
  const rows = cp.metrics ?? [];
  const v = harnessVerdict(rows);
  const body = rows
    .map((r) => {
      const unit = r.unit ? ` <span class="muted">${esc(r.unit)}</span>` : '';
      const d =
        r.deltaPct === null
          ? r.parity === 'match'
            ? '='
            : '—'
          : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%`;
      return `<tr class="p-${r.parity}"><td>${esc(r.label)}</td><td>${
        r.before === null ? '<span class="muted">—</span>' : esc(r.before)
      }${unit}</td><td>${
        r.after === null ? '<span class="muted">—</span>' : esc(r.after)
      }${unit}</td><td>${esc(d)}</td><td class="verdict-cell">${r.parity}</td></tr>`;
    })
    .join('');
  return `<table class="harness">
      <thead><tr><th>metric</th><th>before</th><th>after</th><th>Δ</th><th>parity</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="verdict v-${v.cls}">Verdict: <strong>${v.word}</strong></p>`;
}

function buildCheckpoint(cp: DemoCheckpoint, i: number): string {
  const beforeNote = cp.beforeNote ? `<p class="note">${esc(cp.beforeNote)}</p>` : '';
  const afterNote = cp.afterNote ? `<p class="note">${esc(cp.afterNote)}</p>` : '';
  const kindBadge =
    cp.kind === 'video'
      ? '<span class="kind">video</span>'
      : cp.kind === 'harness'
        ? '<span class="kind">harness</span>'
        : '';
  if (cp.kind === 'harness') {
    return `
  <section class="checkpoint">
    <h3><span class="step">${i + 1}</span> ${esc(cp.caption)} ${kindBadge}</h3>
    ${harnessTable(cp)}
    ${beforeNote}${afterNote}
  </section>`;
  }
  return `
  <section class="checkpoint">
    <h3><span class="step">${i + 1}</span> ${esc(cp.caption)} ${kindBadge}</h3>
    <div class="pair">
      <figure>
        <figcaption>Before — baseline behaviour</figcaption>
        ${mediaCell(cp, 'before')}
        ${beforeNote}
      </figure>
      <figure>
        <figcaption>After — this initiative</figcaption>
        ${mediaCell(cp, 'after')}
        ${afterNote}
      </figure>
    </div>
  </section>`;
}

/**
 * Render the self-contained comparison HTML. Pure: every input comes from
 * `model`; screenshots are expected to already be data URIs.
 */
export function renderComparisonHtml(model: DemoComparisonModel): string {
  const acList =
    model.acceptanceCriteria && model.acceptanceCriteria.length > 0
      ? `<details class="appendix"><summary>Acceptance criteria this demo is grounded in (${model.acceptanceCriteria.length})</summary><ol>${model.acceptanceCriteria
          .map((a) => `<li>${esc(a)}</li>`)
          .join('')}</ol></details>`
      : '';
  const diffAppendix = model.diffStat
    ? `<details class="appendix"><summary>Changed files (<code>git diff --stat ${esc(model.baseRef)}..${esc(model.changedRef)}</code>)</summary><pre>${esc(model.diffStat)}</pre></details>`
    : '';
  const videoRow =
    model.beforeVideo || model.afterVideo
      ? `<section class="checkpoint"><h3>Full run</h3><div class="pair">
        <figure><figcaption>Before — baseline behaviour</figcaption>${
          model.beforeVideo
            ? `<video controls preload="metadata" src="${esc(model.beforeVideo)}"></video>`
            : '<div class="missing">no video</div>'
        }</figure>
        <figure><figcaption>After — this initiative</figcaption>${
          model.afterVideo
            ? `<video controls preload="metadata" src="${esc(model.afterVideo)}"></video>`
            : '<div class="missing">no video</div>'
        }</figure></div></section>`
      : '';

  const checkpoints = model.checkpoints.map(buildCheckpoint).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)} — before / after</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0 1.5rem 4rem; max-width: 1400px; margin-inline: auto; }
  header { padding: 2rem 0 1rem; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
  h1 { font-size: 1.6rem; margin: 0 0 .4rem; }
  .meta { color: color-mix(in srgb, currentColor 60%, transparent); font-size: .85rem; }
  .meta code { font-size: .85rem; }
  .essence { font-size: 1.05rem; margin: 1.2rem 0; padding: 1rem 1.2rem; border-left: 3px solid color-mix(in srgb, currentColor 35%, transparent); background: color-mix(in srgb, currentColor 5%, transparent); border-radius: 0 6px 6px 0; }
  .banner { margin: 1rem 0; padding: .9rem 1.1rem; border-radius: 6px; background: color-mix(in srgb, #e0a800 22%, transparent); font-size: .9rem; }
  .banner hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); margin: .6rem 0; }
  .checkpoint { margin: 2.4rem 0; }
  .checkpoint h3 { font-size: 1.05rem; margin: 0 0 .8rem; display: flex; align-items: center; gap: .6rem; }
  .step { display: inline-grid; place-items: center; width: 1.7rem; height: 1.7rem; border-radius: 50%; background: color-mix(in srgb, currentColor 14%, transparent); font-size: .85rem; font-weight: 600; }
  .kind { font-size: .65rem; text-transform: uppercase; letter-spacing: .08em; padding: .15rem .5rem; border-radius: 999px; background: color-mix(in srgb, #4a9eff 30%, transparent); vertical-align: middle; }
  .muted { color: color-mix(in srgb, currentColor 55%, transparent); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  figure { margin: 0; }
  figcaption { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, currentColor 55%, transparent); margin-bottom: .4rem; }
  img, video { width: 100%; height: auto; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 6px; display: block; background: #0001; }
  .missing { display: grid; place-items: center; min-height: 160px; border: 1px dashed color-mix(in srgb, currentColor 30%, transparent); border-radius: 6px; color: color-mix(in srgb, currentColor 50%, transparent); font-size: .85rem; }
  table.harness { width: 100%; border-collapse: collapse; font-size: .9rem; margin: .2rem 0 .6rem; }
  table.harness th, table.harness td { text-align: left; padding: .45rem .7rem; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
  table.harness th { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in srgb, currentColor 55%, transparent); }
  table.harness td:nth-child(n+2) { font-variant-numeric: tabular-nums; }
  table.harness .verdict-cell { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; }
  tr.p-diverged { background: color-mix(in srgb, #e0584a 16%, transparent); }
  tr.p-within { background: color-mix(in srgb, #3fae6a 12%, transparent); }
  tr.p-incomplete { background: color-mix(in srgb, #e0a800 16%, transparent); }
  .verdict { font-size: .95rem; margin: .2rem 0 0; padding: .5rem .8rem; border-radius: 6px; display: inline-block; }
  .verdict.v-within { background: color-mix(in srgb, #3fae6a 20%, transparent); }
  .verdict.v-diverged { background: color-mix(in srgb, #e0584a 22%, transparent); }
  .verdict.v-incomplete { background: color-mix(in srgb, #e0a800 22%, transparent); }
  .note { font-size: .82rem; color: color-mix(in srgb, currentColor 60%, transparent); margin: .4rem 0 0; }
  .appendix { margin: 1.4rem 0; }
  .appendix summary { cursor: pointer; font-size: .9rem; font-weight: 600; }
  .appendix pre { overflow-x: auto; font-size: .8rem; padding: .8rem; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 6px; }
  .appendix ol { font-size: .9rem; }
  footer { margin-top: 3rem; font-size: .8rem; color: color-mix(in srgb, currentColor 50%, transparent); }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>${esc(model.title)}</h1>
  <div class="meta">
    ${model.initiativeId ? `<code>${esc(model.initiativeId)}</code> · ` : ''}project <strong>${esc(model.project)}</strong>
    · before <code>${esc(model.baseRef)}</code> → after <code>${esc(model.changedRef)}</code>
    · generated ${esc(model.generatedAt)}
  </div>
</header>

<p class="essence">${esc(model.essence)}</p>

${buildBanner(model)}

${checkpoints}

${videoRow}

${acList}
${diffAppendix}

<footer>Before = the project's prior behaviour (a valid working state). After = behaviour with this initiative applied. The demo focuses on the behavioural delta that is the essence of the change — it is not exhaustive and is not a failure hunt.</footer>
</body>
</html>
`;
}
