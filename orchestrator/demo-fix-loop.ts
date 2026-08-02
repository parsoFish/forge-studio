/**
 * Demo-fix loop compiler (R4-10-F1, ADR-040) — the demo-agent's AC-miss
 * judgment compiled into the shared post-develop fix loop.
 *
 * When the demo pipeline returns `complete-with-misses` it has persisted a
 * `demo-fix-spec.json` (`DemoFixProposal[]`, one per non-`met` acceptance
 * criterion). This module maps each proposal onto the SAME machinery the review
 * send-back uses (`fix-work-items.ts` → `.forge/work-items/` with
 * `origin: 'demo-fix'`), stamps the manifest send-back so the fix-loop drain
 * (`drain-fix-loop.ts`) re-enters `resume_from: 'develop'` — dev builds the fix
 * WIs, the demo node re-authors demo.json + the PR description — and shares the
 * single round/total cap with review-fix (`resolveReviewLoopCaps`; the round
 * counter is manifest `review_rounds`, the total is `fixWorkItemCount` over ALL
 * origins). One executor, one shared cap, for every post-develop fix loop.
 *
 * Cap exhaustion is reject-then-park, identical to the verdict handler: NO work
 * items are written and NO send-back is stamped (accepting would enqueue work
 * that never runs), a greppable `REVIEW-CAP-EXHAUSTED.md` marker is dropped
 * (the drain skips marker-bearing manifests), and the caller surfaces it.
 *
 * The cycle owns its in-flight manifest for the duration of a run, so — unlike
 * the bridge verdict handler racing concurrent cycles — this takes no
 * proper-lockfile lock; the read-modify-write helpers it calls
 * (`persistManifestSendBack` / `persistManifestSpecs`) are the only writers.
 */

import { existsSync, readFileSync } from 'node:fs';

import { parseManifest, persistManifestSendBack, persistManifestSpecs } from './manifest.ts';
import { loadConfig, resolveReviewLoopCaps } from './config.ts';
import { notify } from './notify.ts';
import { validateDemoFixSpec, type DemoFixProposal, type DemoFixSpecRecord } from './flow-artifacts.ts';
import {
  compileFixWorkItems,
  fixWorkItemCount,
  writeReviewCapExhaustedMarker,
  DEFAULT_FIX_WI_ITERATIONS,
  FixLoopCapError,
  FixConcernInvalidError,
  type FixConcernSource,
} from './fix-work-items.ts';

export type DemoFixEnqueueResult =
  /** Fix WIs compiled onto the queue + the manifest send-back stamped. */
  | { status: 'compiled'; appended: string[]; round: number }
  /** A shared cap is exhausted — marker written, nothing enqueued, needs-operator. */
  | { status: 'cap-parked'; detail: string }
  /** The demo-fix-spec is missing or invalid — nothing enqueued (loud caller event). */
  | { status: 'spec-unreadable'; detail: string };

export type EnqueueDemoFixInput = {
  worktreePath: string;
  manifestPath: string;
  initiativeId: string;
  /** Absolute path to the pipeline-persisted demo-fix-spec.json (result.fixSpecPath). */
  fixSpecPath: string;
  /** The cycle's effective project quality gate (CycleInput.qualityGateCmd). */
  projectGateCmd: string[];
};

/**
 * Map ONE `DemoFixProposal` onto a `FixConcernSource`. A demo miss is a real
 * behavioural gap, so it compiles as `code-fix` (full dev-loop rigor — a
 * failing test first). The proposal's own `files_in_scope` becomes the WI
 * scope; the criterion + evidence + rationale become the WI's rationale so the
 * develop agent sees exactly WHY the demo couldn't show it.
 */
/**
 * Mirror the WorkItem `files_in_scope` path-safety rule (work-item.ts:314-317):
 * worktree-relative, no leading `/`, no `..` segment. `validateDemoFixSpec` only
 * checks each entry is a non-blank string, so an untrusted (or prompt-injected)
 * demo agent could author an out-of-tree scope that `writeWorkItem`'s validator
 * would later reject with a plain throw — AFTER earlier proposals in the batch
 * were already written. We pre-reject the whole batch here so nothing is written.
 */
function unsafeScopePaths(proposals: DemoFixProposal[]): string[] {
  const bad: string[] = [];
  for (const p of proposals) {
    for (const f of p.files_in_scope ?? []) {
      if (typeof f !== 'string' || f.startsWith('/') || f.split('/').includes('..')) {
        bad.push(String(f));
      }
    }
  }
  return bad;
}

/** Fire the operator notification for a demo-fix cap park — mirrors the verdict
 *  handler so the drain's "already notified at rejection time" assumption holds
 *  for the demo-fix origin too (best-effort; never throws). */
function notifyCapPark(initiativeId: string, detail: string): void {
  try {
    const uc = loadConfig();
    void notify(
      { type: 'failed', title: `${initiativeId} — demo-fix cap exhausted`, body: detail },
      { desktop: uc.notify?.desktop ?? true, webhook_url: uc.notify?.webhook_url ?? null },
    ).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

export function demoFixProposalToConcern(p: DemoFixProposal): FixConcernSource {
  return {
    origin: 'demo-fix',
    concernKind: 'code-fix',
    rationale: [
      p.title.trim(),
      '',
      p.rationale.trim(),
      '',
      `The demo judged this criterion "${p.verdict}" — it could not show it passing: ${p.evidence.trim()}`,
    ].join('\n'),
    acceptanceCriteria: p.acceptance_criteria,
    filesInScope: p.files_in_scope,
  };
}

/**
 * Read the persisted demo-fix-spec, compile every proposal into a `demo-fix`
 * work item, and stamp the manifest send-back so the drain re-enters. Enforces
 * the shared caps up front (reject-then-park) so a partial write can never
 * strand the queue. Pure of observability — the caller emits events off the
 * returned status.
 */
export function enqueueDemoFixWorkItems(input: EnqueueDemoFixInput): DemoFixEnqueueResult {
  const { worktreePath, manifestPath, initiativeId, fixSpecPath, projectGateCmd } = input;

  if (!existsSync(fixSpecPath)) {
    return { status: 'spec-unreadable', detail: `demo-fix-spec.json not found at ${fixSpecPath}` };
  }
  let record: DemoFixSpecRecord;
  try {
    record = JSON.parse(readFileSync(fixSpecPath, 'utf8')) as DemoFixSpecRecord;
  } catch (err) {
    return { status: 'spec-unreadable', detail: `demo-fix-spec.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const shapeErrors = validateDemoFixSpec(record);
  if (shapeErrors.length > 0) {
    return { status: 'spec-unreadable', detail: `demo-fix-spec.json failed validation: ${shapeErrors.join('; ')}` };
  }
  const proposals = record.proposals;

  // Path-safety pre-check (BEFORE any write) — an unsafe files_in_scope would
  // otherwise pass validateDemoFixSpec, get compiled into earlier WIs, then
  // throw inside writeWorkItem for a later proposal, stranding a partial batch.
  const unsafe = unsafeScopePaths(proposals);
  if (unsafe.length > 0) {
    return {
      status: 'spec-unreadable',
      detail: `demo-fix proposal has out-of-tree files_in_scope (worktree-relative, no leading '/' or '..'): ${unsafe.join(', ')}`,
    };
  }

  // Shared caps: the round counter is manifest `review_rounds` (shared with
  // review-fix), the total is `fixWorkItemCount` over EVERY origin. Pre-check
  // BOTH before writing anything — a partial write with no send-back stamp
  // would strand undrainable WIs.
  const caps = resolveReviewLoopCaps();
  let currentRound = 1;
  try {
    currentRound = (parseManifest(readFileSync(manifestPath, 'utf8')).review_rounds ?? 0) + 1;
  } catch {
    /* a missing/unreadable manifest falls back to round 1 — the compile below still cap-checks */
  }
  const existingFixCount = fixWorkItemCount(worktreePath);
  const park = (detail: string): DemoFixEnqueueResult => {
    // Reject-then-park, LOUDLY — the greppable marker (the drain reports
    // needs-operator while it exists) AND an operator notification, mirroring
    // the verdict handler so the drain's "already notified at rejection time"
    // assumption holds for the demo-fix origin too (finding: silent park).
    writeReviewCapExhaustedMarker(worktreePath, detail);
    notifyCapPark(initiativeId, detail);
    return { status: 'cap-parked', detail };
  };
  if (currentRound > caps.maxSendBackRounds) {
    return park(`demo-fix send-back round cap reached (round ${currentRound} > ${caps.maxSendBackRounds})`);
  }
  if (existingFixCount + proposals.length > caps.maxTotalFixWorkItems) {
    return park(
      `demo-fix total fix work-item cap reached (${existingFixCount} existing + ${proposals.length} demo misses > ${caps.maxTotalFixWorkItems})`,
    );
  }

  const appended: string[] = [];
  try {
    for (const proposal of proposals) {
      const { appended: ids } = compileFixWorkItems({
        worktreePath,
        initiativeId,
        source: demoFixProposalToConcern(proposal),
        projectGateCmd,
        estimatedIterations: DEFAULT_FIX_WI_ITERATIONS,
        caps,
        currentRound,
      });
      appended.push(...ids);
    }
  } catch (err) {
    // A cap slipping through the pre-check (a concurrent write), or a malformed
    // concern that the pre-checks missed, still parks rather than half-enqueuing
    // — mirror the verdict handler's reject-then-park (never let a mid-batch
    // throw strand a partial write undrainable).
    if (err instanceof FixLoopCapError || err instanceof FixConcernInvalidError) {
      return park(err.message);
    }
    throw err;
  }

  // Keep the manifest's specs back-reference truthful (append, never overwrite),
  // then stamp resume_from:'develop' + increment the shared round counter.
  try {
    const specs = parseManifest(readFileSync(manifestPath, 'utf8')).specs ?? [];
    persistManifestSpecs(manifestPath, [...specs, ...appended]);
  } catch {
    /* best-effort — the fix WIs are already compiled */
  }
  const { round } = persistManifestSendBack(manifestPath);
  return { status: 'compiled', appended, round };
}
