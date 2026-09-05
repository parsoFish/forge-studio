/**
 * Gate-fix loop compiler (R4-10-F2, ADR-036 amendment / ADR-040) — the
 * merge-boundary full-suite gate's unattended remediation.
 *
 * When `runMergeBoundaryGate` (cycle-helpers.ts) finds a red full-suite baseline
 * on the integrated branch — a cross-WI regression the scoped per-WI gates
 * cannot see — the develop flow must NOT open a PR (the preserved invariant: no
 * path to merge exists with a red full-suite baseline). Instead this compiles a
 * single `gate-fix` work item onto the initiative's own `.forge/work-items/`
 * queue and stamps the manifest send-back, so the fix-loop drain re-enters
 * `resume_from:'develop'` — the develop agent rebuilds the fix against the whole
 * suite (its gate IS the full suite), the merge-boundary gate re-runs, and only
 * a green baseline reaches the PR. One executor (the develop agent), one shared
 * round/total cap with review-fix + demo-fix (`resolveReviewLoopCaps` /
 * `fixWorkItemCount` over every origin). Cap exhaustion is reject-then-park,
 * loudly (marker + notify), identical to the other two fix origins.
 *
 * The failure detail flows to the fix agent through `.forge/last-gate-failure.md`
 * (the ADR-036 §2 results-flow seam, written by the gate itself) — this module
 * embeds it verbatim into the WI rationale so the agent sees exactly what failed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseManifest, persistManifestSendBack, persistManifestSpecs } from './manifest.ts';
import { loadConfig, resolveReviewLoopCaps } from '@forge/kernel';
import { notify } from './notify.ts';
import {
  compileFixWorkItems,
  fixWorkItemCount,
  writeReviewCapExhaustedMarker,
  DEFAULT_FIX_WI_ITERATIONS,
  FixLoopCapError,
  FixConcernInvalidError,
  type FixConcernSource,
} from './fix-work-items.ts';

export type GateFixEnqueueResult =
  | { status: 'compiled'; appended: string[]; round: number }
  | { status: 'cap-parked'; detail: string };

export type EnqueueGateFixInput = {
  worktreePath: string;
  manifestPath: string;
  initiativeId: string;
  /** Which sub-gate went red — surfaced in the WI rationale. */
  failedGate: 'local' | 'ci' | 'docs';
  /** The cycle's effective project full-suite command (CycleInput.qualityGateCmd). */
  projectGateCmd: string[];
};

/** Mirror of the `.forge/last-gate-failure.md` path the gate writes (cycle-helpers.ts). */
function lastGateFailurePath(worktreePath: string): string {
  return join(worktreePath, '.forge', 'last-gate-failure.md');
}

/** Fire the operator notification for a gate-fix cap park (best-effort; never throws). */
function notifyCapPark(initiativeId: string, detail: string): void {
  try {
    const uc = loadConfig();
    void notify(
      { type: 'failed', title: `${initiativeId} — merge-gate fix cap exhausted`, body: detail },
      { desktop: uc.notify?.desktop ?? true, webhook_url: uc.notify?.webhook_url ?? null },
    ).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

/**
 * Build the `gate-fix` concern. No `filesInScope` — a cross-WI regression can be
 * anywhere the initiative touched, so `compileFixWorkItems` scopes it to the
 * union of every dev-WI's `files_in_scope`. No sharp `qualityGateCmd` — the
 * project gate (the full suite) IS the gate the fix must turn green.
 */
function gateFixConcern(failedGate: 'local' | 'ci' | 'docs', failureDetail: string): FixConcernSource {
  return {
    origin: 'gate-fix',
    concernKind: 'code-fix',
    rationale: [
      `The merge-boundary full-suite gate (${failedGate}) is RED on the integrated branch tip —`,
      'a cross-WI regression the scoped per-WI gates could not see. Make the WHOLE suite green;',
      'the branch is not review-ready until it passes. The authoritative failure follows verbatim',
      '(also in `.forge/last-gate-failure.md`):',
      '',
      failureDetail.trim(),
    ].join('\n'),
    acceptanceCriteria: [
      {
        given: 'the initiative branch is integrated at tip',
        when: 'the full project test suite runs (the merge-boundary gate)',
        then: 'it passes green — no cross-WI regression remains',
      },
    ],
  };
}

/**
 * Compile ONE `gate-fix` work item from the red merge-boundary gate + stamp the
 * manifest send-back. Enforces the shared caps up front (reject-then-park).
 * Pure of observability — the caller emits events off the returned status.
 */
export function enqueueGateFixWorkItems(input: EnqueueGateFixInput): GateFixEnqueueResult {
  const { worktreePath, manifestPath, initiativeId, failedGate, projectGateCmd } = input;

  // The failure detail the gate wrote — embedded verbatim so the fix agent sees
  // exactly what to fix. Absent ⇒ a terse fallback (the agent still re-runs the gate).
  let failureDetail = `The full-suite ${failedGate} gate failed (see \`.forge/last-gate-failure.md\`).`;
  const fp = lastGateFailurePath(worktreePath);
  if (existsSync(fp)) {
    try {
      failureDetail = readFileSync(fp, 'utf8');
    } catch {
      /* keep the fallback */
    }
  }

  const caps = resolveReviewLoopCaps();
  let currentRound = 1;
  try {
    currentRound = (parseManifest(readFileSync(manifestPath, 'utf8')).review_rounds ?? 0) + 1;
  } catch {
    /* a missing/unreadable manifest falls back to round 1 — the compile still cap-checks */
  }
  const existingFixCount = fixWorkItemCount(worktreePath);
  const park = (detail: string): GateFixEnqueueResult => {
    writeReviewCapExhaustedMarker(worktreePath, detail);
    notifyCapPark(initiativeId, detail);
    return { status: 'cap-parked', detail };
  };
  if (currentRound > caps.maxSendBackRounds) {
    return park(`gate-fix send-back round cap reached (round ${currentRound} > ${caps.maxSendBackRounds})`);
  }
  if (existingFixCount + 1 > caps.maxTotalFixWorkItems) {
    return park(`gate-fix total fix work-item cap reached (${existingFixCount} existing + 1 > ${caps.maxTotalFixWorkItems})`);
  }

  let appended: string[];
  try {
    ({ appended } = compileFixWorkItems({
      worktreePath,
      initiativeId,
      source: gateFixConcern(failedGate, failureDetail),
      projectGateCmd,
      estimatedIterations: DEFAULT_FIX_WI_ITERATIONS,
      caps,
      currentRound,
    }));
  } catch (err) {
    if (err instanceof FixLoopCapError || err instanceof FixConcernInvalidError) {
      return park(err.message);
    }
    throw err;
  }

  try {
    const specs = parseManifest(readFileSync(manifestPath, 'utf8')).specs ?? [];
    persistManifestSpecs(manifestPath, [...specs, ...appended]);
  } catch {
    /* best-effort — the fix WI is already compiled */
  }
  const { round } = persistManifestSendBack(manifestPath);
  return { status: 'compiled', appended, round };
}
