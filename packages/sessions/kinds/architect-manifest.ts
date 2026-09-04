/**
 * Manifest construction for the architect kind — `buildManifest`, `slugify`
 * and the flow id they stamp.
 *
 * Split out of `kinds/architect.ts` (M4 exit row 5, ruling 96), and it is the
 * reason that split is three-way rather than two. `runDraftStep` builds a
 * manifest and `runFinalizeStep` calls `runDraftStep`; any seam drawn between
 * draft and finalize cuts a cycle rather than a dependency. This module is the
 * leaf both of them stand on, so the cycle dissolves instead of moving.
 *
 * It depends on `architect-session.ts` alone.
 */

import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';
import { type ArchitectStatus, type DraftInitiative } from './architect-session.ts';


// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

/** The seed flow an architect handoff runs under (S8/DEC-3 — architect → pm
 *  decompose). The develop build is enqueued separately onto forge-develop. */
const ARCHITECT_FLOW_ID = 'forge-architect';

export function buildManifest(
  d: DraftInitiative,
  status: ArchitectStatus,
  datePart: string,
  created_at: string,
  knownSlugs?: Set<string>,
): InitiativeManifest {
  // W7-C3 deref guard — same rationale as the knownSlugs site above.
  const slug = slugify(d.slug || d.title || '');
  // Resolve cross-initiative `depends_on` slug refs → full initiative_ids.
  // Drop self-refs and refs to slugs not in this draft (would block forever).
  const dependsOnInitiatives = Array.from(
    new Set(
      (d.depends_on ?? [])
        .map((s) => slugify(s))
        .filter((dep) => dep && dep !== slug && (knownSlugs ? knownSlugs.has(dep) : true))
        .map((dep) => `INIT-${datePart}-${dep}`),
    ),
  );
  // W7-FIX-A4 (W7A4-01): the human title the architect skill emits IS the
  // manifest's frontmatter `title:` — `initiativeTitle()` (manifest.ts) is
  // the ONE display derivation and this is its producer; without it every
  // architect-originated initiative rendered as its raw INIT id. A blank
  // draft title is absent (never `title: "  "`); the fallback chain applies.
  // `DraftInitiative` is the shape the skill is ASKED for, not one the runner
  // enforces (`runStructured` casts raw model output), so a missing/non-string
  // title degrades to the fallback chain rather than throwing out of drafting.
  const title = (typeof d.title === 'string' ? d.title : '').trim();
  return {
    initiative_id: `INIT-${datePart}-${slug}`,
    ...(title ? { title } : {}),
    project: status.project,
    project_repo_path: status.project_repo_path,
    created_at,
    iteration_budget: d.iteration_budget > 0 ? Math.round(d.iteration_budget) : 5,
    cost_budget_usd: d.cost_budget_usd > 0 ? d.cost_budget_usd : 5,
    phase: 'pending',
    origin: 'architect',
    // S8/DEC-3: route the architect's handoff to the forge-architect flow
    // (architect → pm decompose). forge-cycle was retired, so a manifest with no
    // flow_id would now throw in runCycle. After the operator approves the PLAN
    // and presses start-development, enqueue-develop-run repoints this to
    // forge-develop for the build (DEC-2 keeps the threaded cycle_id).
    flow_id: ARCHITECT_FLOW_ID,
    body: d.body,
    ...(dependsOnInitiatives.length > 0 ? { depends_on_initiatives: dependsOnInitiatives } : {}),
  };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'initiative'
  );
}
