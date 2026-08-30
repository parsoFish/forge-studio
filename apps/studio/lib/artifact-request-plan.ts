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
 * Fallback: when the run is UNKNOWN to the bridge (`run === null`), there is
 * no declared state to trust, so the type's own primary file is probed
 * directly — exactly the pre-existing behaviour, now confined to the case
 * that needs it. `run === null` covers TWO different situations that must
 * NOT share a branch (artifact-plan-41):
 *
 *   - a genuine ORPHAN — `_logs/<id>/` exists on disk but the queue record is
 *     gone (`onDisk: true`, from `GET /api/runs/<id>`'s guarded existence
 *     probe) — probe the type's own primary file, same as before;
 *   - an UNKNOWN id — nothing exists on disk for it either (`onDisk: false`)
 *     — the existence question is ALREADY answered (the run lookup call that
 *     produced `onDisk` said so); probing PLAN.html / verdict.json anyway is
 *     three guaranteed 404s fired after the answer is already known, right
 *     before the shared NotFound paints. Return NONE — nothing to probe for
 *     an id that answers 404 both to the run AND the disk check.
 *
 * artifact-plan-35: an orphan's `workItemIds` stays `[]` — there is no bridge
 * route that LISTS a cycle's `work-items-snapshot/` directory for a bare
 * cycleId (only `GET /api/work-item/<cycleId>/<wiId>`, which needs the id
 * already); enumerating it would need a new bridge route, out of scope here
 * (see the WI-5 report). The orphan's workitems tab therefore still renders
 * the honest empty state even when the snapshot dir is non-empty — the page
 * softens this with `deriveArtifactEmptyReason('orphan', …)` copy instead of
 * claiming a future phase will produce it.
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
  /**
   * Fetch artifacts/DEMO.md for the view-mode narrative (artifact-plan-32).
   *
   * artifact-plan-40 (W8-A2): unlike every other flag here, this is NOT a
   * status-before-body probe — `deriveArtifacts` (orchestrator/run-model-
   * derive.ts, fenced from this lane) tracks readiness for `demo.json` only;
   * the narrative markdown has no readiness bit of its own, so there is no
   * declared state to gate on. Gating this on `ready('demo')` LOOKED like a
   * no-guaranteed-404 probe but was not one: every cycle that has demo.json
   * without a captured narrative (common — the narrative is optional) still
   * burned the 404, because the call site only fires this fetch once
   * `demo.json` already resolved (`artifactDoc.type === 'demo'`), which
   * `ready('demo')` had already guaranteed true. Decision: stop pretending —
   * this probe is explicitly BEST-EFFORT (matches `fetchDemoMarkdown`, which
   * already treats a 404 or a thrown read as "no narrative" and degrades to
   * `''` silently, never a rendered claim); `ready('demo')` is dropped below
   * because it changed nothing but the false impression.
   */
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
  /**
   * artifact-plan-41: the bridge's OWN existence fact for this id
   * (`RunLookup.onDisk`, from `fetchRunLookup` — the guarded `_logs/<id>`
   * probe riding the SAME `GET /api/runs/<id>` call that produced `run`).
   * Only consulted when `run === null` — see the module docstring.
   */
  onDisk: boolean,
): ArtifactRequestPlan {
  if (run === null) {
    // Unknown id AND nothing on disk either — the existence question is
    // ALREADY answered (by the caller's own run lookup). Probe nothing.
    if (!onDisk) return { ...NONE };
    // A genuine orphan — on disk, no queue record. No declared state to
    // trust, so probe the type's own primary file directly (pre-existing
    // behaviour, confined to this branch).
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
    // artifact-plan-40: best-effort — see the field doc above. No `ready('demo')`
    // gate; the call site only fires this once demo.json itself resolved.
    probeDemoMarkdown: type === 'demo' && mode === 'view',
    workItemIds:
      type === 'workitems' && ready('work-items') ? (run.workItems ?? []).map((w) => w.id) : [],
  };
}
