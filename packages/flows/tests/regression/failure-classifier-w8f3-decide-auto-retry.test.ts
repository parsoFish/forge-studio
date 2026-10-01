/**
 * PR #221 — W8-F3, the end-to-end `decideAutoRetry` pin.
 *
 * SPLIT FROM `packages/agents/tests/regression/failure-classifier.w8f3.test.ts`
 * (package-layer-order): every OTHER test in that file drives
 * `classifyCycleFailure` alone (an agents-package subject) and stays there.
 * This ONE test's own subject is `decideAutoRetry` (packages/flows/scheduler-
 * dispatch.ts) — flows is a higher rank than agents, so a test that reaches
 * past the classifier into the real retry decision belongs here, not there.
 * `classifyCycleFailure` is imported from `@forge/agents` (a strictly lower
 * rank than flows) to build the REAL classification event this test feeds
 * `decideAutoRetry`, exactly as the sibling file did.
 *
 * `pmDeterministicFailure` and `ev` are duplicated from the sibling file
 * rather than shared, per this codebase's own established idiom (see e.g.
 * `regression/failure-classifier.rate-limit.test.ts`'s precedent, cited in
 * the sibling file itself): a `.test.ts` that exports a helper becomes an
 * import target and starts constraining what it may assert.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyCycleFailure } from '@forge/agents';
import { decideAutoRetry } from '../../scheduler-dispatch.ts';
import { getPaths } from '../../queue.ts';
import type { EventLogEntry } from '@forge/kernel';

/** Duplicated from the sibling file — see file header. */
function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-06-07T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

/** The real PM error event shape from the ON-7 vehicle cycle — only the
 *  shared file path varies between the control and the hit. Duplicated from
 *  the sibling file — see file header. */
function pmDeterministicFailure(sharedFile: string): EventLogEntry[] {
  return [
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      event_id: 'EV_pm_err',
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message:
        `project-manager phase failed: 1 per-item validation errors; ` +
        `1 hidden-coupling pair(s): WI-1<->WI-2 share ${sharedFile}`,
      metadata: {
        per_item_error_count: 1,
        hidden_coupling_violations: [{ a: 'WI-1', b: 'WI-2', sharedFiles: [sharedFile] }],
      },
    }),
  ];
}

test('decideAutoRetry: W8-F3 end-to-end — the REAL classifier verdict grants ZERO retries for a rate-limit-token deterministic PM failure', () => {
  // Exit row 1 names classifyCycleFailure AND decideAutoRetry, so this pin
  // runs the real classifier and feeds its real output into the real retry
  // decision through a real on-disk log + manifest. (The pre-existing
  // decideAutoRetry tests hand-write the classification event, which cannot
  // catch a misclassification — a test that stubs the gate is not a gate
  // test.)
  const dir = mkdtempSync(join(tmpdir(), 'forge-f3-retry-'));
  try {
    const paths = getPaths(join(dir, '_queue'));
    mkdirSync(paths.inFlight, { recursive: true });
    const id = 'INIT-2026-08-14-betterado-gap-registry';
    writeFileSync(
      join(paths.inFlight, `${id}.md`),
      `---\ninitiative_id: ${id}\nproject: betterado\nproject_repo_path: projects/betterado\ncreated_at: 2026-08-14T00:00:00Z\niteration_budget: 1\ncost_budget_usd: 12\nclass: code\nphase: in-flight\n---\n\n# ${id}\n`,
    );
    const cls = classifyCycleFailure(pmDeterministicFailure('internal/provider/rate_limit.go'));
    const logPath = join(dir, 'events.jsonl');
    // Exactly the event `cycle.ts:emitFailureClassification` writes.
    writeFileSync(
      logPath,
      JSON.stringify({
        event_id: 'EV_fc', cycle_id: 'c', initiative_id: id, started_at: '2026-08-22T18:49:47.923Z',
        phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [], output_refs: [],
        message: 'failure_classification',
        metadata: {
          cycle_id: 'c', failure_mode: cls.kind, failure_kind: cls.kind,
          recoverable: cls.recoverable, environment: cls.environment,
          reason: cls.reason, evidence_event_ids: cls.evidence_event_ids,
        },
      }) + '\n',
    );
    const decision = decideAutoRetry(`${id}.md`, paths, logPath);
    assert.equal(decision.retry, false, 'a deterministic decomposition defect must land in failed/ on the FIRST failure');
    if (!decision.retry) assert.match(decision.reason, /terminal/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
