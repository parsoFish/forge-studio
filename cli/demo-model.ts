/**
 * Unified structured demo model (ADR 021).
 *
 * The unifier authors ONE structured `demo.json` to this schema — the schema is
 * the contract that fixes the previous free-form `DEMO.md` inconsistency. The
 * review screen renders `demo.json` natively, and forge derives a single
 * PR-facing `DEMO.md` from it (F4 retired the parallel `DEMO.html` — the demo
 * OUTPUT is one markdown + the demo.json sidecar). Shared section types live in
 * [cli/demo-types.ts](./demo-types.ts).
 *
 * Required core: `title`, `essence`, `project`, `diffStat`, and ≥1 checkpoint
 * (each with `label` + `caption`). Rich structured sections (`summary`,
 * `apiDiff`, `testEvidence`, `filesChanged`) are optional but produce a much
 * richer rendered HTML when present. Media (before/after images/video) +
 * harness `metrics` are OPTIONAL — the explicitly-triggered demo-capture skill
 * fills media when relevant. `validateDemoModel` mirrors `validateManifest`'s
 * fail-fast-with-messages contract.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  HarnessMetricRow,
  DemoSummarySection,
  DemoApiDiffEntry,
  TestResultRow,
} from './demo-types.ts';
import { MAX_INLINE_IMAGE_BYTES } from './demo-types.ts';

// Re-export the rich section types so callers only need one import surface.
export type { DemoSummarySection, DemoApiDiffEntry, TestResultRow } from './demo-types.ts';

export type DemoModelCheckpoint = {
  label: string;
  kind?: 'screenshot' | 'video' | 'harness';
  caption: string;
  beforeNote?: string;
  afterNote?: string;
  /** Harness metric rows (paired before/after). Optional. */
  metrics?: HarnessMetricRow[];
  /** Optional captured media — `data:image/...` ONLY (validator rejects schemes). */
  beforeImage?: string | null;
  afterImage?: string | null;
  /** Optional video — relative sibling path only (never a scheme-bearing URL). */
  beforeVideoSrc?: string | null;
  afterVideoSrc?: string | null;
  /**
   * Captured live external evidence — a REAL API GET of the resource under test
   * (the endpoint url + the response body), persisted by the acceptance test
   * before it destroys the resource and back-filled here by forge. The presence
   * of `url` is what the live-evidence gate checks: the demo must SHOW the actual
   * resource, not merely name the tests that touched it.
   */
  liveEvidence?: { url: string; capturedAt?: string; response?: string } | null;
};

/** Per-acceptance-criterion evaluated output — one entry per AC the unifier proved. */
export type AcEvaluation = {
  criterion: string;
  verdict: 'met' | 'partial' | 'missed';
  evidence: string;
};

export type DemoModel = {
  title: string;
  essence: string;
  project: string;
  initiativeId?: string;
  baseRef?: string;
  changedRef?: string;
  checkpoints: DemoModelCheckpoint[];
  /** `git diff --stat baseRef..changedRef`. Required — grounds the demo. */
  diffStat: string;
  acceptanceCriteria?: string[];
  /**
   * Per-AC evaluated output. When present, the review screen foregrounds this
   * instead of the plain `acceptanceCriteria` list (MVUS req b). One entry per
   * AC, with a `verdict` (met/partial/missed) and concrete `evidence`.
   */
  acEvaluations?: AcEvaluation[];

  // ── Rich structured sections (REV-4 / D3) ──────────────────────────────
  /** High-level summary bullets + PR/branch/SHA metadata. */
  summary?: DemoSummarySection;
  /**
   * API or behaviour diff entries. Each shows a before/after pair for a
   * changed endpoint, function signature, config key, or CLI flag.
   * Syntax-highlighted in the rendered HTML (JSON detected automatically).
   */
  apiDiff?: DemoApiDiffEntry[];
  /**
   * Test evidence table. Each row is one test suite or key test case.
   * Present iff the diff touches tests or coverage.
   */
  testEvidence?: TestResultRow[];
  /**
   * Summarised files-changed list beyond diffStat. Optional: if absent,
   * the renderer derives this from diffStat. When present, these entries
   * are shown with a richer annotation (e.g. "core logic", "new file").
   */
  filesChanged?: Array<{ path: string; note?: string }>;
  /**
   * A fenced code block showing what the operator can now run/create to USE
   * the new capability (HCL, CLI command, API call, etc.). Optional.
   */
  usage_example?: string;
  /**
   * 2-4 bullets describing what this change unlocks / the next capability.
   * Optional.
   */
  impact?: string[];
};

const VALID_KINDS = new Set(['screenshot', 'video', 'harness']);

/**
 * Validate an authored `demo.json`. Returns an array of human-readable errors;
 * empty ⇒ valid. Never throws. Required core only; media/metrics optional.
 */
export function validateDemoModel(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return ['demo.json must be a JSON object'];
  const m = raw as Record<string, unknown>;

  const reqStr = (field: string): void => {
    const v = m[field];
    if (typeof v !== 'string' || v.trim().length === 0) {
      errors.push(`${field} is required (non-empty string)`);
    }
  };
  reqStr('title');
  reqStr('essence');
  reqStr('project');
  reqStr('diffStat');

  const cps = m.checkpoints;
  if (!Array.isArray(cps) || cps.length === 0) {
    errors.push('checkpoints must be a non-empty array (≥1 before/after checkpoint)');
  } else {
    cps.forEach((c, i) => {
      const cp = c as Record<string, unknown>;
      const at = `checkpoints[${i}]`;
      if (typeof cp.label !== 'string' || cp.label.trim() === '') errors.push(`${at}.label is required`);
      if (typeof cp.caption !== 'string' || cp.caption.trim() === '') errors.push(`${at}.caption is required`);
      if (cp.kind !== undefined && !VALID_KINDS.has(cp.kind as string)) {
        errors.push(`${at}.kind must be one of screenshot|video|harness`);
      }
      for (const f of ['beforeImage', 'afterImage'] as const) {
        const v = cp[f];
        if (v != null && (typeof v !== 'string' || !v.startsWith('data:image/'))) {
          errors.push(`${at}.${f} must be a data:image/... URI when set`);
        }
      }
      for (const f of ['beforeVideoSrc', 'afterVideoSrc'] as const) {
        const v = cp[f];
        if (v != null && (typeof v !== 'string' || /^[a-z]+:/i.test(v) || v.startsWith('/'))) {
          errors.push(`${at}.${f} must be a relative sibling path when set`);
        }
      }
      if (cp.metrics !== undefined) {
        if (!Array.isArray(cp.metrics)) {
          errors.push(`${at}.metrics must be an array when set`);
        } else {
          (cp.metrics as Array<Record<string, unknown>>).forEach((row, j) => {
            const validParities = new Set(['match', 'within', 'diverged', 'incomplete']);
            if (row.parity !== undefined && !validParities.has(row.parity as string)) {
              errors.push(`${at}.metrics[${j}].parity must be one of match|within|diverged|incomplete (got "${row.parity}")`);
            }
          });
        }
      }
    });
  }

  if (m.acceptanceCriteria !== undefined && !Array.isArray(m.acceptanceCriteria)) {
    errors.push('acceptanceCriteria must be an array of strings when set');
  }

  const VALID_VERDICTS = new Set(['met', 'partial', 'missed']);
  if (m.acEvaluations !== undefined) {
    if (!Array.isArray(m.acEvaluations)) {
      errors.push('acEvaluations must be an array when set');
    } else {
      (m.acEvaluations as Array<Record<string, unknown>>).forEach((entry, i) => {
        const at = `acEvaluations[${i}]`;
        if (typeof entry.criterion !== 'string' || entry.criterion.trim().length === 0) {
          errors.push(`${at}.criterion is required (non-empty string)`);
        }
        if (!VALID_VERDICTS.has(entry.verdict as string)) {
          errors.push(`${at}.verdict must be one of met|partial|missed (got "${entry.verdict}")`);
        }
        if (typeof entry.evidence !== 'string' || entry.evidence.trim().length === 0) {
          errors.push(`${at}.evidence is required (non-empty string)`);
        }
      });
    }
  }

  // Validate optional rich sections (loose — don't break on partial data).
  if (m.summary !== undefined) {
    const s = m.summary as Record<string, unknown>;
    if (!Array.isArray(s.bullets)) errors.push('summary.bullets must be an array of strings');
  }
  if (m.apiDiff !== undefined && !Array.isArray(m.apiDiff)) {
    errors.push('apiDiff must be an array when set');
  }
  if (m.testEvidence !== undefined && !Array.isArray(m.testEvidence)) {
    errors.push(
      'testEvidence must be an array of { name, result: "pass"|"fail"|"skip", delta? } when set ' +
        `(got ${m.testEvidence === null ? 'null' : typeof m.testEvidence}) — not an object map. ` +
        'e.g. [{ "name": "unit", "result": "pass" }]',
    );
  }
  if (m.filesChanged !== undefined && !Array.isArray(m.filesChanged)) {
    errors.push('filesChanged must be an array when set');
  }
  if (m.usage_example !== undefined && typeof m.usage_example !== 'string') {
    errors.push('usage_example must be a string when set');
  }
  if (m.impact !== undefined && !Array.isArray(m.impact)) {
    errors.push('impact must be an array of strings when set');
  }

  return errors;
}

/**
 * Coerce common authoring mistakes in a raw demo.json into the schema shape
 * BEFORE validation, so a single wrong shape can't wedge the unifier loop. The
 * unifier composed-gate calls this, persists the result, then validates — a
 * forgiving normalize, not a silent rewrite of intent.
 *
 * Currently handles `testEvidence` authored as an object MAP
 * (`{ qualityGate: "npm test → 16/16 pass", … }` — observed wedging gitpulse's
 * first cycle 2026-06-21) → the schema's `TestResultRow[]` (`{ name, result,
 * delta? }`), inferring `result` from the text (fail/skip keywords → fail/skip,
 * else pass) and keeping the descriptive string as `delta`. An already-array
 * `testEvidence` (or absent) passes through unchanged. Never throws.
 */
export function coerceDemoModel(raw: unknown): { model: unknown; changed: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { model: raw, changed: false };
  const m = { ...(raw as Record<string, unknown>) };
  let changed = false;

  const te = m.testEvidence;
  if (te && typeof te === 'object' && !Array.isArray(te)) {
    m.testEvidence = Object.entries(te as Record<string, unknown>).map(([key, v]) => {
      // Already a row-ish object — preserve its declared fields.
      if (v && typeof v === 'object' && !Array.isArray(v) && 'result' in (v as object)) {
        const vo = v as Record<string, unknown>;
        const row: { name: string; result: string; delta?: string } = {
          name: typeof vo.name === 'string' && vo.name.trim() ? vo.name : key,
          result: inferTestResult(vo.result),
        };
        if (typeof vo.delta === 'string' && vo.delta.trim()) row.delta = vo.delta;
        return row;
      }
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      const row: { name: string; result: string; delta?: string } = { name: key, result: inferTestResult(text) };
      if (text && text.trim()) row.delta = text;
      return row;
    });
    changed = true;
  }

  return { model: m, changed };
}

/** Infer a `pass|fail|skip` verdict from a free-text test-evidence value. */
function inferTestResult(v: unknown): 'pass' | 'fail' | 'skip' {
  if (v === 'pass' || v === 'fail' || v === 'skip') return v;
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  if (/\b(fail|failed|error|✗|❌)\b/i.test(text)) return 'fail';
  if (/\bskip(ped)?\b/i.test(text)) return 'skip';
  return 'pass';
}

export type CapturedMedia = {
  label: string;
  beforeImage?: string | null;
  afterImage?: string | null;
};


function pngToDataUri(file: string): string | null {
  try {
    const buf = readFileSync(file);
    if (buf.byteLength > MAX_INLINE_IMAGE_BYTES) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Collect captured before/after PNGs from a capture bundle
 * (`before/<label>.png` + `after/<label>.png`) into `CapturedMedia[]`,
 * keyed by filename stem. Used by `forge demo capture` to back-fill
 * `demo.json`. Best-effort; never throws.
 */
export function collectCapturedMedia(bundleDir: string): CapturedMedia[] {
  const byLabel = new Map<string, CapturedMedia>();
  const scan = (side: 'before' | 'after'): void => {
    const dir = join(bundleDir, side);
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.png')) continue;
      const label = name.replace(/\.png$/i, '');
      const uri = pngToDataUri(join(dir, name));
      if (!uri) continue;
      const entry = byLabel.get(label) ?? { label };
      if (side === 'before') entry.beforeImage = uri;
      else entry.afterImage = uri;
      byLabel.set(label, entry);
    }
  };
  scan('before');
  scan('after');
  return [...byLabel.values()];
}

/**
 * Merge captured before/after media (data URIs) into a `DemoModel`'s
 * checkpoints by `label`. Matching checkpoints gain their images; captured
 * labels with no matching checkpoint are appended as screenshot checkpoints so
 * nothing captured is dropped. Pure + immutable — the media-capture skill
 * (`forge demo capture`) calls this then re-renders the bundle.
 */
export function mergeCapturedMedia(model: DemoModel, captured: CapturedMedia[]): DemoModel {
  const byLabel = new Map(captured.map((c) => [c.label, c]));
  const matchedLabels = new Set<string>();
  const checkpoints = model.checkpoints.map((cp) => {
    const cap = byLabel.get(cp.label);
    if (!cap) return cp;
    matchedLabels.add(cp.label);
    return {
      ...cp,
      kind: cp.kind === 'harness' ? cp.kind : 'screenshot',
      beforeImage: cap.beforeImage ?? cp.beforeImage ?? null,
      afterImage: cap.afterImage ?? cp.afterImage ?? null,
    } satisfies DemoModelCheckpoint;
  });
  const appended = captured
    .filter((c) => !matchedLabels.has(c.label) && (c.beforeImage || c.afterImage))
    .map<DemoModelCheckpoint>((c) => ({
      label: c.label,
      kind: 'screenshot',
      caption: c.label,
      beforeImage: c.beforeImage ?? null,
      afterImage: c.afterImage ?? null,
    }));
  return { ...model, checkpoints: [...checkpoints, ...appended] };
}

export type RenderDemoBundleResult = {
  ok: boolean;
  errors: string[];
  wrote: string[];
};

/**
 * Read `<demoDir>/demo.json`, validate it, and (when valid) write the derived
 * `DEMO.md` alongside it (F4: the single PR-facing demo artifact; the demo.json
 * sidecar stays for the review surface). The unifier authors `demo.json` once
 * and runs this to emit the derived markdown it commits. Never throws — returns
 * the validation errors so the caller can surface them.
 */
/** A real API GET of a live resource, persisted by an acceptance test. */
export type LiveEvidence = { label?: string; url: string; capturedAt?: string; response?: string };

/**
 * Read persisted live-evidence files the acceptance test wrote under
 * `<worktree>/.forge/live-evidence/*.json` (its real API GET response, captured
 * before the resource is destroyed). Each file: `{ url, capturedAt?, response?,
 * label? }`. Best-effort — never throws; skips malformed / urlless files.
 */
export function collectLiveEvidence(worktreePath: string): LiveEvidence[] {
  const dir = join(worktreePath, '.forge', 'live-evidence');
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: LiveEvidence[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
      if (typeof p.url !== 'string' || p.url.trim() === '') continue;
      out.push({
        label: typeof p.label === 'string' ? p.label : name.replace(/\.json$/i, ''),
        url: p.url,
        capturedAt: typeof p.capturedAt === 'string' ? p.capturedAt : undefined,
        response: typeof p.response === 'string'
          ? p.response
          : p.response != null ? JSON.stringify(p.response, null, 2) : undefined,
      });
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Merge live evidence into a DemoModel (pure + immutable). Evidence whose label
 * matches a checkpoint label attaches there; the rest is appended as `harness`
 * checkpoints so the live proof always surfaces (and the live-evidence gate can
 * see `checkpoint.liveEvidence.url`).
 */
export function mergeLiveEvidence(model: DemoModel, evidence: LiveEvidence[]): DemoModel {
  if (evidence.length === 0) return model;
  const byLabel = new Map(evidence.map((e) => [e.label ?? e.url, e]));
  const matched = new Set<string>();
  const checkpoints = model.checkpoints.map((cp) => {
    const ev = byLabel.get(cp.label);
    if (!ev) return cp;
    matched.add(cp.label);
    return { ...cp, liveEvidence: { url: ev.url, capturedAt: ev.capturedAt, response: ev.response } };
  });
  const appended: DemoModelCheckpoint[] = evidence
    .filter((e) => !matched.has(e.label ?? e.url))
    .map((e) => ({
      label: e.label ?? 'live-evidence',
      kind: 'harness',
      caption: `Live evidence — ${e.label ?? 'API GET'}`,
      afterNote: `Real API GET against the live system: ${e.url}`,
      liveEvidence: { url: e.url, capturedAt: e.capturedAt, response: e.response },
    }));
  return { ...model, checkpoints: [...checkpoints, ...appended] };
}

export function renderDemoBundle(
  demoDir: string,
  worktreePath?: string,
): RenderDemoBundleResult {
  const jsonPath = join(demoDir, 'demo.json');
  if (!existsSync(jsonPath)) {
    return { ok: false, errors: [`demo.json not found at ${jsonPath}`], wrote: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`demo.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`], wrote: [] };
  }
  // Back-fill captured live evidence (the acceptance test persisted it under
  // .forge/live-evidence/) into demo.json BEFORE validation/render, so the demo
  // SHOWS the real resource and the live-evidence gate sees checkpoint.liveEvidence.
  if (worktreePath) {
    const evidence = collectLiveEvidence(worktreePath);
    if (evidence.length > 0 && parsed != null && typeof parsed === 'object') {
      parsed = mergeLiveEvidence(parsed as DemoModel, evidence);
      try { writeFileSync(jsonPath, JSON.stringify(parsed, null, 2) + '\n'); } catch { /* best-effort */ }
    }
  }
  const errors = validateDemoModel(parsed);
  if (errors.length > 0) return { ok: false, errors, wrote: [] };

  const model = parsed as DemoModel;
  // F4: the demo OUTPUT is a single PR-facing markdown (+ the demo.json sidecar
  // the review surface renders natively). DEMO.html is retired.
  const mdPath = join(demoDir, 'DEMO.md');
  writeFileSync(mdPath, renderDemoMarkdown(model));
  return { ok: true, errors: [], wrote: [mdPath] };
}

/** Scratch files written by forge orchestrators that should not appear in the demo. */
const SCRATCH_FILE_PATTERNS = [/\bAGENT\.md\b/, /\bPROMPT\.md\b/, /\bfix_plan\.md\b/];

/** Strip forge scratch files from a git diff --stat string. */
function stripScratchFromDiffStat(diffStat: string): string {
  return diffStat
    .split('\n')
    .filter((line) => !SCRATCH_FILE_PATTERNS.some((re) => re.test(line)))
    .join('\n')
    .trim();
}

/** Derive the checkpoints section heading from the dominant checkpoint kind. */
function checkpointsSectionHeadingMd(checkpoints: DemoModelCheckpoint[]): string {
  if (checkpoints.length === 0) return 'Visual Changes';
  const hasMedia = checkpoints.some((c) => c.kind === 'screenshot' || c.kind === 'video');
  if (hasMedia) return 'Visual Changes';
  const allHarness = checkpoints.every((c) => c.kind === 'harness');
  if (allHarness) return 'Test Evidence';
  return 'Visual Changes';
}

/** Render a derived DEMO.md (the PR-self-contained convenience). Markdown only;
 *  media is referenced as relative links rather than embedded. */
export function renderDemoMarkdown(model: DemoModel): string {
  const lines: string[] = [];
  lines.push(`# ${model.title}`);
  lines.push('');
  lines.push(`> _Derived from \`demo.json\` (ADR 021). Essence:_ ${model.essence}`);
  lines.push('');

  if (model.summary) {
    lines.push('## Summary');
    lines.push('');
    for (const b of model.summary.bullets) lines.push(`- ${b}`);
    if (model.summary.prUrl) lines.push(`- PR: ${model.summary.prUrl}`);
    if (model.summary.branch) lines.push(`- Branch: \`${model.summary.branch}\``);
    if (model.summary.commitSha) lines.push(`- Commit: \`${model.summary.commitSha}\``);
    lines.push('');
  }

  if (model.acEvaluations && model.acEvaluations.length > 0) {
    lines.push('## Intent & Outcome');
    lines.push('');
    lines.push(`> _Assessed intent:_ ${model.essence}`);
    lines.push('');
    lines.push('| # | Acceptance criterion | Verdict | Evidence |');
    lines.push('|---|---|---|---|');
    const verdictSymbol = (v: string): string => v === 'met' ? '✓ met' : v === 'missed' ? '✗ missed' : '~ partial';
    model.acEvaluations.forEach((e, i) => {
      lines.push(`| ${i + 1} | ${e.criterion} | ${verdictSymbol(e.verdict)} | ${e.evidence} |`);
    });
    lines.push('');
  }

  const checkpointsHeading = checkpointsSectionHeadingMd(model.checkpoints);
  lines.push(`## ${checkpointsHeading}`);
  lines.push('');
  for (const c of model.checkpoints) {
    lines.push(`### ${c.caption}`);
    lines.push('');
    if (c.beforeNote) lines.push(`- **Before:** ${c.beforeNote}`);
    if (c.afterNote) lines.push(`- **After:** ${c.afterNote}`);
    if (c.liveEvidence?.url) {
      lines.push(`- **Live evidence (real API GET):** \`${c.liveEvidence.url}\`${c.liveEvidence.capturedAt ? ` _(captured ${c.liveEvidence.capturedAt})_` : ''}`);
      if (c.liveEvidence.response) {
        lines.push('');
        lines.push('```json');
        lines.push(c.liveEvidence.response.length > 4000 ? c.liveEvidence.response.slice(0, 4000) + '\n… (truncated)' : c.liveEvidence.response);
        lines.push('```');
      }
    }
    if (c.beforeImage || c.beforeVideoSrc) lines.push(`- Before media: \`${c.label}\` (before)`);
    if (c.afterImage || c.afterVideoSrc) lines.push(`- After media: \`${c.label}\` (after)`);
    if (c.metrics && c.metrics.length > 0) {
      lines.push('');
      lines.push('| metric | before | after | Δ | parity |');
      lines.push('|---|---|---|---|---|');
      for (const r of c.metrics) {
        const d = r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%`;
        // `incomplete` → `new`: the metric is net-new (no prior baseline); the
        // `after` column is the result. The literal word read as "unfinished".
        const parity = r.parity === 'incomplete' ? 'new' : r.parity;
        lines.push(`| ${r.label} | ${r.before ?? '—'} | ${r.after ?? '—'} | ${d} | ${parity} |`);
      }
      lines.push('');
      lines.push('> parity: **match**/**within** = unchanged · **new** = newly added, no prior baseline (the *after* column is the result — PASS means the new test is green) · **diverged** = regressed vs baseline (the only state that signals a problem).');
    }
    lines.push('');
  }

  if (model.apiDiff && model.apiDiff.length > 0) {
    lines.push('## API / Behaviour Diff');
    lines.push('');
    for (const e of model.apiDiff) {
      lines.push(`### ${e.name} (${e.change})`);
      lines.push('');
      if (e.before !== undefined) {
        lines.push('**Before:**');
        lines.push('```');
        lines.push(e.before);
        lines.push('```');
      }
      if (e.after !== undefined) {
        lines.push('**After:**');
        lines.push('```');
        lines.push(e.after);
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (model.testEvidence && model.testEvidence.length > 0) {
    lines.push('## Test Evidence');
    lines.push('');
    lines.push('| test | result | delta |');
    lines.push('|---|---|---|');
    for (const r of model.testEvidence) {
      lines.push(`| ${r.name} | ${r.result} | ${r.delta ?? '—'} |`);
    }
    lines.push('');
    lines.push('> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.');
    lines.push('');
  }

  if (model.acceptanceCriteria && model.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance criteria');
    lines.push('');
    for (const ac of model.acceptanceCriteria) lines.push(`- ${ac}`);
    lines.push('');
  }

  const cleanedDiffStat = stripScratchFromDiffStat(model.diffStat);
  lines.push('## Files Changed');
  lines.push('');
  if (model.filesChanged && model.filesChanged.length > 0) {
    for (const f of model.filesChanged) {
      lines.push(`- \`${f.path}\`${f.note ? ` — ${f.note}` : ''}`);
    }
    lines.push('');
    lines.push('```');
    lines.push(cleanedDiffStat);
    lines.push('```');
  } else {
    lines.push('```');
    lines.push(cleanedDiffStat);
    lines.push('```');
  }
  lines.push('');

  if (model.usage_example && model.usage_example.trim().length > 0) {
    lines.push('## Usage');
    lines.push('');
    lines.push('```');
    lines.push(model.usage_example);
    lines.push('```');
    lines.push('');
  }

  if (model.impact && model.impact.length > 0) {
    lines.push('## Impact');
    lines.push('');
    for (const b of model.impact) lines.push(`- ${b}`);
    lines.push('');
  }

  return lines.join('\n');
}
