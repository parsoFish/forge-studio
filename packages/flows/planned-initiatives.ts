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
import { getPaths, listPending } from './queue.ts';
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
export function listPlannedInitiatives(queueRoot = '_queue'): PlannedInitiative[] {
  const paths = getPaths(queueRoot);
  const out: PlannedInitiative[] = [];
  for (const filename of listPending(paths)) {
    const manifestPath = join(paths.pending, filename);
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
    const blockedBy = checkInitiativeDeps(filename, paths);
    // RAW frontmatter: `parseManifest` drops keys it does not model, and the
    // scheduler writes this one, not the architect.
    const blockedClauses = (rawFrontmatter.match(/^claim_blocked_clauses:\s*(.+)$/m)?.[1] ?? '')
      .split(',').map((c) => c.trim()).filter((c) => c !== '');
    out.push({ initiativeId, project, title, ready: blockedBy.length === 0 && blockedClauses.length === 0, blockedBy, blockedClauses });
  }
  return out;
}
