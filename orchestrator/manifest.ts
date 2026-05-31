/**
 * Initiative manifest — typed schema + parse/serialise/validate/write.
 *
 * The architect emits manifests; the orchestrator reads them when claiming.
 * Manifests live as markdown files with YAML frontmatter under
 * `_queue/{pending,in-flight,...}/<initiative-id>.md`.
 *
 * Per ADR 007 (markdown artifacts) and ADR 011 (file-based queue).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

export type Feature = {
  feature_id: string;          // FEAT-<n>
  title: string;
  depends_on: string[];        // feature_ids of prerequisite features
};

export type ManifestPhase = 'pending' | 'in-flight' | 'ready-for-review' | 'done' | 'failed';

/**
 * G6 (closes finding I6): every initiative declares whether forge produced
 * it autonomously (`architect` — the out-of-cycle architect decomposed a
 * vision into right-sized initiatives) or the operator hand-directed the
 * work through the pipeline (`human-directed` — deliberate structural
 * surgery routed through forge, e.g. the trafficGame
 * `simplification-{tests,source,arch}` initiatives).
 *
 * The two modes have *different* success criteria: autonomous cycles are
 * judged on convergence-without-intervention; hand-directed cycles on
 * whether the specified work landed. Recording them identically pollutes
 * the autonomy signal (brain theme `human-directed-work-as-initiatives`).
 * Metrics and the reflector separate the cohorts on this field so "did
 * forge get more autonomous" stays answerable.
 *
 * Defaults to `architect` when absent (back-compat for manifests authored
 * before this field existed — NOT a feature flag, just a schema default).
 */
export type InitiativeOrigin = 'architect' | 'human-directed';

const INITIATIVE_ORIGINS: readonly InitiativeOrigin[] = ['architect', 'human-directed'];
const DEFAULT_ORIGIN: InitiativeOrigin = 'architect';

export type InitiativeManifest = {
  initiative_id: string;       // INIT-<YYYY-MM-DD>-<slug>
  project: string;
  project_repo_path: string;
  created_at: string;          // ISO-8601
  iteration_budget: number;    // > 0
  cost_budget_usd: number;     // > 0
  phase: ManifestPhase;
  /**
   * G6: autonomous-vs-hand-directed cohort tag. Defaults to `architect`
   * when the frontmatter omits it (legacy manifests).
   */
  origin: InitiativeOrigin;
  features: Feature[];
  /**
   * F-25: initiative-level dependencies. Each entry is another initiative_id
   * that must be in `_queue/done/` before the scheduler may claim this one.
   * Empty / absent = no prerequisites. Distinct from `features[].depends_on`,
   * which orders work-items WITHIN this initiative.
   */
  depends_on_initiatives?: string[];
  /**
   * F-27: number of times this manifest has been auto-retried by the
   * scheduler after a recoverable failure. Used as a cap (`MAX_AUTO_RETRIES`)
   * to prevent infinite retry loops. Annotated by the scheduler on each
   * recovery; humans can also reset it manually if they amend the manifest
   * and want to give it another shot.
   */
  retry_count?: number;
  /**
   * F-27: list of failure modes that have previously caused this manifest
   * to be auto-retried. If the same mode shows up retry_count + 1 times,
   * that's strong evidence the issue isn't transient — the next failure
   * stops in `failed/` regardless of the mode's nominal `recoverable: true`.
   */
  previous_failure_modes?: string[];
  body: string;                // markdown initiative spec
  /**
   * Optional per-project quality-gate command. Used by both the dev-loop
   * (Ralph stop condition) and the reviewer (orchestrator-side gate). When
   * absent, falls back to `npm test` if `package.json` exists in the
   * worktree, else `true` (no-op gate). Single source of truth — both phases
   * use the same command, eliminating drift (F-04 / F-06).
   *
   * Examples:
   *   ['npm', 'test']
   *   ['pytest', '-q']
   *   ['cargo', 'test', '--all']
   *   ['bats', 'tests/']
   */
  quality_gate_cmd?: string[];
  /**
   * ADR 019: resume a stalled cycle from a later phase rather than re-running
   * it from scratch. `'unifier'` ⇒ skip architect/PM/per-WI dev-loop and run
   * only the unifier sub-phase + downstream phases against the preserved
   * branch. Set by `forge requeue --resume-from=unifier`; cleared on a clean
   * full run. Absent ⇒ normal full cycle.
   */
  resume_from?: 'unifier';
  /**
   * cascade-v4 #7: a throwaway / verification cycle (e.g. `verify-cycle.mjs`
   * frozen-SHA routine runs) should NOT pollute the durable brain. When
   * `disposable: true`, the reflector skips its theme + cycle-archive writes
   * (it still runs closure/merge); the durable brain accretes only from real
   * initiatives. Absent / false ⇒ normal reflection.
   */
  disposable?: boolean;
  // Optional runtime fields written by the scheduler
  claimed_at?: string;
  claimed_by?: string;
  worktree_path?: string;
};

const INITIATIVE_ID_PATTERN = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const FEATURE_ID_PATTERN = /^FEAT-\d+$/;

export function parseManifest(content: string): InitiativeManifest {
  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;

  const initiative_id = stringField(data, 'initiative_id', true);
  const project = stringField(data, 'project', true);
  const created_at = stringField(data, 'created_at', true);
  const project_repo_path = stringField(data, 'project_repo_path', false) ?? '';
  const iteration_budget = numberField(data, 'iteration_budget', true);
  const cost_budget_usd = numberField(data, 'cost_budget_usd', true);
  const phase = (stringField(data, 'phase', false) ?? 'pending') as ManifestPhase;
  // G6: default to `architect` when the frontmatter omits `origin` so
  // pre-existing manifests round-trip unchanged. An unrecognised value is
  // preserved verbatim here and rejected by validateManifest (fail-fast at
  // the boundary rather than silently coercing).
  const rawOrigin = stringField(data, 'origin', false);
  const origin = (rawOrigin ? rawOrigin : DEFAULT_ORIGIN) as InitiativeOrigin;

  const rawFeatures = Array.isArray(data.features) ? (data.features as unknown[]) : [];
  const features: Feature[] = rawFeatures.map((f, i) => parseFeature(f, i));

  const manifest: InitiativeManifest = {
    initiative_id,
    project,
    project_repo_path,
    created_at,
    iteration_budget,
    cost_budget_usd,
    phase,
    origin,
    features,
    body: parsed.content.replace(/^\n+/, ''),
  };
  if (typeof data.claimed_at === 'string') manifest.claimed_at = data.claimed_at;
  if (typeof data.claimed_by === 'string') manifest.claimed_by = data.claimed_by;
  if (typeof data.worktree_path === 'string') manifest.worktree_path = data.worktree_path;
  if (Array.isArray(data.quality_gate_cmd)) {
    const cmd = (data.quality_gate_cmd as unknown[]).filter((s): s is string => typeof s === 'string');
    if (cmd.length > 0) manifest.quality_gate_cmd = cmd;
  }
  if (Array.isArray(data.depends_on_initiatives)) {
    const deps = (data.depends_on_initiatives as unknown[]).filter((s): s is string => typeof s === 'string');
    if (deps.length > 0) manifest.depends_on_initiatives = deps;
  }
  if (data.resume_from === 'unifier') manifest.resume_from = 'unifier';
  if (data.disposable === true) manifest.disposable = true;
  if (typeof data.retry_count === 'number') manifest.retry_count = data.retry_count;
  if (Array.isArray(data.previous_failure_modes)) {
    const modes = (data.previous_failure_modes as unknown[]).filter((s): s is string => typeof s === 'string');
    if (modes.length > 0) manifest.previous_failure_modes = modes;
  }
  return manifest;
}

export function serializeManifest(m: InitiativeManifest): string {
  const data: Record<string, unknown> = {
    initiative_id: m.initiative_id,
    project: m.project,
    project_repo_path: m.project_repo_path,
    created_at: m.created_at,
    iteration_budget: m.iteration_budget,
    cost_budget_usd: m.cost_budget_usd,
    phase: m.phase,
    // G6: always serialise origin (default `architect`) so a round-tripped
    // legacy manifest gains the explicit tag — the cohort split must be
    // unambiguous on disk, not inferred at read time forever.
    origin: m.origin ?? DEFAULT_ORIGIN,
  };
  if (m.claimed_at) data.claimed_at = m.claimed_at;
  if (m.claimed_by) data.claimed_by = m.claimed_by;
  if (m.worktree_path) data.worktree_path = m.worktree_path;
  if (m.quality_gate_cmd && m.quality_gate_cmd.length > 0) {
    data.quality_gate_cmd = m.quality_gate_cmd;
  }
  if (m.depends_on_initiatives && m.depends_on_initiatives.length > 0) {
    data.depends_on_initiatives = m.depends_on_initiatives;
  }
  if (m.resume_from === 'unifier') {
    data.resume_from = m.resume_from;
  }
  if (m.disposable === true) {
    data.disposable = true;
  }
  if (typeof m.retry_count === 'number' && m.retry_count > 0) {
    data.retry_count = m.retry_count;
  }
  if (m.previous_failure_modes && m.previous_failure_modes.length > 0) {
    data.previous_failure_modes = m.previous_failure_modes;
  }
  if (m.features.length > 0) {
    data.features = m.features.map((f) => ({
      feature_id: f.feature_id,
      title: f.title,
      depends_on: f.depends_on,
    }));
  }
  return matter.stringify('\n' + m.body.replace(/^\n+/, ''), data);
}

export function validateManifest(m: InitiativeManifest): string[] {
  const errors: string[] = [];

  if (!m.initiative_id) {
    errors.push('initiative_id is required');
  } else if (!INITIATIVE_ID_PATTERN.test(m.initiative_id)) {
    errors.push(`initiative_id must match pattern INIT-YYYY-MM-DD-<slug>: got ${m.initiative_id}`);
  }
  if (!m.project) errors.push('project is required');
  if (!m.created_at) errors.push('created_at is required');
  if (!(m.iteration_budget > 0)) errors.push(`iteration_budget must be > 0: got ${m.iteration_budget}`);
  if (!(m.cost_budget_usd > 0)) errors.push(`cost_budget_usd must be > 0: got ${m.cost_budget_usd}`);
  if (!INITIATIVE_ORIGINS.includes(m.origin)) {
    errors.push(`origin must be one of ${INITIATIVE_ORIGINS.join(' | ')}: got ${String(m.origin)}`);
  }
  if (m.quality_gate_cmd !== undefined) {
    if (!Array.isArray(m.quality_gate_cmd) || m.quality_gate_cmd.length === 0) {
      errors.push('quality_gate_cmd must be a non-empty array of strings when set');
    } else if (!m.quality_gate_cmd.every((s) => typeof s === 'string' && s.length > 0)) {
      errors.push('quality_gate_cmd entries must be non-empty strings');
    }
  }
  if (m.depends_on_initiatives !== undefined) {
    if (!Array.isArray(m.depends_on_initiatives)) {
      errors.push('depends_on_initiatives must be an array of initiative_id strings when set');
    } else {
      for (const dep of m.depends_on_initiatives) {
        if (typeof dep !== 'string' || !INITIATIVE_ID_PATTERN.test(dep)) {
          errors.push(`depends_on_initiatives entry must match INIT-YYYY-MM-DD-<slug>: got ${dep}`);
        }
        if (dep === m.initiative_id) {
          errors.push(`depends_on_initiatives cannot contain self (${dep})`);
        }
      }
    }
  }

  // Feature shape + dependency graph
  const ids = new Set<string>();
  for (const f of m.features) {
    if (!f.feature_id || !FEATURE_ID_PATTERN.test(f.feature_id)) {
      errors.push(`feature ${f.feature_id || '<missing>'} must match FEAT-<n>`);
      continue;
    }
    if (ids.has(f.feature_id)) errors.push(`duplicate feature_id: ${f.feature_id}`);
    ids.add(f.feature_id);
  }
  for (const f of m.features) {
    for (const dep of f.depends_on) {
      if (!ids.has(dep)) errors.push(`feature ${f.feature_id}: depends_on references undeclared ${dep}`);
    }
  }
  const cycle = detectCycle(m.features);
  if (cycle) errors.push(`feature dependency cycle: ${cycle.join(' → ')}`);

  return errors;
}

export type WriteOptions = {
  queueRoot?: string;          // defaults to './_queue'
};

export function writeManifest(m: InitiativeManifest, opts: WriteOptions = {}): string {
  const errors = validateManifest(m);
  if (errors.length > 0) {
    throw new Error(`invalid manifest:\n  - ${errors.join('\n  - ')}`);
  }
  const queueRoot = resolve(opts.queueRoot ?? '_queue');
  const pending = join(queueRoot, 'pending');
  if (!existsSync(pending)) mkdirSync(pending, { recursive: true });
  const out = join(pending, `${m.initiative_id}.md`);
  writeFileSync(out, serializeManifest(m));
  return out;
}

/**
 * G6: best-effort origin reader for telemetry. Reads a manifest file and
 * returns its cohort tag, defaulting to `architect` when the file is
 * missing/unparseable (dry-runs, test fixtures) or the value is
 * unrecognised. Never throws — telemetry must not break the cycle.
 *
 * This is the single point metrics/reflector use to learn a cycle's
 * cohort, so the autonomous-vs-hand-directed split is read the same way
 * everywhere.
 */
export function readManifestOrigin(manifestPath: string): InitiativeOrigin {
  try {
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    return INITIATIVE_ORIGINS.includes(m.origin) ? m.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

// ---------- helpers ----------

function stringField(data: Record<string, unknown>, key: string, required: boolean): string {
  const v = data[key];
  if (typeof v === 'string') return v;
  // YAML parses ISO-8601 timestamps as Date — coerce back to ISO string.
  if (v instanceof Date) return v.toISOString();
  if (required) throw new Error(`manifest missing required field: ${key}`);
  return '';
}

function numberField(data: Record<string, unknown>, key: string, required: boolean): number {
  const v = data[key];
  if (typeof v === 'number') return v;
  if (required) throw new Error(`manifest missing required numeric field: ${key}`);
  return 0;
}

function parseFeature(f: unknown, idx: number): Feature {
  if (typeof f !== 'object' || f === null) {
    throw new Error(`features[${idx}] must be an object`);
  }
  const obj = f as Record<string, unknown>;
  const feature_id = typeof obj.feature_id === 'string' ? obj.feature_id : '';
  const title = typeof obj.title === 'string' ? obj.title : '';
  const depends_on = Array.isArray(obj.depends_on)
    ? (obj.depends_on as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return { feature_id, title, depends_on };
}

/** DFS cycle detection across features. Returns the cycle path if one is found. */
function detectCycle(features: Feature[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const f of features) adj.set(f.feature_id, f.depends_on);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);

  const stack: string[] = [];
  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of adj.get(id) ?? []) {
      const c = color.get(dep);
      if (c === undefined) continue;            // undeclared — flagged elsewhere
      if (c === GRAY) return [...stack.slice(stack.indexOf(dep)), dep];
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}
