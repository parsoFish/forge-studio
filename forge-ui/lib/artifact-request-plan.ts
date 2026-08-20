/**
 * W7-B7 (bd forge-2w4 class / walkthrough baseline burn-down) — the /artifact
 * page's request planner: WHICH optional artifact files to fetch, decided
 * from the run model's own `artifactsReady` (status-before-body) instead of
 * probing every candidate file blind and swallowing the 404s.
 *
 * The defect class this closes: every artifact page fired a fan of
 * guaranteed-404 GETs — verdict.json on all six types, plan.json + PLAN.md on
 * every plan page (neither is ever produced; see the plan-source decision
 * below), pr-description.md / reflection.json / per-WI specs on runs whose
 * own model already said the artifact does not exist. The bridge's
 * `GET /api/runs/<id>` response IS the disk truth (deriveArtifacts stats the
 * files) — asking again per-file is a blind body-read.
 *
 * PLAN-SOURCE DECISION (artifact-plan-19, documented here + PR): plan.json
 * was never produced by anything (0 files across every cycle log; nothing in
 * orchestrator/ or cli/ writes one) and PLAN.md is never snapshotted into
 * artifacts/ — the ONLY plan artifact a cycle carries is the rendered
 * PLAN.html. The structured-plan branch (PlanRenderer + the
 * "resolve design decisions before approving" gate) was a dead path on 100%
 * of runs, so it is DELETED rather than back-filled: the smaller correct
 * change, since the plan's interactive review moment lives on the architect
 * session gate (ArchitectPlanGate, W7-A3), not on cycle artifacts — a cycle
 * plan is always view-only (deriveArtifacts pins plan:'view').
 *
 * Fallback: when the run is UNKNOWN to the bridge (`run === null` — an
 * orphan `_logs/<id>/` whose queue record is gone), there is no declared
 * state to trust, so the type's own primary file is probed directly —
 * exactly the pre-existing behaviour, now confined to the case that needs it.
 */
import type { Run } from './studio-client';
import type { ArtifactType } from './artifact-mode';

export type ArtifactRequestPlan = {
  /** Fetch artifacts/PLAN.html (the only plan artifact a cycle carries). */
  probePlanHtml: boolean;
  /** Fetch artifacts/demo.json (the structured demo model). */
  probeDemoJson: boolean;
  /** Fetch artifacts/pr-description.md. */
  probePrDescription: boolean;
  /** Fetch artifacts/verdict.json (the recorded verdict — doc or view stamp). */
  probeVerdictJson: boolean;
  /** Fetch artifacts/reflection.json (the reflector's summary). */
  probeReflectionJson: boolean;
  /** Fetch artifacts/DEMO.md for the view-mode narrative (artifact-plan-32). */
  probeDemoMarkdown: boolean;
  /** Per-WI spec fetches (`/api/work-item/<cycle>/<wi>`). */
  workItemIds: string[];
};

const NONE: ArtifactRequestPlan = {
  probePlanHtml: false,
  probeDemoJson: false,
  probePrDescription: false,
  probeVerdictJson: false,
  probeReflectionJson: false,
  probeDemoMarkdown: false,
  workItemIds: [],
};

export function planArtifactRequests(
  type: ArtifactType,
  run: Run | null,
  mode: 'gate' | 'view',
): ArtifactRequestPlan {
  // Unknown run — no declared state; probe the type's own primary directly.
  if (run === null) {
    return {
      ...NONE,
      probePlanHtml: type === 'plan',
      probeDemoJson: type === 'demo' || type === 'pr' || (type === 'verdict' && mode === 'gate'),
      probePrDescription: type === 'pr',
      // The verdict doc for type=verdict, or the view-mode stamp for others.
      probeVerdictJson: type === 'verdict' || mode === 'view',
      probeReflectionJson: type === 'reflection',
      probeDemoMarkdown: type === 'demo' && mode === 'view',
    };
  }

  const ready = (key: keyof Run['artifactsReady']): boolean => Boolean(run.artifactsReady[key]);

  return {
    probePlanHtml: type === 'plan' && ready('plan'),
    probeDemoJson:
      (type === 'demo' || type === 'pr' || (type === 'verdict' && mode === 'gate')) && ready('demo'),
    probePrDescription: type === 'pr' && ready('pr'),
    // View mode only: type=verdict renders the recorded verdict doc; every
    // other type shows the stamp strip. Gate mode AUTHORS a verdict — the
    // prior round's doc is not fetched there.
    probeVerdictJson: mode === 'view' && ready('verdict'),
    probeReflectionJson: type === 'reflection' && ready('reflection'),
    probeDemoMarkdown: type === 'demo' && mode === 'view' && ready('demo'),
    workItemIds:
      type === 'workitems' && ready('work-items') ? (run.workItems ?? []).map((w) => w.id) : [],
  };
}
