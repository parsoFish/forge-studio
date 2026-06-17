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
  /**
   * F-25: initiative-level dependencies. Each entry is another initiative_id
   * that must be in `_queue/done/` before the scheduler may claim this one.
   * Empty / absent = no prerequisites. Distinct from `depends_on` on individual
   * work-items, which orders WIs WITHIN this initiative.
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
   * ADR 019 (amended by ADR 026): resume a stalled cycle from the unifier
   * sub-phase rather than re-running from scratch, reusing the preserved
   * worktree + branch — skip architect/PM/per-WI dev-loop and run only the
   * unifier (which drains any pending review UWIs) + downstream phases. Set by
   * `forge requeue --resume-from=unifier` (crash recovery). Absent ⇒ normal
   * full cycle. (The `developer` resume mode was retired with ADR 026: review
   * feedback is handled by typed UWIs inside the unifier, not a dev re-pass.)
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
  /**
   * ADR 026: the durable cycle id for this initiative, persisted on the manifest
   * at FIRST claim (`runCycle` mints it once). Every later re-entry — a crash-
   * recovery resume, the review→unifier drain, or the merge finalizer — threads
   * this SAME id so the initiative stays on ONE `_logs/<cycleId>` dir. Reusing
   * it is what dissolves the three release-folder defects (cost/status lineage
   * blanks, sibling cycle on send-back, WI hexes disappearing): one cycleId ⇒
   * one event log ⇒ one cost rollup ⇒ one set of hexes. Absent on legacy
   * manifests (the finalizer falls back to the latest matching `_logs` dir).
   */
  cycle_id?: string;
  /**
   * The Studio flow this initiative runs under (ADR-028 / J5). When present, the
   * run-model associates the run with this flow so it surfaces under
   * `/flows/<flow_id>` in the monitor. Absent ⇒ the historical default
   * `forge-cycle` (every legacy manifest), so existing behaviour is unchanged.
   */
  flow_id?: string;
  /**
   * P4: architect session id from the in-UI architect runner that produced this
   * manifest. Stamped during `runFinalizeStep` so the cycle's event log can emit
   * real architect start/end events (grounding the architect hex in actual data
   * rather than a synthetic mock). Absent when the manifest was created without
   * an in-UI architect session (legacy / hand-authored manifests).
   */
  architect_session_id?: string;
  /**
   * P4: total cost (USD) accrued by the architect session that produced this
   * manifest, summed from its `_logs/_architect-<sid>/events.jsonl`. When
   * present, `runCycle` emits a real architect end event with this cost so the
   * architect hex shows an accurate cost pill instead of a hardcoded mock value.
   */
  architect_cost_usd?: number;
  /**
   * P4: wall-clock duration (ms) of the architect session, computed as
   * `last started_at − first started_at` across the session event log. Emitted
   * alongside `architect_cost_usd` in the cycle's architect end event.
   */
  architect_duration_ms?: number;
};

const INITIATIVE_ID_PATTERN = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;

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

  const manifest: InitiativeManifest = {
    initiative_id,
    project,
    project_repo_path,
    created_at,
    iteration_budget,
    cost_budget_usd,
    phase,
    origin,
    body: parsed.content.replace(/^\n+/, ''),
  };
  if (typeof data.claimed_at === 'string') manifest.claimed_at = data.claimed_at;
  if (typeof data.claimed_by === 'string') manifest.claimed_by = data.claimed_by;
  if (typeof data.worktree_path === 'string') manifest.worktree_path = data.worktree_path;
  if (typeof data.cycle_id === 'string' && data.cycle_id.length > 0) manifest.cycle_id = data.cycle_id;
  if (typeof data.flow_id === 'string' && data.flow_id.length > 0) manifest.flow_id = data.flow_id;
  if (typeof data.architect_session_id === 'string' && data.architect_session_id.length > 0) {
    manifest.architect_session_id = data.architect_session_id;
  }
  if (typeof data.architect_cost_usd === 'number' && data.architect_cost_usd >= 0) {
    manifest.architect_cost_usd = data.architect_cost_usd;
  }
  if (typeof data.architect_duration_ms === 'number' && data.architect_duration_ms >= 0) {
    manifest.architect_duration_ms = data.architect_duration_ms;
  }
  if (Array.isArray(data.quality_gate_cmd)) {
    const cmd = (data.quality_gate_cmd as unknown[]).filter((s): s is string => typeof s === 'string');
    if (cmd.length > 0) manifest.quality_gate_cmd = cmd;
  }
  if (Array.isArray(data.depends_on_initiatives)) {
    const deps = (data.depends_on_initiatives as unknown[]).filter((s): s is string => typeof s === 'string');
    if (deps.length > 0) manifest.depends_on_initiatives = deps;
  }
  if (data.resume_from === 'unifier') {
    manifest.resume_from = data.resume_from;
  }
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
  if (m.cycle_id) data.cycle_id = m.cycle_id;
  if (m.flow_id) data.flow_id = m.flow_id;
  if (m.architect_session_id) data.architect_session_id = m.architect_session_id;
  if (typeof m.architect_cost_usd === 'number') data.architect_cost_usd = m.architect_cost_usd;
  if (typeof m.architect_duration_ms === 'number') data.architect_duration_ms = m.architect_duration_ms;
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

/**
 * ADR 026: best-effort read of the manifest's persisted `cycle_id`. Returns
 * `null` when the file is missing/unparseable (dry-runs, fixtures) or no id has
 * been persisted yet (legacy manifest). Never throws — lineage threading must
 * not break a cycle.
 */
export function readManifestCycleId(manifestPath: string): string | null {
  try {
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    return m.cycle_id && m.cycle_id.length > 0 ? m.cycle_id : null;
  } catch {
    return null;
  }
}

/**
 * ADR 028 / J5: best-effort read of the manifest's `flow_id` — the Studio flow
 * the cycle should run. Returns `null` when absent/unparseable so the caller
 * defaults to `forge-cycle`. Never throws — flow selection must not break a cycle.
 */
export function readManifestFlowId(manifestPath: string): string | null {
  try {
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    return m.flow_id && m.flow_id.length > 0 ? m.flow_id : null;
  } catch {
    return null;
  }
}

/**
 * ADR 026: persist `cycle_id` onto the manifest's frontmatter the first time an
 * initiative is claimed, so every later re-entry reuses the same `_logs` dir.
 * Idempotent + best-effort: if the manifest already carries a `cycle_id` (or is
 * missing/unparseable) this is a no-op and never throws. Round-trips through
 * parse/serialize (the same path `runRequeue` uses to annotate).
 */
export function persistManifestCycleId(manifestPath: string, cycleId: string): void {
  try {
    if (!existsSync(manifestPath)) return;
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    if (m.cycle_id && m.cycle_id.length > 0) return; // already anchored — never re-stamp
    writeFileSync(manifestPath, serializeManifest({ ...m, cycle_id: cycleId }));
  } catch {
    /* best-effort — a manifest write failure must not fail the cycle */
  }
}

/**
 * ADR 026: stamp `resume_from: unifier` on the manifest when a review send-back
 * appends UWIs, so that if the daemon CRASHES mid-drain the recovery sweep can
 * move the manifest to pending and the scheduler resumes it correctly (reuse the
 * worktree, skip PM + dev-loop) instead of re-running a full cycle. Idempotent +
 * best-effort. `forge requeue` (full re-run) clears it.
 */
export function persistManifestResumeFromUnifier(manifestPath: string): void {
  try {
    if (!existsSync(manifestPath)) return;
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    if (m.resume_from === 'unifier') return;
    writeFileSync(manifestPath, serializeManifest({ ...m, resume_from: 'unifier' }));
  } catch {
    /* best-effort — must not fail the verdict request */
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

