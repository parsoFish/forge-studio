/**
 * flow-artifacts.ts — runtime half of the ADR-027 artifact contracts.
 *
 * The lint-time half (`validateArtifactRef`) proves every `FlowEdge.artifact`
 * resolves to a registered template. This is the RUNTIME half:
 *
 *  - `assertInboundArtifacts` — before a node runs, assert each inbound edge's
 *    artifact actually exists on disk (the producing node really wrote it). A
 *    missing artifact is a real pipeline break, so it throws with a clear
 *    message instead of letting the consumer fail obscurely deeper in.
 *  - `writeVerdictJson` — persist the review verdict as the durable
 *    `_logs/<cycleId>/artifacts/verdict.json` the `verdict` template declares
 *    (today the verdict is only a transient POST that drives state transitions).
 *
 * Path resolution mirrors where the phases actually write:
 *   `_queue/in-flight/<id>.md` → the manifest itself (CycleInput.manifestPath)
 *   `_logs/…`, `_queue/…`       → forge root
 *   `.forge/…`, `demo/…`        → the worktree
 * A required file ending in `/` is a directory and must be non-empty.
 *
 * NOTE: the `verdict` artifact (the reflect node's inbound) is intentionally
 * NOT guarded. It is produced by the human review gate, which in unattended mode
 * resolves asynchronously — the cycle parks at `pr-open` and the reflect node
 * no-ops until a later post-merge trigger. Guarding it would false-positive on
 * every healthy pr-open cycle. The caller skips the reflect node; verdict.json is
 * persisted at the decision point (bridge `applyReviewVerdict` / `finalize-merged`)
 * as a durable record for the reflector to read.
 */
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FlowDefinition } from './studio/types.ts';
import type { AcceptanceCriterion } from './work-item.ts';
import { worktreeDemoRelDir } from './demo-paths.ts';

/** The subset of CycleInput the guard needs to resolve artifact locations. */
export type ArtifactGuardInput = {
  initiativeId: string;
  manifestPath: string;
  worktreePath: string;
  cycleId?: string;
};

/** The subset of an ArtifactTemplate the guard reads. */
export type ArtifactContract = {
  id: string;
  kind: 'file' | 'git-state';
  schema: { requiredFiles?: string[] };
};

/**
 * Resolve a template `requiredFiles` pattern to an absolute path, or null when
 * it cannot be resolved (an unbound `<cycleId>` placeholder) — in which case the
 * caller skips it rather than false-positive.
 */
export function resolveRequiredFile(rf: string, input: ArtifactGuardInput, forgeRoot: string): string | null {
  // The plan artifact's canonical location IS the in-flight manifest.
  if (rf.startsWith('_queue/in-flight/')) return input.manifestPath;

  let p = rf;
  // Demo artifacts live at the project's artifactRoot-resolved demo dir, NOT a
  // hardcoded top-level `demo/<initiative-id>/` (e.g. betterado lands them at
  // `forge/history/<initiative-id>/demo`). Rewrite the canonical `demo/<initiative-id>`
  // prefix BEFORE the generic `<initiative-id>` expansion so the suffix (e.g.
  // `/demo.json`) is preserved.
  if (p.startsWith('demo/<initiative-id>')) {
    const demoDir = worktreeDemoRelDir(input.worktreePath, input.initiativeId);
    p = demoDir + p.slice('demo/<initiative-id>'.length);
  }
  if (p.includes('<initiative-id>')) p = p.split('<initiative-id>').join(input.initiativeId);
  if (p.includes('<cycleId>')) {
    if (!input.cycleId) return null; // unbound placeholder → cannot assert
    p = p.split('<cycleId>').join(input.cycleId);
  }
  if (p.startsWith('_logs/') || p.startsWith('_queue/')) return resolve(forgeRoot, p);
  return resolve(input.worktreePath, p); // .forge/…, demo/…
}

function present(abs: string, pattern: string): boolean {
  if (!existsSync(abs)) return false;
  if (pattern.endsWith('/')) {
    try {
      return readdirSync(abs).length > 0; // a directory artifact must be non-empty
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Throw if any inbound-edge artifact for `nodeId` is missing on disk. `git-state`
 * artifacts are skipped (their invariants are enforced by the unifier's
 * close-contract gates); unresolved templates are tolerated (lint already
 * guarantees resolution). `onMissing` lets the caller emit a structured event
 * before the throw.
 */
export function assertInboundArtifacts(args: {
  flow: FlowDefinition;
  nodeId: string;
  input: ArtifactGuardInput;
  forgeRoot: string;
  templates: Map<string, ArtifactContract>;
  onMissing?: (detail: { nodeId: string; artifact: string; required: string; resolved: string }) => void;
}): void {
  const { flow, nodeId, input, forgeRoot, templates, onMissing } = args;
  for (const edge of flow.edges) {
    if (edge.to !== nodeId) continue;
    const tmpl = templates.get(edge.artifact);
    if (!tmpl) continue; // lint guarantees resolution; tolerant at runtime
    if (tmpl.kind === 'git-state') continue; // git invariants live in the close-contract gates
    for (const rf of tmpl.schema.requiredFiles ?? []) {
      const abs = resolveRequiredFile(rf, input, forgeRoot);
      if (abs === null) continue;
      if (!present(abs, rf)) {
        onMissing?.({ nodeId, artifact: edge.artifact, required: rf, resolved: abs });
        throw new Error(
          `flow-runner.artifact-missing: node "${nodeId}" requires artifact "${edge.artifact}", ` +
            `but its required file "${rf}" is absent (resolved to ${abs}). ` +
            `The upstream producer did not write it — triage the producing node before continuing.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Verdict persistence — the `verdict` artifact (review → reflector)
// ---------------------------------------------------------------------------

export type VerdictRecord = {
  kind: 'approve' | 'send-back';
  initiative_id: string;
  cycleId: string;
  decidedBy: 'operator' | 'merge';
  rationale?: string;
  acceptanceCriteria?: unknown[]; // the send-back UWI ACs, as the UI submitted them
  at: string;
  /**
   * Task A-finalfix ride-along 3: when this verdict was recorded under
   * FORGE_DRY_BRIDGE=1 (see cli/dry-bridge.ts), the durable artifact should
   * say so rather than reading as an ordinary merge — `skipped` names which
   * real-acting steps (release-finalize / merge-pr / finalize-after-merge)
   * were stubbed. Omitted entirely outside dry-bridge.
   */
  dryBridge?: boolean;
  skipped?: string[];
};

export function verdictJsonPath(logsRoot: string, cycleId: string): string {
  return resolve(logsRoot, cycleId, 'artifacts', 'verdict.json');
}

/**
 * Persist the verdict artifact. `overwrite: false` (the default) keeps an
 * existing operator verdict from being clobbered by a later merge-path fallback.
 * Returns the path written, or null when skipped (exists + !overwrite) or on an
 * IO error — the durable record is best-effort and never breaks the cycle.
 */
export function writeVerdictJson(
  logsRoot: string,
  record: VerdictRecord,
  opts: { overwrite?: boolean } = {},
): string | null {
  const p = verdictJsonPath(logsRoot, record.cycleId);
  if (!opts.overwrite && existsSync(p)) return null;
  try {
    mkdirSync(resolve(logsRoot, record.cycleId, 'artifacts'), { recursive: true });
    writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demo-fix-spec persistence — the `demo-fix-spec` artifact (R4-07-F2)
//
// The demo agent's AC-miss judgment: when the demo cannot show an acceptance
// criterion passing, the agent scopes fix proposals; the pipeline persists them
// here for the R4-10-F1 shared fix executor (the develop agent) to compile into
// real work items. Field names deliberately mirror ADR-015's WorkItem
// (`acceptance_criteria` GWT shape, `files_in_scope`) so that compilation is a
// mechanical id/kind assignment, not a translation. This artifact is judgment
// output only — nothing in this module dispatches or enqueues anything.
// ---------------------------------------------------------------------------

export type DemoFixProposal = {
  id: string; // 'FIX-1'…
  /** Verbatim from the demo.json acEvaluations entry that failed. */
  criterion: string;
  /** AcEvaluation vocabulary minus 'met' — a met criterion never yields a proposal. */
  verdict: 'partial' | 'missed';
  /** Why the demo cannot show the criterion passing. */
  evidence: string;
  /** One-line scoped fix mission. */
  title: string;
  acceptance_criteria: AcceptanceCriterion[];
  files_in_scope: string[]; // worktree-relative
  rationale: string;
};

export type DemoFixSpecRecord = {
  initiative_id: string;
  cycleId: string;
  /** Worktree-relative path of the demo.json this judgment was made against. */
  demoJsonPath: string;
  authoredAt: string;
  proposals: DemoFixProposal[]; // ≥1 — an all-met demo writes no fix spec at all
};

export function demoFixSpecJsonPath(logsRoot: string, cycleId: string): string {
  return resolve(logsRoot, cycleId, 'artifacts', 'demo-fix-spec.json');
}

const FIX_VERDICTS = ['partial', 'missed'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonBlank(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Pure shape validation; returns human-readable errors naming the offending field. */
export function validateDemoFixSpec(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['demo-fix-spec must be a JSON object'];
  if (!nonBlank(raw.initiative_id)) errors.push('initiative_id must be a non-empty string');
  if (!nonBlank(raw.cycleId)) errors.push('cycleId must be a non-empty string');
  if (!nonBlank(raw.demoJsonPath)) errors.push('demoJsonPath must be a non-empty string');
  if (!nonBlank(raw.authoredAt)) errors.push('authoredAt must be a non-empty string');
  if (!Array.isArray(raw.proposals) || raw.proposals.length === 0) {
    errors.push('proposals must be a non-empty array');
    return errors;
  }
  raw.proposals.forEach((p, i) => {
    const at = `proposals[${i}]`;
    if (!isRecord(p)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!nonBlank(p.id)) errors.push(`${at}.id must be a non-empty string`);
    if (!nonBlank(p.criterion)) errors.push(`${at}.criterion must be a non-empty string`);
    if (!FIX_VERDICTS.includes(p.verdict as (typeof FIX_VERDICTS)[number])) {
      errors.push(`${at}.verdict "${String(p.verdict)}" invalid — allowed: partial | missed (never met)`);
    }
    if (!nonBlank(p.evidence)) errors.push(`${at}.evidence must be a non-empty string`);
    if (!nonBlank(p.title)) errors.push(`${at}.title must be a non-empty string`);
    if (!Array.isArray(p.acceptance_criteria) || p.acceptance_criteria.length === 0) {
      errors.push(`${at}.acceptance_criteria must be a non-empty array of {given, when, then}`);
    } else {
      p.acceptance_criteria.forEach((c, j) => {
        if (!isRecord(c) || !nonBlank(c.given) || !nonBlank(c.when) || !nonBlank(c.then)) {
          errors.push(`${at}.acceptance_criteria[${j}] must have non-empty given/when/then`);
        }
      });
    }
    if (!Array.isArray(p.files_in_scope) || p.files_in_scope.length === 0 || !p.files_in_scope.every(nonBlank)) {
      errors.push(`${at}.files_in_scope must be a non-empty array of paths`);
    }
    if (!nonBlank(p.rationale)) errors.push(`${at}.rationale must be a non-empty string`);
  });
  return errors;
}

/**
 * Persist the demo-fix-spec artifact. Always overwrites: unlike the verdict
 * (an operator decision that must never be clobbered), this is agent judgment
 * output where the latest authoring for the cycle wins — a re-run demo pass
 * replaces its own earlier proposals. Returns the path written, or null on an
 * IO error (best-effort durable record, never breaks the pipeline).
 */
export function writeDemoFixSpecJson(logsRoot: string, record: DemoFixSpecRecord): string | null {
  const p = demoFixSpecJsonPath(logsRoot, record.cycleId);
  try {
    mkdirSync(resolve(logsRoot, record.cycleId, 'artifacts'), { recursive: true });
    writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Release persistence — the `release` terminal record (WS-A · final-loop)
// ---------------------------------------------------------------------------

export type ReleaseRecord = {
  initiative_id: string;
  cycleId: string;
  project: string;
  /** Computed semver version (null when the finaliser could not determine one). */
  version: string | null;
  /** Worktree-relative changelog path the finaliser promoted. */
  changelogPath: string;
  /** The PR branch the finalised release commit landed on. */
  branch: string;
  /** ISO-8601 timestamp of finalisation. */
  finalizedAt: string;
};

export function releaseJsonPath(logsRoot: string, cycleId: string): string {
  return resolve(logsRoot, cycleId, 'artifacts', 'release.json');
}

/**
 * Persist the release terminal record. `overwrite: false` (the default) keeps a
 * re-approve from clobbering the first finalisation. Returns the path written,
 * or null when skipped (exists + !overwrite) or on an IO error — the durable
 * record is best-effort and never breaks the merge.
 */
export function writeReleaseJson(
  logsRoot: string,
  record: ReleaseRecord,
  opts: { overwrite?: boolean } = {},
): string | null {
  const p = releaseJsonPath(logsRoot, record.cycleId);
  if (!opts.overwrite && existsSync(p)) return null;
  try {
    mkdirSync(resolve(logsRoot, record.cycleId, 'artifacts'), { recursive: true });
    writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return p;
  } catch {
    return null;
  }
}
