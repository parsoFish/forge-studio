/**
 * Stage C — planned-initiative listing for the forge-develop kickoff surface.
 *
 * The architect flow decomposes an initiative into work items and parks the
 * manifest in `_queue/pending/`. The develop flow's kickoff surface
 * (`kickoff: { kind: initiative-select }`) lists those planned initiatives so
 * the operator can launch one into a develop run. Each is annotated `ready`
 * (dependencies satisfied) or `blockedBy` (prerequisite initiative ids not yet
 * in `done/`), reusing the scheduler's `checkInitiativeDeps` so the UI shows
 * exactly what the scheduler would actually claim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseManifest } from './manifest.ts';
import { isRunnableSource } from '@forge/contracts';
import { getPaths, listPending, listReadyForReview } from './queue.ts';
import { checkInitiativeDeps } from './scheduler.ts';

export type PlannedInitiative = {
  initiativeId: string;
  project: string | null;
  /** Human label — the manifest's first `# ` heading, else the initiative id. */
  title: string;
  /** True iff every `depends_on_initiatives` entry is already in `done/`. */
  ready: boolean;
  /** Prerequisite initiative ids not yet satisfied (empty when ready). */
  blockedBy: string[];
  /** 7.6.18 — hard contract clauses the scheduler REFUSED this claim over, as it
   *  wrote them to the manifest. This listing claims to show "exactly what the
   *  scheduler would actually claim"; it mirrored only ONE of the scheduler's two
   *  refusals, so a contract-blocked initiative read as ready. */
  blockedClauses: string[];
};

/** List the decomposed, not-yet-running initiatives in `_queue/pending/`. */
/** 7.6.18 — the failing hard-clause NAMES the scheduler writes when it REFUSES its
 *  own claim. RAW frontmatter: `parseManifest` models only architect-written keys.
 *  Exported so there is exactly ONE reader; two formulas for one fact is the drift
 *  this bead is about. */
export function manifestBlockedClauses(rawFrontmatter: string): string[] {
  return (rawFrontmatter.match(/^claim_blocked_clauses:\s*(.+)$/m)?.[1] ?? '')
    .split(',').map((c) => c.trim()).filter((c) => c !== '');
}

/**
 * 7.6.132: the hand-off manifests are listed TOO, not only `_queue/pending/`.
 *
 * This is the forge-develop kickoff surface (`/api/runs/planned`). It listed
 * `pending` alone, while `enqueueFlowRun` has always ALSO claimed a
 * `ready-for-review` manifest whose `flow_id` differs from the target — its own
 * comment names "forge-architect finalised with no review node" as exactly that
 * case. So this surface could not offer what the server would accept, and S10
 * run 19 walked into it.
 *
 * `targetFlowId` is REQUIRED rather than defaulted: which flow you are sourcing
 * FOR is half the rule (`ready-for-review` of the SAME flow is a parked sibling
 * and must not be offered), and a default would silently answer that question
 * for a caller who never considered it.
 */
export function listPlannedInitiatives(queueRoot = '_queue', targetFlowId: string): PlannedInitiative[] {
  const paths = getPaths(queueRoot);
  const out: PlannedInitiative[] = [];
  const sources: { dir: string; state: 'pending' | 'ready-for-review'; names: string[] }[] = [
    { dir: paths.pending, state: 'pending', names: listPending(paths) },
    { dir: paths.readyForReview, state: 'ready-for-review', names: listReadyForReview(paths) },
  ];
  for (const { dir, state, names } of sources) {
  for (const filename of names) {
    const manifestPath = join(dir, filename);
    let initiativeId = filename.replace(/\.md$/, '');
    let project: string | null = null;
    let title = initiativeId;
    let rawFrontmatter = '';
    try {
      const raw = readFileSync(manifestPath, 'utf8');
      rawFrontmatter = raw;
      const m = parseManifest(raw);
      initiativeId = m.initiative_id || initiativeId;
      project = m.project ?? null;
      const heading = raw.match(/^#\s+(.+)$/m);
      title = heading?.[1]?.trim() || initiativeId;
    } catch {
      /* malformed manifest still surfaces (with filename-derived defaults) */
    }
    // THE ONE PREDICATE, beside the server's own rule. A parked manifest is
    // offered only when `enqueueFlowRun` would actually claim it.
    const flowId = rawFrontmatter.match(/^flow_id:\s*(.+)$/m)?.[1]?.trim() ?? null;
    if (!isRunnableSource(state, flowId, targetFlowId)) continue;
    const blockedBy = checkInitiativeDeps(filename, paths);
    const blockedClauses = manifestBlockedClauses(rawFrontmatter);
    out.push({ initiativeId, project, title, ready: blockedBy.length === 0 && blockedClauses.length === 0, blockedBy, blockedClauses });
  }
  }
  return out;
}
