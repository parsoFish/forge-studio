/**
 * verify-outcomes — pure outcome-check assembly for `scripts/verify-cycle.mjs`.
 *
 * Why this exists: `verify-cycle.mjs` calls `main()` at module scope, so
 * nothing in it can be imported by a test (`scripts/lib/post-run-boundary.mjs`
 * + `scripts/post-run-boundary.test.ts` is the established precedent for
 * extracting exactly this — a pure `.mjs` helper under `scripts/lib/` that a
 * TypeScript test imports directly).
 *
 * `DEFAULT_PROJECT` fixes a real defect: `verify-cycle.mjs` used to default
 * `--project` to `mdtoc`, a project committed inside forge's own repo — a
 * harness run against it writes into the repo under test. `mdtoc` must never
 * be the harness ground (docs/roadmaps/1.0.md §0 global constraint); the
 * default ground is `gitpulse`, an independent repo.
 *
 * `buildOutcomeChecks` is the ADR 022 + S9 outcome-check list, moved verbatim
 * out of `verify-cycle.mjs`'s `assessOutcomes` (same row names, same order,
 * same detail wording) with one behavioural change: the `'project tests
 * green post-merge'` row used to pass on `tests.ok` alone, independent of
 * whether the cycle ever reached merge — so a cycle that never merged could
 * still score a green post-merge row by running the project's tests on an
 * unmerged tree. Now, when the `'cycle reached merge (done)'` row does not
 * pass, the post-merge test row is `{ pass: false, skipped: true, detail }`
 * instead of being judged on `tests.ok` — a skipped row is never a pass.
 *
 * The module is pure: every input arrives as a parameter. No `node:fs`, no
 * `node:child_process`, no `process.cwd()`, no import from `verify-cycle.mjs`
 * — all the impure work (reading the event log, running the project's test
 * suite, checking `_queue/done/`, probing the merged `demo.json`, reading
 * `.forge/project.json`) stays in `verify-cycle.mjs`'s `assessOutcomes`,
 * which hands this module the resulting values.
 */

/** The harness's default verify ground — an independent repo, never `mdtoc`
 *  (which is committed inside forge's own repo). */
export const DEFAULT_PROJECT = 'gitpulse';

/**
 * @typedef {{ name: string, pass: boolean, detail: string, skipped?: boolean }} OutcomeCheck
 */

/**
 * Build the ADR 022 + S9 outcome-check list: outcome-only assertions (merge /
 * dev-loop / tests / cost / reflect-writes-brain), plus an optional
 * live-evidence check for live-resource projects and an optional
 * release-evidence check when the project declares `releaseProcess`.
 *
 * @param {object} params
 * @param {string} params.finalStatus the cycle's terminal status from the bridge
 * @param {boolean} params.manifestInDone whether the initiative's manifest landed
 *   in `_queue/done/` — the authoritative merge signal once the bridge's
 *   post-merge status read goes unreliable
 * @param {{ total: number, complete: number, failed: number }} params.wi
 *   work-item completion counts from the event log
 * @param {{ ran: boolean, ok: boolean, label: string }} params.tests the
 *   project's own test-suite outcome
 * @param {number} params.cost this initiative's total spend in USD
 * @param {number} params.costCeiling the run's cost ceiling in USD
 * @param {{ present: boolean, reason: string }} params.reflectTheme whether the
 *   reflector wrote/updated a central project-brain theme this run
 * @param {{ present: boolean, reason: string }} [params.liveEvidence] optional —
 *   absent means the row is not added (not a live-resource project run)
 * @param {{ present: boolean, reason: string }} [params.releaseEvidence] optional
 *   — absent means the row is not added (project has no `releaseProcess`)
 * @returns {OutcomeCheck[]}
 */
export function buildOutcomeChecks({
  finalStatus, manifestInDone, wi, tests, cost, costCeiling,
  reflectTheme, liveEvidence, releaseEvidence,
}) {
  const mergeCheck = {
    name: 'cycle reached merge (done)',
    pass: finalStatus === 'done' || manifestInDone,
    detail: finalStatus === 'done'
      ? 'finalStatus=done'
      : (manifestInDone
        ? 'manifest in _queue/done/ (merged; bridge status unread post-merge)'
        : `finalStatus=${finalStatus}, manifest not in done/`),
  };

  const postMergeTestsCheck = mergeCheck.pass
    ? {
      name: 'project tests green post-merge',
      pass: tests.ok,
      detail: tests.ran ? (tests.ok ? `${tests.label} passed` : `${tests.label} FAILED`) : 'no test command — skipped',
    }
    : {
      name: 'project tests green post-merge',
      pass: false,
      skipped: true,
      detail: 'skipped: the cycle did not reach merge — see "cycle reached merge (done)"',
    };

  const checks = [
    mergeCheck,
    { name: 'dev-loop completed N/N work items', pass: wi.total > 0 && wi.complete === wi.total && wi.failed === 0, detail: `${wi.complete}/${wi.total} complete, ${wi.failed} failed` },
    postMergeTestsCheck,
    { name: `cost under ceiling ($${costCeiling})`, pass: cost <= costCeiling, detail: `$${cost.toFixed(2)} / $${costCeiling}` },
  ];
  // S9: the reflect stage (3rd spine flow) must write the central project brain.
  checks.push({ name: 'reflect wrote central project brain', pass: reflectTheme.present, detail: reflectTheme.reason });
  // Live-resource projects: assert the demo carries real REST evidence, so a
  // green-unit-gate-but-no-live-proof cycle fails the gate (demos-are-visual-evidence).
  if (liveEvidence !== undefined) {
    checks.push({ name: 'live demo evidence present (REST GET)', pass: liveEvidence.present, detail: liveEvidence.reason });
  }
  // WS-A: release-bearing projects must prove the full release loop fired
  // (draft → finalised changelog committed → release.json record). Gated on
  // the project actually declaring `releaseProcess` — a non-release project is
  // unaffected (the check is not added).
  if (releaseEvidence !== undefined) {
    checks.push({ name: 'release finalised (changelog + release.json)', pass: releaseEvidence.present, detail: releaseEvidence.reason });
  }
  return checks;
}
