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
