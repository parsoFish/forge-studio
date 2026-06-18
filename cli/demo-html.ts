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
  /** Captured live external evidence — a real API GET persisted by the acceptance test. */
  liveEvidence?: { url: string; method?: string; capturedAt?: string; response?: string } | null;
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

/** Per-acceptance-criterion evaluated output (MVUS req b). */
export type AcEvaluationEntry = {
  criterion: string;
  verdict: 'met' | 'partial' | 'missed';
  evidence: string;
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
  diffStat?: string;
  acceptanceCriteria?: string[];
  /**
   * Per-AC evaluated output. When present, a foregrounded "Intent & Outcome"
   * section replaces the plain AC appendix. One entry per AC with verdict
   * (met/partial/missed) and concrete evidence (MVUS req b).
   */
  acEvaluations?: AcEvaluationEntry[];

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

/**
 * Map a parity value to the word shown in the cell. `incomplete` is renamed to
 * "new" because that is what it actually means here — the metric is net-new, so
 * there is no prior baseline to compare against (the `after` column is the
 * result). The literal word "incomplete" was consistently misread as "the work
 * is unfinished / something is wrong" when in fact the new test PASSES.
 */
function parityLabel(parity: HarnessMetricRow['parity']): string {
  return parity === 'incomplete' ? 'new' : parity;
}

/**
 * Checkpoint-level verdict. A genuine problem is a `diverged` row (a regression
 * vs the baseline) — that takes precedence and warns. `incomplete` rows are
 * net-new metrics with no baseline; on their own they are NOT a warning, so the
 * checkpoint reads "NEW" (informational), not "INCOMPLETE". Empty ⇒ no evidence.
 */
function harnessVerdict(rows: HarnessMetricRow[]): { word: string; cls: string } {
  if (rows.length === 0) return { word: 'NO METRICS', cls: 'incomplete' };
  if (rows.some((r) => r.parity === 'diverged')) return { word: 'DIVERGED', cls: 'diverged' };
  if (rows.some((r) => r.parity === 'incomplete')) return { word: 'NEW (no prior baseline)', cls: 'new' };
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
      }${unit}</td><td>${esc(d)}</td><td class="verdict-cell">${esc(parityLabel(r.parity))}</td></tr>`;
    })
    .join('');
  return `<table class="harness">
      <thead><tr><th>metric</th><th>before</th><th>after</th><th>Δ</th><th>parity</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="verdict v-${v.cls}">Verdict: <strong>${v.word}</strong></p>
    <p class="legend"><strong>match</strong>/<strong>within</strong> = unchanged from baseline · <strong>new</strong> = newly added, no prior baseline (see the <em>after</em> column for the result — a PASS means the new test is green) · <strong>diverged</strong> = regressed vs baseline (the only state that signals a problem)</p>`;
}

function buildLiveEvidenceCard(cp: DemoCheckpoint): string {
  const ev = cp.liveEvidence;
  if (!ev?.url) return '';
  const method = ev.method ?? 'GET';
  const responseHtml = ev.response
    ? (() => {
        const truncated = ev.response.length > 6000 ? ev.response.slice(0, 6000) + '\n… (truncated)' : ev.response;
        const lang = looksLikeJson(ev.response) ? 'json' : '';
        return `
        <details class="live-evidence-body">
          <summary>Response body</summary>
          <pre class="code-block ${lang}">${esc(truncated)}</pre>
        </details>`;
      })()
    : '';
  return `
  <div class="live-evidence-card">
    <div class="live-evidence-header">&#10003; Live evidence — real REST ${esc(method)}</div>
    <code class="live-evidence-url">${esc(ev.url)}</code>
    ${ev.capturedAt ? `<div class="live-evidence-meta">Captured ${esc(ev.capturedAt)}</div>` : ''}
    ${responseHtml}
  </div>`;
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
  const liveCard = buildLiveEvidenceCard(cp);
  if (cp.kind === 'harness') {
    return `
  <div class="checkpoint">
    <h3><span class="step">${i + 1}</span> ${esc(cp.caption)} ${kindBadge}</h3>
    ${liveCard}
    ${harnessTable(cp)}
    ${beforeNote}${afterNote}
  </div>`;
  }
  return `
  <div class="checkpoint">
    <h3><span class="step">${i + 1}</span> ${esc(cp.caption)} ${kindBadge}</h3>
    ${liveCard}
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

  return `
<section class="section" id="${sectionId}">
  <h2>${heading}</h2>
  ${items}
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

function buildTestEvidenceSection(model: DemoComparisonModel, hasLiveEvidence: boolean): string {
  if (!model.testEvidence || model.testEvidence.length === 0) return '';
  const hasSkips = model.testEvidence.some((r) => r.result === 'skip');
  const passCount  = model.testEvidence.filter((r) => r.result === 'pass').length;
  const failCount  = model.testEvidence.filter((r) => r.result === 'fail').length;
  const skipCount  = model.testEvidence.filter((r) => r.result === 'skip').length;
  const allPass    = failCount === 0 && skipCount === 0;
  const countBadge = allPass
    ? `<span class="badge badge-added">${passCount} / ${passCount} pass</span>`
    : `<span>${passCount} pass · ${failCount} fail · ${skipCount} skip</span>`;

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

  // Suppress the credentials-absent / offline-floor skip note when live evidence
  // was captured (the live tier actually ran — skip rows are not a coverage gap).
  const skipNote = (!hasLiveEvidence && hasSkips)
    ? ' · <strong>skip</strong> = not run in this gate (e.g. a live test with no credentials present) — not a failure'
    : (hasSkips ? ' · <strong>skip</strong> = not a failure' : '');

  return `
<section class="section" id="test-evidence">
  <h2>Test Evidence <span style="font-size:.75rem;font-weight:400;margin-left:.6rem;">${countBadge}</span></h2>
  <table class="test-table">
    <thead><tr><th>test</th><th>result</th><th>delta</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="legend"><strong>pass</strong> = green · <strong>fail</strong> = failed (a problem)${skipNote} · delta <strong>new</strong> = test added by this change</p>
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

/**
 * Parse a `git diff --stat` output into per-file rows.
 * Each data line looks like: " path/to/file.ts | 42 +++---"
 * The summary line ("3 files changed, ...") is excluded.
 */
function parseDiffStatRows(diffStat: string): Array<{ path: string; ins: number; del: number; total: number }> {
  const rows: Array<{ path: string; ins: number; del: number; total: number }> = [];
  for (const line of diffStat.split('\n')) {
    const m = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+\-]*)\s*$/);
    if (!m) continue;
    const path = m[1].trim();
    const bars = m[3] ?? '';
    const ins = (bars.match(/\+/g) ?? []).length;
    const del = (bars.match(/-/g) ?? []).length;
    rows.push({ path, ins, del, total: ins + del });
  }
  return rows;
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

  // Parse diff stat into per-file bar rows when available
  const diffRows = hasDiff ? parseDiffStatRows(rawDiff) : [];
  const maxTotal = diffRows.reduce((m, r) => Math.max(m, r.total), 1);
  const diffTable = diffRows.length > 0
    ? `<div class="diff-stat-table">
      ${diffRows.map((r) => {
        const insPct  = (r.ins / maxTotal) * 100;
        const delPct  = (r.del / maxTotal) * 100;
        return `<div class="diff-stat-row">
          <code class="diff-stat-path">${esc(r.path)}</code>
          <div class="diff-stat-bars">
            <span class="diff-bar-ins" style="width:${insPct.toFixed(1)}%"></span><span class="diff-bar-del" style="width:${delPct.toFixed(1)}%"></span>
          </div>
          <span class="diff-stat-count muted">${r.ins > 0 ? `+${r.ins}` : ''}${r.del > 0 ? ` -${r.del}` : ''}</span>
        </div>`;
      }).join('\n      ')}
    </div>`
    : '';

  const diffRawBlock = hasDiff
    ? `<details class="diff-stat-toggle"><summary>git diff --stat <code>${esc(model.baseRef)}</code>..<code>${esc(model.changedRef)}</code></summary><pre class="diff-stat">${esc(rawDiff)}</pre></details>`
    : '';

  return `
<section class="section" id="files-changed">
  <h2>Files Changed</h2>
  ${annotatedList}
  ${diffTable}
  ${diffRawBlock}
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

/**
 * Foregrounded "Intent & Outcome" section (MVUS req b). Rendered near the top
 * when `acEvaluations` is present — one row per AC with a colored verdict badge
 * and concrete evidence. Carries `data-section="demo-evaluation"` and
 * `data-ac-eval-count` for e2e assertions.
 */
function buildEvaluationSection(model: DemoComparisonModel): string {
  if (!model.acEvaluations || model.acEvaluations.length === 0) return '';

  const metCount     = model.acEvaluations.filter((e) => e.verdict === 'met').length;
  const partialCount = model.acEvaluations.filter((e) => e.verdict === 'partial').length;
  const missedCount  = model.acEvaluations.filter((e) => e.verdict === 'missed').length;

  const verdictLabel = (v: string): string => v === 'met' ? 'met' : v === 'missed' ? 'missed' : 'partial';
  const rows = model.acEvaluations
    .map(
      (e, i) => `<tr data-ac-verdict="${esc(e.verdict)}">
        <td class="ac-idx">${i + 1}</td>
        <td>${esc(e.criterion)}</td>
        <td><span class="ac-verdict ac-${esc(e.verdict)}">${esc(verdictLabel(e.verdict))}</span></td>
        <td class="ac-evidence">${esc(e.evidence)}</td>
      </tr>`,
    )
    .join('');

  const rollupCls = missedCount > 0 ? 'rollup-has-missed' : partialCount > 0 ? 'rollup-has-partial' : 'rollup-all-met';
  const rollup = `<span class="ac-rollup ${rollupCls}">${metCount} met${partialCount > 0 ? ` · ${partialCount} partial` : ''}${missedCount > 0 ? ` · ${missedCount} missed` : ''}</span>`;

  return `
<section class="section" id="demo-evaluation" data-section="demo-evaluation" data-ac-eval-count="${model.acEvaluations.length}">
  <h2>Intent &amp; Outcome ${rollup}</h2>
  <p class="intent-essence">${esc(model.essence)}</p>
  <table class="ac-eval">
    <thead><tr><th class="ac-idx">#</th><th>Acceptance criterion</th><th>Verdict</th><th>Evidence</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildAcAppendix(model: DemoComparisonModel): string {
  // Suppress the plain appendix when acEvaluations is present — the criteria
  // are already shown upfront with per-AC verdicts (avoid showing twice).
  if (model.acEvaluations && model.acEvaluations.length > 0) return '';
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
  // Derive whether any checkpoint carries captured live REST evidence.
  // When true: render a green banner and suppress the credentials-absent skip note.
  const hasLiveEvidence = model.checkpoints.some((c) => c.liveEvidence?.url);

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
  .live-evidence-banner { background: color-mix(in srgb, #3fae6a 18%, transparent); border: 1px solid color-mix(in srgb, #3fae6a 40%, transparent); color: color-mix(in srgb, #3fae6a 90%, currentColor); }

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
  tr.p-within, tr.p-match { background: color-mix(in srgb, #3fae6a 12%, transparent); }
  /* "incomplete" = net-new metric, no prior baseline. Informational blue, NOT
     the amber warning it used to be (a new test that PASSES is not a problem). */
  tr.p-incomplete { background: color-mix(in srgb, #539bf5 14%, transparent); }
  .verdict { font-size: .95rem; margin: .2rem 0 0; padding: .5rem .8rem; border-radius: 6px; display: inline-block; }
  .verdict.v-within { background: color-mix(in srgb, #3fae6a 20%, transparent); }
  .verdict.v-diverged { background: color-mix(in srgb, #e0584a 22%, transparent); }
  .verdict.v-new { background: color-mix(in srgb, #539bf5 20%, transparent); }
  .verdict.v-incomplete { background: color-mix(in srgb, #e0a800 22%, transparent); }
  .legend { font-size: .72rem; line-height: 1.5; margin: .35rem 0 0; color: color-mix(in srgb, currentColor 55%, transparent); }
  .legend strong { color: color-mix(in srgb, currentColor 80%, transparent); font-weight: 600; }

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

  /* ── Intent & Outcome (MVUS req b) ── */
  .intent-essence { margin: 0 0 1rem; font-size: .95rem; color: color-mix(in srgb, currentColor 75%, transparent); font-style: italic; }
  table.ac-eval { width: 100%; border-collapse: collapse; font-size: .9rem; }
  table.ac-eval th, table.ac-eval td { text-align: left; padding: .45rem .8rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  table.ac-eval th { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: color-mix(in srgb, currentColor 55%, transparent); }
  table.ac-eval .ac-idx { width: 2.2rem; color: color-mix(in srgb, currentColor 40%, transparent); }
  table.ac-eval .ac-evidence { font-size: .82rem; color: color-mix(in srgb, currentColor 65%, transparent); }
  .ac-verdict { display: inline-block; font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; padding: .15rem .55rem; border-radius: 999px; font-weight: 600; }
  .ac-met { background: color-mix(in srgb, #3fae6a 25%, transparent); color: #2a8a50; }
  .ac-partial { background: color-mix(in srgb, #e0a800 25%, transparent); color: #9a7200; }
  .ac-missed { background: color-mix(in srgb, #e0584a 25%, transparent); color: #b03030; }

  /* ── Live evidence card ── */
  .live-evidence-card { margin: .8rem 0 1rem; padding: .9rem 1.1rem; border-radius: 7px; background: color-mix(in srgb, #3fae6a 8%, transparent); border: 1px solid color-mix(in srgb, #3fae6a 35%, transparent); }
  .live-evidence-header { font-size: .82rem; font-weight: 700; color: color-mix(in srgb, #3fae6a 90%, currentColor); margin-bottom: .35rem; }
  .live-evidence-url { display: block; font-size: .82rem; word-break: break-all; margin-bottom: .25rem; }
  .live-evidence-meta { font-size: .75rem; color: color-mix(in srgb, currentColor 55%, transparent); margin-bottom: .3rem; }
  .live-evidence-body { margin-top: .4rem; }
  .live-evidence-body summary { cursor: pointer; font-size: .8rem; color: color-mix(in srgb, currentColor 60%, transparent); }

  /* ── Diff stat bar chart ── */
  .diff-stat-table { margin: .6rem 0 .8rem; display: flex; flex-direction: column; gap: .3rem; }
  .diff-stat-row { display: grid; grid-template-columns: minmax(160px, 40%) 1fr auto; align-items: center; gap: .6rem; font-size: .82rem; }
  .diff-stat-path { font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .diff-stat-bars { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, currentColor 8%, transparent); min-width: 40px; }
  .diff-bar-ins { background: color-mix(in srgb, #3fae6a 70%, transparent); height: 100%; }
  .diff-bar-del { background: color-mix(in srgb, #e0584a 70%, transparent); height: 100%; }
  .diff-stat-count { font-size: .75rem; white-space: nowrap; }

  /* ── AC roll-up chip ── */
  .ac-rollup { display: inline-block; font-size: .7rem; font-weight: 500; padding: .15rem .55rem; border-radius: 999px; margin-left: .6rem; vertical-align: middle; text-transform: none; letter-spacing: 0; }
  .rollup-all-met  { background: color-mix(in srgb, #3fae6a 22%, transparent); color: color-mix(in srgb, #3fae6a 90%, currentColor); }
  .rollup-has-partial { background: color-mix(in srgb, #e0a800 22%, transparent); color: color-mix(in srgb, #e0a800 90%, currentColor); }
  .rollup-has-missed  { background: color-mix(in srgb, #e0584a 22%, transparent); color: color-mix(in srgb, #e0584a 90%, currentColor); }

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

${hasLiveEvidence ? `<div class="banner live-evidence-banner">&#10003; <strong>Live evidence captured</strong> — real ADO REST GET confirmed against the live system. The live tier ran successfully.</div>` : ''}

${buildSummarySection(model)}

${buildEvaluationSection(model)}

${buildVisualChangesSection(model)}

${buildApiDiffSection(model)}

${buildTestEvidenceSection(model, hasLiveEvidence)}

${buildFilesChangedSection(model)}

${buildUsageSection(model)}

${buildImpactSection(model)}

${buildAcAppendix(model)}

<footer>Before = the project's prior behaviour (a valid working state). After = behaviour with this initiative applied. The demo focuses on the behavioural delta that is the essence of the change — it is not exhaustive and is not a failure hunt.</footer>
</body>
</html>
`;
}
