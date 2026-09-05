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
 *
 * `classifyReflectorProgress` (M0-A round-2 defect B) and
 * `sumAuthoritativeCostFromLines` (M0-A round-2 defect C) are the one
 * declared exception to "no imports besides node builtins": the latter
 * delegates to `orchestrator/event-cost.ts`'s `sumAuthoritativeCostUsd` — the
 * single source of truth for cost summation also used by `packages/flows/metrics.ts`,
 * `orchestrator/run-model.ts` and `orchestrator/run-model-derive.ts` — rather
 * than re-implementing the restatement rule a second time. That module's own
 * import of `EventLogEntry` is `import type`, erased at load, so pulling it
 * in from plain `.mjs` stays side-effect-free; Node v22's native TS type
 * stripping loads the `.ts` file directly, no build step needed.
 */

import { sumAuthoritativeCostUsd } from '@forge/kernel';

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

/**
 * @typedef {{ state: 'none' | 'started' | 'ended' | 'lost', detail: string }} ReflectorProgress
 */

/** The literal `cycle.reflection-lost` terminal-loss event message
 *  (`orchestrator/cycle-context.ts`'s `REFLECTION_LOST_EVENT`) — not
 *  imported, since that module is not the declared cost-rule exception and
 *  this file stays pure otherwise; the value is stable (it is itself a
 *  cross-module contract other callers match on). */
const REFLECTION_LOST_MESSAGE = 'cycle.reflection-lost';

/**
 * Classify a cycle's reflection progress from its raw event-log lines
 * (M0-A round-2 defect B).
 *
 * `waitForReflectorEnd` in `verify-cycle.mjs` used to scan only for
 * `reflector.end`, so a reflector that died loudly (`cycle.reflection-lost`
 * — terminal, never followed by an end event) burned the full wait deadline
 * and then logged the neutral "not seen before deadline", which reads as
 * slow rather than dead. This lets the caller distinguish the two and stop
 * waiting the instant the outcome is known, not just when the clock runs
 * out.
 *
 * @param {readonly string[]} logLines raw JSONL lines (one JSON object each;
 *   malformed lines are skipped, matching every other line-scanner in this
 *   file / `verify-cycle.mjs`)
 * @returns {ReflectorProgress}
 *   - `'none'`   — no reflector activity observed at all
 *   - `'started'` — `reflector.start` seen, no end and no loss yet (reads as
 *     slow, not dead — the exact ambiguity this classification resolves for
 *     the caller once combined with the deadline)
 *   - `'ended'`  — `reflector.end` observed — reflection completed
 *   - `'lost'`   — `cycle.reflection-lost` observed — reflection died;
 *     `detail` names the real cause/detail carried on that event, never a
 *     generic string
 */
export function classifyReflectorProgress(logLines) {
  let sawStart = false;
  let sawEnd = false;
  let lostDetail = null;

  for (const line of logLines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.skill === 'reflector' && e.event_type === 'start') sawStart = true;
    if (e.skill === 'reflector' && e.event_type === 'end') sawEnd = true;
    if (e.message === REFLECTION_LOST_MESSAGE) {
      const cause = e.metadata?.cause ?? 'unknown';
      const causeDetail = e.metadata?.detail ?? 'no detail recorded';
      lostDetail = `${REFLECTION_LOST_MESSAGE}: ${cause} — ${causeDetail}`;
    }
  }

  if (sawEnd) return { state: 'ended', detail: 'reflector.end observed — reflection completed' };
  if (lostDetail !== null) return { state: 'lost', detail: lostDetail };
  if (sawStart) return { state: 'started', detail: 'reflector.start observed, no end or loss yet' };
  return { state: 'none', detail: 'no reflector activity observed' };
}

/**
 * Sum authoritative cost across raw event-log lines (M0-A round-2 defect C).
 *
 * Delegates to `orchestrator/event-cost.ts`'s `sumAuthoritativeCostUsd` — the
 * ONE restatement rule, applied once per event (spec §5.7) — rather than
 * naively summing every `cost_usd` field, which double/triple-counts phases
 * that emit `iteration` events (developer-loop, unifier) because those
 * phases restate the same dollars on their per-work-item and phase-level
 * `end` events. `verify-cycle.mjs`'s old `sumCycleCost` did the naive sum and
 * overstated a run's cost by roughly 2x.
 *
 * @param {readonly string[]} lines raw JSONL lines; malformed lines are
 *   skipped
 * @returns {number} authoritative total cost in USD
 */
export function sumAuthoritativeCostFromLines(lines) {
  return costBreakdownFromLines(lines).totalUsd;
}

/**
 * The same sum, plus the ARCHITECT's share of it (bead forge-8vfn.6.10.22). The
 * cycle log already carries the architect's out-of-cycle spend, so a caller that
 * also sums the session log counts it twice — half of the harness's $28.64 for a
 * run that spent $23.97. Answered from the SAME parse under the same rule, never
 * by re-reading the file with a second set of eyes.
 *
 * @param {readonly string[]} lines raw JSONL lines; malformed lines are skipped
 * @returns {{ totalUsd: number, architectUsd: number }}
 */
export function costBreakdownFromLines(lines) {
  const events = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }
  return {
    totalUsd: sumAuthoritativeCostUsd(events),
    architectUsd: sumAuthoritativeCostUsd(events.filter((e) => e.phase === 'architect')),
  };
}
