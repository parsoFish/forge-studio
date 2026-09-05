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

import type { FlowDefinition } from '@forge/contracts/studio/types.ts';
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
  acceptanceCriteria?: unknown[]; // the send-back fix-WI ACs, as the UI submitted them
  /** ADR 040: which send-back round this verdict opened (send-back records only). */
  round?: number;
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
// Review-findings persistence — the `review-findings` artifact (R4-08-F1)
//
// The adversarial-review agent's critique of the developed diff: severity-
// ranked findings with file:line evidence pointers, weighed by the OPERATOR at
// the verdict gate. Deliberately a separate artifact from verdict.json (the
// operator's decision record) — agent claims never live inside the decision,
// and every consumer of the verdict keeps its shape untouched. `headSha`
// records what was reviewed (the SHA-change guard hook for R4-08-F2's rounds).
// An empty findings array is an explicit clean pass and is still written.
// ---------------------------------------------------------------------------

export type ReviewFindingSeverity = 'blocker' | 'major' | 'minor' | 'info';

/**
 * A finding's lens. NOT a fixed vocabulary any more (spec §5 item 5): the lenses
 * a review runs are the change class's, from the class → gate-profile table's
 * `reviewLenses` column, so a docs initiative is critiqued for accuracy against
 * source and link integrity rather than for regression risk. The type is `string`
 * because this package cannot see the table — the allowed set arrives as DATA at
 * `validateReviewFindings`, which is what keeps the check honest without giving
 * `packages/flows` an opinion about the example factory's classes.
 */
export type ReviewFindingCategory = string;

export type ReviewFinding = {
  id: string; // 'RF-1'…
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  detail: string;
  /** ≥1 — every claim is pointer-backed. */
  evidence: Array<{ file: string; line?: number; excerpt?: string }>;
  /** Optional back-reference to the acceptance criterion the finding bears on. */
  acRef?: string;
};

/**
 * One acceptance criterion's verdict — the reviewer's, not the author's.
 *
 * This used to live on the demo model, authored by the same agent that composed
 * the evidence it was scoring. Spec §5 item 5 moves it here: the read-only
 * review agent, which cannot run anything and did not build the branch, is the
 * one that judges whether a criterion is met. `evidence` is prose pointing at
 * what the reviewer READ — it is a claim the operator weighs at the verdict
 * gate, never a gate by itself (ADR 021).
 */
export type AcEvaluation = {
  criterion: string;
  verdict: 'met' | 'partial' | 'missed';
  evidence: string;
};

/** The reviewer's narrative of the change (spec §5 item 5). */
export type WhyWhatHow = { why: string; what: string; how: string };

export type ReviewFindingsRecord = {
  initiative_id: string;
  cycleId: string;
  baseRef: string;
  headSha: string;
  reviewedAt: string;
  summary: string;
  findings: ReviewFinding[];
  /**
   * The lenses this review actually ran, from the initiative class's profile.
   * Recorded so a reader can tell "no finding under this lens" from "this lens
   * was never applied" — the two look identical in a findings list.
   */
  lenses: string[];
  /** One verdict per acceptance criterion — exactly the criteria the run injected. */
  acEvaluations: AcEvaluation[];
  /** The reviewer's Why / What / How of the change. */
  whyWhatHow: WhyWhatHow;
};

export function reviewFindingsJsonPath(logsRoot: string, cycleId: string): string {
  return resolve(logsRoot, cycleId, 'artifacts', 'review-findings.json');
}

const FINDING_SEVERITIES = ['blocker', 'major', 'minor', 'info'] as const;
const AC_VERDICTS = ['met', 'partial', 'missed'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function blank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim().length === 0;
}

/** Pure shape validation; errors name the offending field and the allowed vocabulary. */
/**
 * What a review record is checked AGAINST. Both fields are the run's own facts,
 * handed in rather than assumed: the lenses come from the initiative class's
 * profile, and the criteria are the ones the pipeline injected into the prompt.
 *
 * Checking AC coverage by exact set membership is the point of typed acceptance
 * criteria (ADR 051). What it replaces is a token-overlap similarity with a 0.8
 * threshold, which answered "does this look like the same sentence" when the
 * question was "is this the same criterion".
 */
export type ReviewFindingsExpectation = {
  lenses: readonly string[];
  criteria: readonly string[];
};

export function validateReviewFindings(raw: unknown, expected: ReviewFindingsExpectation): string[] {
  const errors: string[] = [];
  if (!isObj(raw)) return ['review-findings must be a JSON object'];
  for (const f of ['initiative_id', 'cycleId', 'baseRef', 'headSha', 'reviewedAt', 'summary'] as const) {
    if (blank(raw[f])) errors.push(`${f} must be a non-empty string`);
  }
  if (!Array.isArray(raw.findings)) {
    errors.push('findings must be an array ([] = an explicit clean pass)');
    return errors;
  }
  raw.findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!isObj(f)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (blank(f.id)) errors.push(`${at}.id must be a non-empty string`);
    if (!FINDING_SEVERITIES.includes(f.severity as (typeof FINDING_SEVERITIES)[number])) {
      errors.push(`${at}.severity "${String(f.severity)}" invalid — allowed: ${FINDING_SEVERITIES.join(' | ')}`);
    }
    if (!expected.lenses.includes(f.category as string)) {
      errors.push(`${at}.category "${String(f.category)}" is not a lens this class is reviewed under — allowed: ${expected.lenses.join(' | ')}`);
    }
    if (blank(f.title)) errors.push(`${at}.title must be a non-empty string`);
    if (blank(f.detail)) errors.push(`${at}.detail must be a non-empty string`);
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      errors.push(`${at}.evidence must be a non-empty array of {file, line?, excerpt?} — every claim is pointer-backed`);
    } else {
      f.evidence.forEach((e: unknown, j: number) => {
        if (!isObj(e) || blank(e.file)) errors.push(`${at}.evidence[${j}].file must be a non-empty path`);
      });
    }
  });

  // The lenses the record claims must be the ones the class actually declares —
  // a record that names its own lens set could otherwise legalise any category.
  if (!Array.isArray(raw.lenses) || raw.lenses.length === 0) {
    errors.push('lenses must be a non-empty array — the record states which lenses this class was reviewed under');
  } else if ([...raw.lenses].sort().join('|') !== [...expected.lenses].sort().join('|')) {
    errors.push(`lenses ${JSON.stringify(raw.lenses)} do not match the class's declared lenses ${JSON.stringify(expected.lenses)}`);
  }

  if (!isObj(raw.whyWhatHow)) {
    errors.push('whyWhatHow must be an object with non-empty why / what / how');
  } else {
    for (const f of ['why', 'what', 'how'] as const) {
      if (blank((raw.whyWhatHow as Record<string, unknown>)[f])) errors.push(`whyWhatHow.${f} must be a non-empty string`);
    }
  }

  // EXACT set membership, both directions. A missing criterion is an unjudged
  // one; an extra criterion is a judgment about something nobody asked for, and
  // both used to be invisible behind a similarity threshold.
  if (!Array.isArray(raw.acEvaluations)) {
    errors.push('acEvaluations must be an array — one verdict per injected acceptance criterion');
  } else {
    raw.acEvaluations.forEach((e: unknown, i: number) => {
      const at = `acEvaluations[${i}]`;
      if (!isObj(e)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (blank(e.criterion)) errors.push(`${at}.criterion must be a non-empty string`);
      if (!AC_VERDICTS.includes(e.verdict as (typeof AC_VERDICTS)[number])) {
        errors.push(`${at}.verdict "${String(e.verdict)}" invalid — allowed: ${AC_VERDICTS.join(' | ')}`);
      }
      if (blank(e.evidence)) errors.push(`${at}.evidence must be a non-empty string — a verdict with no evidence is an assertion`);
    });
    const judged = new Set((raw.acEvaluations as Array<Record<string, unknown>>).map((e) => String(e?.criterion ?? '')));
    for (const c of expected.criteria) {
      if (!judged.has(c)) errors.push(`acceptance criterion left unjudged (verbatim): ${c}`);
    }
    for (const c of judged) {
      if (c !== '' && !expected.criteria.includes(c)) errors.push(`acEvaluations judges a criterion this initiative never declared: ${c}`);
    }
  }
  return errors;
}

/**
 * Persist the review-findings artifact. Always overwrites: agent judgment
 * output where the latest pass for the cycle wins (unlike the verdict, an
 * operator decision that is never clobbered). Returns the path written, or
 * null on an IO error — best-effort durable record, never breaks the cycle.
 */
export function writeReviewFindingsJson(logsRoot: string, record: ReviewFindingsRecord): string | null {
  const p = reviewFindingsJsonPath(logsRoot, record.cycleId);
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
