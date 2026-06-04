/**
 * Pure renderer for the before/after comparison demo (ADR 021 / REV-4).
 *
 * Produces a single self-contained `DEMO.html` the operator opens with no
 * server: screenshots are inlined as base64 data URIs (resized to ≤800px
 * wide concept — the data URI is passed in already-sized); videos are
 * referenced as sibling files (too large to inline). Empty sections collapse.
 *
 * Sections emitted (REV-4 / D3 richness mandate):
 *   1. Header band — title, cycle id, branch, commit SHA, PR link
 *   2. Summary — bullet list of what changed + why
 *   3. Visual Changes — before/after image pairs side-by-side
 *   4. API / Behaviour Diff — syntax-highlighted JSON/text before→after
 *   5. Test Evidence — pass/fail table + coverage delta
 *   6. Files Changed — annotated list + diffstat
 *   7. Acceptance criteria (collapsible appendix)
 *
 * This module is intentionally pure (string in → string out). The fs reads
 * that turn screenshot files into data URIs live in `demo.ts`'s capture path,
 * so this renderer is trivially testable.
 */

/**
 * One measured metric, paired before vs after, for a `kind: 'harness'`
 * checkpoint.
 */
export type HarnessMetricRow = {
  label: string;
  unit?: string;
  before: string | null;
  after: string | null;
  /** (after-before)/|before|*100, numeric metrics only; null otherwise. */
  deltaPct: number | null;
  parity: 'match' | 'within' | 'diverged' | 'incomplete';
};

export type DemoCheckpoint = {
  label: string;
  kind: 'screenshot' | 'video' | 'harness';
  metrics?: HarnessMetricRow[] | null;
  caption: string;
  beforeImage: string | null;
  afterImage: string | null;
  beforeVideoSrc?: string | null;
  afterVideoSrc?: string | null;
  beforeNote?: string;
  afterNote?: string;
};

export type DemoBuildStatus = {
  ok: boolean;
  detail?: string;
};

// ── Rich structured sections (REV-4 / D3) ────────────────────────────────

export type DemoSummarySection = {
  bullets: string[];
  prUrl?: string;
  commitSha?: string;
  branch?: string;
};

export type DemoApiDiffEntry = {
  name: string;
  change: 'added' | 'changed' | 'removed';
  before?: string;
  after?: string;
};

export type TestResultRow = {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  delta?: string;
};

export type DemoComparisonModel = {
  title: string;
  initiativeId?: string;
  project: string;
  baseRef: string;
  changedRef: string;
  essence: string;
  generatedAt: string;
  baselineBuild: DemoBuildStatus;
  changedBuild: DemoBuildStatus;
  checkpoints: DemoCheckpoint[];
  beforeVideo?: string | null;
  afterVideo?: string | null;
  diffStat?: string;
  acceptanceCriteria?: string[];

  // ── Rich structured sections ────────────────────────────────────────────
  summary?: DemoSummarySection;
  apiDiff?: DemoApiDiffEntry[];
  testEvidence?: TestResultRow[];
  filesChanged?: Array<{ path: string; note?: string }>;
  /** A fenced code block showing what the operator can now run/use. */
  usage_example?: string;
  /** 2-4 bullets: what this change unlocks / the next capability. */
  impact?: string[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Section builders ──────────────────────────────────────────────────────

function buildBanner(model: DemoComparisonModel): string {
  const b = model.baselineBuild;
  const c = model.changedBuild;
  if (b.ok && c.ok) return '';
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

function buildSummarySection(model: DemoComparisonModel): string {
  const s = model.summary;
  // Always emit a summary section; if the rich summary is absent, emit the
  // essence as a single bullet so the section is never empty.
  const bullets: string[] = s?.bullets?.length ? s.bullets : [model.essence];
  const meta: string[] = [];
  if (s?.prUrl) meta.push(`<a href="${esc(s.prUrl)}" target="_blank" rel="noopener">Pull request</a>`);
  if (s?.branch) meta.push(`Branch: <code>${esc(s.branch)}</code>`);
  if (s?.commitSha) meta.push(`Commit: <code>${esc(s.commitSha)}</code>`);
  return `
<section class="section" id="summary">
  <h2>Summary</h2>
  <ul class="summary-bullets">
    ${bullets.map((b) => `<li>${esc(b)}</li>`).join('\n    ')}
  </ul>
  ${meta.length > 0 ? `<p class="meta-row">${meta.join(' · ')}</p>` : ''}
</section>`;
}

function mediaCell(cp: DemoCheckpoint, side: 'before' | 'after'): string {
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

function harnessVerdict(rows: HarnessMetricRow[]): { word: string; cls: string } {
  if (rows.length === 0) return { word: 'NO METRICS', cls: 'incomplete' };
  if (rows.some((r) => r.parity === 'incomplete')) return { word: 'INCOMPLETE', cls: 'incomplete' };
  if (rows.some((r) => r.parity === 'diverged')) return { word: 'DIVERGED', cls: 'diverged' };
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
          ? r.parity === 'match' ? '=' : '—'
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
  <div class="checkpoint">
    <h3><span class="step">${i + 1}</span> ${esc(cp.caption)} ${kindBadge}</h3>
    ${harnessTable(cp)}
    ${beforeNote}${afterNote}
  </div>`;
  }
  return `
  <div class="checkpoint">
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
  </div>`;
}

/** Determine the section heading based on the dominant checkpoint kind. */
function checkpointsSectionHeading(checkpoints: DemoCheckpoint[]): string {
  if (checkpoints.length === 0) return 'Visual Changes';
  const hasMedia = checkpoints.some((c) => c.kind === 'screenshot' || c.kind === 'video');
  if (hasMedia) return 'Visual Changes';
  const allHarness = checkpoints.every((c) => c.kind === 'harness');
  if (allHarness) {
    // If there are also cli-diff checkpoints this would fall through; for now
    // the vocabulary is screenshot | video | harness — all harness → Test Evidence.
    return 'Test Evidence';
  }
  // Mixed: harness + non-media (shouldn't occur with current vocabulary but fall back).
  return 'Visual Changes';
}

function buildVisualChangesSection(model: DemoComparisonModel): string {
  if (model.checkpoints.length === 0) return '';
  const items = model.checkpoints.map(buildCheckpoint).join('\n');

  const heading = checkpointsSectionHeading(model.checkpoints);
  const sectionId = heading === 'Test Evidence' ? 'test-evidence-checkpoints' : 'visual-changes';

  const videoRow =
    model.beforeVideo || model.afterVideo
      ? `<div class="checkpoint">
        <h3>Full run</h3>
        <div class="pair">
          <figure><figcaption>Before — baseline behaviour</figcaption>${
            model.beforeVideo
              ? `<video controls preload="metadata" src="${esc(model.beforeVideo)}"></video>`
              : '<div class="missing">no video</div>'
          }</figure>
          <figure><figcaption>After — this initiative</figcaption>${
            model.afterVideo
              ? `<video controls preload="metadata" src="${esc(model.afterVideo)}"></video>`
              : '<div class="missing">no video</div>'
          }</figure>
        </div>
      </div>`
      : '';

  return `
<section class="section" id="${sectionId}">
  <h2>${heading}</h2>
  ${items}
  ${videoRow}
</section>`;
}

/** Detect whether a string looks like JSON (starts with { or [) for syntax-highlight hint. */
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function buildApiDiffSection(model: DemoComparisonModel): string {
  if (!model.apiDiff || model.apiDiff.length === 0) return '';
  const changeBadge = (c: string): string => {
    const cls = c === 'added' ? 'badge-added' : c === 'removed' ? 'badge-removed' : 'badge-changed';
    return `<span class="badge ${cls}">${c}</span>`;
  };
  const codeBlock = (s: string): string => {
    const lang = looksLikeJson(s) ? 'json' : '';
    return `<pre class="code-block ${lang}">${esc(s)}</pre>`;
  };
  const entries = model.apiDiff
    .map(
      (e) => `
    <div class="api-entry">
      <div class="api-name">${esc(e.name)} ${changeBadge(e.change)}</div>
      ${
        e.before !== undefined || e.after !== undefined
          ? `<div class="pair api-pair">
          <div>
            <div class="api-side-label">Before</div>
            ${e.before !== undefined ? codeBlock(e.before) : '<div class="missing-code">—</div>'}
          </div>
          <div>
            <div class="api-side-label">After</div>
            ${e.after !== undefined ? codeBlock(e.after) : '<div class="missing-code">—</div>'}
          </div>
        </div>`
          : ''
      }
    </div>`,
    )
    .join('');
  return `
<section class="section" id="api-diff">
  <h2>API / Behaviour Diff</h2>
  ${entries}
</section>`;
}

function buildTestEvidenceSection(model: DemoComparisonModel): string {
  if (!model.testEvidence || model.testEvidence.length === 0) return '';
  const rows = model.testEvidence
    .map((r) => {
      const cls = r.result === 'pass' ? 'result-pass' : r.result === 'fail' ? 'result-fail' : 'result-skip';
      return `<tr>
        <td>${esc(r.name)}</td>
        <td class="${cls}">${r.result}</td>
        <td class="muted">${r.delta ? esc(r.delta) : '—'}</td>
      </tr>`;
    })
    .join('');
  return `
<section class="section" id="test-evidence">
  <h2>Test Evidence</h2>
  <table class="test-table">
    <thead><tr><th>test</th><th>result</th><th>delta</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/** Scratch files written by forge orchestrators — filtered before rendering. */
const SCRATCH_FILE_PATTERNS_HTML = [/\bAGENT\.md\b/, /\bPROMPT\.md\b/, /\bfix_plan\.md\b/];

function stripScratchDiffStat(diffStat: string): string {
  return diffStat
    .split('\n')
    .filter((line) => !SCRATCH_FILE_PATTERNS_HTML.some((re) => re.test(line)))
    .join('\n')
    .trim();
}

function buildFilesChangedSection(model: DemoComparisonModel): string {
  const hasAnnotated = model.filesChanged && model.filesChanged.length > 0;
  const rawDiff = model.diffStat ? stripScratchDiffStat(model.diffStat) : '';
  const hasDiff = rawDiff.length > 0;
  if (!hasAnnotated && !hasDiff) return '';

  const annotatedList = hasAnnotated
    ? `<ul class="files-list">
      ${model.filesChanged!.map((f) => `<li><code>${esc(f.path)}</code>${f.note ? ` <span class="muted">— ${esc(f.note)}</span>` : ''}</li>`).join('\n      ')}
    </ul>`
    : '';
  const diffBlock = hasDiff
    ? `<details class="diff-stat-toggle"><summary>git diff --stat <code>${esc(model.baseRef)}</code>..<code>${esc(model.changedRef)}</code></summary><pre class="diff-stat">${esc(rawDiff)}</pre></details>`
    : '';

  return `
<section class="section" id="files-changed">
  <h2>Files Changed</h2>
  ${annotatedList}
  ${diffBlock}
</section>`;
}

function buildUsageSection(model: DemoComparisonModel): string {
  if (!model.usage_example || model.usage_example.trim().length === 0) return '';
  return `
<section class="section" id="usage">
  <h2>Usage</h2>
  <pre class="usage-block">${esc(model.usage_example)}</pre>
</section>`;
}

function buildImpactSection(model: DemoComparisonModel): string {
  if (!model.impact || model.impact.length === 0) return '';
  return `
<section class="section" id="impact">
  <h2>Impact</h2>
  <ul class="impact-list">
    ${model.impact.map((b) => `<li>${esc(b)}</li>`).join('\n    ')}
  </ul>
</section>`;
}

function buildAcAppendix(model: DemoComparisonModel): string {
  if (!model.acceptanceCriteria || model.acceptanceCriteria.length === 0) return '';
  return `<details class="appendix"><summary>Acceptance criteria this demo is grounded in (${model.acceptanceCriteria.length})</summary><ol>${model.acceptanceCriteria
    .map((a) => `<li>${esc(a)}</li>`)
    .join('')}</ol></details>`;
}

/**
 * Render the self-contained, richly-sectioned comparison HTML. Pure: every
 * input comes from `model`; screenshots are expected to already be data URIs.
 * Empty sections are suppressed so a notes-only demo stays clean.
 */
export function renderComparisonHtml(model: DemoComparisonModel): string {
  const headerMeta: string[] = [];
  if (model.initiativeId) headerMeta.push(`<code>${esc(model.initiativeId)}</code>`);
  headerMeta.push(`project <strong>${esc(model.project)}</strong>`);
  headerMeta.push(`before <code>${esc(model.baseRef)}</code> → after <code>${esc(model.changedRef)}</code>`);
  if (model.summary?.branch) headerMeta.push(`branch <code>${esc(model.summary.branch)}</code>`);
  if (model.summary?.commitSha) headerMeta.push(`commit <code>${esc(model.summary.commitSha)}</code>`);
  if (model.summary?.prUrl) headerMeta.push(`<a href="${esc(model.summary.prUrl)}" target="_blank" rel="noopener">Pull request</a>`);
  headerMeta.push(`generated ${esc(model.generatedAt)}`);

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

  /* ── Header ── */
  header { padding: 2rem 0 1rem; border-bottom: 2px solid color-mix(in srgb, currentColor 18%, transparent); }
  h1 { font-size: 1.7rem; margin: 0 0 .5rem; }
  .header-meta { color: color-mix(in srgb, currentColor 60%, transparent); font-size: .85rem; display: flex; flex-wrap: wrap; gap: .3rem .9rem; }
  .header-meta code { font-size: .85rem; }
  .header-meta a { color: inherit; }
  .essence { font-size: 1.05rem; margin: 1.2rem 0 0; padding: 1rem 1.2rem; border-left: 3px solid color-mix(in srgb, currentColor 35%, transparent); background: color-mix(in srgb, currentColor 5%, transparent); border-radius: 0 6px 6px 0; }

  /* ── Section chrome ── */
  .section { margin: 2.8rem 0; }
  .section h2 { font-size: 1.1rem; text-transform: uppercase; letter-spacing: .06em; color: color-mix(in srgb, currentColor 55%, transparent); margin: 0 0 1.2rem; padding-bottom: .4rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }

  /* ── Banners ── */
  .banner { margin: 1rem 0; padding: .9rem 1.1rem; border-radius: 6px; background: color-mix(in srgb, #e0a800 22%, transparent); font-size: .9rem; }
  .banner hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); margin: .6rem 0; }

  /* ── Summary ── */
  .summary-bullets { margin: 0 0 .6rem 1.2rem; padding: 0; }
  .summary-bullets li { margin: .25rem 0; }
  .meta-row { font-size: .85rem; color: color-mix(in srgb, currentColor 60%, transparent); margin: .4rem 0 0; }
  .meta-row a { color: inherit; }

  /* ── Visual Changes ── */
  .checkpoint { margin: 2rem 0; padding: 1.4rem; background: color-mix(in srgb, currentColor 3%, transparent); border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  .checkpoint h3 { font-size: 1.0rem; margin: 0 0 .9rem; display: flex; align-items: center; gap: .6rem; }
  .step { display: inline-grid; place-items: center; width: 1.7rem; height: 1.7rem; border-radius: 50%; background: color-mix(in srgb, currentColor 14%, transparent); font-size: .85rem; font-weight: 600; flex-shrink: 0; }
  .kind { font-size: .65rem; text-transform: uppercase; letter-spacing: .08em; padding: .15rem .5rem; border-radius: 999px; background: color-mix(in srgb, #4a9eff 30%, transparent); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  figure { margin: 0; }
  figcaption { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, currentColor 55%, transparent); margin-bottom: .4rem; }
  img, video { width: 100%; max-width: 800px; height: auto; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 6px; display: block; background: #0001; }
  .missing { display: grid; place-items: center; min-height: 120px; border: 1px dashed color-mix(in srgb, currentColor 30%, transparent); border-radius: 6px; color: color-mix(in srgb, currentColor 50%, transparent); font-size: .85rem; }
  .note { font-size: .82rem; color: color-mix(in srgb, currentColor 60%, transparent); margin: .4rem 0 0; }

  /* ── Harness table ── */
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

  /* ── API Diff ── */
  .api-entry { margin: 1.2rem 0; }
  .api-name { font-weight: 600; font-size: .95rem; margin-bottom: .5rem; }
  .badge { font-size: .65rem; text-transform: uppercase; letter-spacing: .07em; padding: .15rem .5rem; border-radius: 999px; margin-left: .4rem; vertical-align: middle; }
  .badge-added { background: color-mix(in srgb, #3fae6a 28%, transparent); }
  .badge-removed { background: color-mix(in srgb, #e0584a 28%, transparent); }
  .badge-changed { background: color-mix(in srgb, #e0a800 28%, transparent); }
  .api-pair { align-items: start; }
  .api-side-label { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, currentColor 55%, transparent); margin-bottom: .3rem; }
  .code-block { overflow-x: auto; font-size: .82rem; padding: .7rem .9rem; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 6px; margin: 0; border: 1px solid color-mix(in srgb, currentColor 10%, transparent); white-space: pre; }
  .missing-code { font-size: .85rem; color: color-mix(in srgb, currentColor 40%, transparent); padding: .4rem 0; }

  /* ── Test Evidence ── */
  table.test-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  table.test-table th, table.test-table td { text-align: left; padding: .4rem .7rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  table.test-table th { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in srgb, currentColor 55%, transparent); }
  .result-pass { color: #3fae6a; font-weight: 600; }
  .result-fail { color: #e0584a; font-weight: 600; }
  .result-skip { color: color-mix(in srgb, currentColor 55%, transparent); }

  /* ── Files Changed ── */
  .files-list { margin: 0 0 1rem 1.2rem; padding: 0; font-size: .9rem; }
  .files-list code { font-size: .85rem; }
  .diff-stat-toggle { margin-top: .8rem; }
  .diff-stat-toggle summary { cursor: pointer; font-size: .85rem; color: color-mix(in srgb, currentColor 60%, transparent); }
  .diff-stat { overflow-x: auto; font-size: .8rem; padding: .8rem; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 6px; margin-top: .4rem; }

  /* ── Usage ── */
  .usage-block { overflow-x: auto; font-size: .88rem; padding: .9rem 1.1rem; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 6px; margin: 0; border: 1px solid color-mix(in srgb, currentColor 10%, transparent); white-space: pre; }

  /* ── Impact ── */
  .impact-list { margin: 0 0 .6rem 1.2rem; padding: 0; }
  .impact-list li { margin: .3rem 0; }

  /* ── Parity rows (additional) ── */
  tr.p-match { background: color-mix(in srgb, #3fae6a 7%, transparent); }

  /* ── Appendix ── */
  .appendix { margin: 1.4rem 0; }
  .appendix summary { cursor: pointer; font-size: .9rem; font-weight: 600; }
  .appendix ol { font-size: .9rem; }

  /* ── Shared utils ── */
  .muted { color: color-mix(in srgb, currentColor 55%, transparent); }
  footer { margin-top: 3rem; font-size: .8rem; color: color-mix(in srgb, currentColor 50%, transparent); border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 1rem; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } .api-pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>${esc(model.title)}</h1>
  <div class="header-meta">
    ${headerMeta.map((m) => `<span>${m}</span>`).join('\n    ')}
  </div>
  <p class="essence">${esc(model.essence)}</p>
</header>

${buildBanner(model)}

${buildSummarySection(model)}

${buildVisualChangesSection(model)}

${buildApiDiffSection(model)}

${buildTestEvidenceSection(model)}

${buildFilesChangedSection(model)}

${buildUsageSection(model)}

${buildImpactSection(model)}

${buildAcAppendix(model)}

<footer>Before = the project's prior behaviour (a valid working state). After = behaviour with this initiative applied. The demo focuses on the behavioural delta that is the essence of the change — it is not exhaustive and is not a failure hunt.</footer>
</body>
</html>
`;
}
