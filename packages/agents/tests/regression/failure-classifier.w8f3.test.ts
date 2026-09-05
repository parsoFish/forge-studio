/**
 * W8-F3 (ON-7 residue) — a DETERMINISTIC failure must never be classified
 * transient because a project-supplied string happened to contain a
 * rate-limit token.
 *
 * SPLIT FROM `failure-classifier.test.ts` (1,235 lines) at the seam that file
 * declared, and landed in `regression/` rather than `unit/` for two reasons
 * that agree: W8-F3 is a NAMED defect whose tests were red before the fix,
 * and this half is the only one that reaches past the classifier — it builds a
 * real queue directory (`getPaths`, `mkdtempSync`) and drives flows'
 * `decideAutoRetry` to prove the verdict actually grants zero retries. The
 * corpus replays below are archived-cycle evidence pinned so the blob scan
 * cannot come back.
 *
 * What is pinned here: the deterministic PM-coupling failures that carry a
 * rate-limit token in a PATH · the differential and doc-path controls · the
 * end-to-end `decideAutoRetry` verdict · the real archived golangci-lint gate
 * failure whose `:1529:` is a line number · hidden coupling under a capped
 * partial-usable run · cost-ceiling ordering against a rate-limit error in the
 * same window · and the metadata-shaped reads (typed SDK error kind, HTTP
 * status as a NUMBER, project payload, a project test that QUOTES the
 * contention string).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import { decideAutoRetry } from '@forge/flows/scheduler-dispatch.ts';
import { getPaths } from '@forge/flows/queue.ts';
import type { EventLogEntry } from '@forge/kernel';

/** The sibling suite's fixture builder, duplicated rather than exported: a
 *  `.test.ts` that exports a helper becomes an import target for other tests
 *  and starts constraining what it may assert — the precedent this package
 *  already set in `regression/failure-classifier.rate-limit.test.ts`. Thirteen
 *  lines is the cheaper side of that trade. */
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

// ---------------------------------------------------------------------------
// W8-F3 (ON-7 residue) — a DETERMINISTIC failure must never be classified
// transient because a project-supplied string happened to contain a
// rate-limit token.
//
// The defect, reproduced against c0093918: `rateLimited` is a plain-substring
// scan over `message + JSON.stringify(metadata)` of ANY error event, and its
// return is reached BEFORE the whole terminal chain. The PM error event's
// metadata is dominated by PROJECT-CONTROLLED payload — `hidden_coupling_
// violations[].sharedFiles` (real repo file paths), `parse_errors`,
// `set_errors`, gate output tails — so an ordinary filename like
// `internal/provider/rate_limit.go`, or a source line number that merely
// contains `529`, flips a deterministic defect to transient/recoverable and
// buys it the full MAX_AUTO_RETRIES: three byte-identical failures at cost.
//
// The cure is structural, in two halves, and BOTH are load-bearing:
//   1. verdicts that an identical retry provably cannot fix are decided FIRST;
//   2. rate-limit detection reads the error's OWN fields (its message, the
//      SDK error `type`, an HTTP status) — never a stringified metadata blob.
// Half 2 alone is insufficient: the PM's own thrown message names the shared
// file ("…hidden-coupling pair(s): WI-1<->WI-2 share internal/provider/
// rate_limit.go"), so the token reaches an own-field legitimately. Half 1
// alone is insufficient: it leaves every non-hoisted rule (gate.fail,
// dev-loop total failure) reading project payload.
// ---------------------------------------------------------------------------

/** The real PM error event shape from the ON-7 vehicle cycle — only the
 *  shared file path varies between the control and the hit. */
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

test('classifyCycleFailure: W8-F3 — a deterministic PM coupling failure on a shared file named rate_limit.go stays TERMINAL', () => {
  // RED at c0093918: `rateLimited` matched "rate_limit" inside
  // metadata.hidden_coupling_violations[0].sharedFiles and returned
  // transient/recoverable, granting 2 auto-retries of a defect that
  // re-runs identically.
  const c = classifyCycleFailure(pmDeterministicFailure('internal/provider/rate_limit.go'));
  assert.equal(c.kind, 'terminal', 'the same decomposition re-runs the same overlap — a retry is pure waste');
  assert.equal(c.recoverable, false, 'recoverable is what decideAutoRetry reads to grant an unattended retry');
  assert.equal(c.environment, false, 'a decomposition defect is not an environment failure');
  assert.match(c.reason, /hidden coupling/i, 'the reason must name the real defect, not "rate-limited"');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
});

test('classifyCycleFailure: W8-F3 — differential control: the identical failure on an ordinary path is terminal too', () => {
  // The control proves the assertion above is about the FILENAME and nothing
  // else — the two events differ in exactly one string.
  const c = classifyCycleFailure(pmDeterministicFailure('internal/provider/registry.go'));
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /hidden coupling/i);
});

test('classifyCycleFailure: W8-F3 — a doc path numbered 429 does not flip a deterministic PM failure', () => {
  const c = classifyCycleFailure(pmDeterministicFailure('docs/adr/429-quota.md'));
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /hidden coupling/i);
});

test('classifyCycleFailure: W8-F3 — schema-invalid WIs on a rate_limit path stay terminal (per-item leg)', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'project-manager phase failed: 2 per-item validation errors',
      metadata: {
        per_item_error_count: 2,
        parse_errors: ['WI-2: depends_on references internal/rate_limit/registry.go which is not a work item'],
      },
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /schema-invalid/i);
});

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

// ---------------------------------------------------------------------------
// W8-F3 — the blob scan's real-world precision is ZERO.
//
// Surveying all 354 archived cycle logs under `_logs/`: no error event has
// ever carried a rate-limit token in its own `message`. Five carried one in
// metadata — every one a false positive (a `529` inside a golangci-lint
// source line number, a `529` inside a git SHA). The fixture below is one of
// them, verbatim.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: W8-F3 — a real archived golangci-lint gate failure is NOT a rate limit ("…:1529:36" is a line number)', () => {
  // Provenance: _logs/2026-06-01T13-18-09_INIT-2026-06-01-ci-green — the
  // decisive pair of that cycle's five error events, EV_mpv8y2zq_kew0uozj
  // (gate.fail, iteration 4, the one carrying the :1529: line) and
  // EV_mpv902r2_hy3c9rbc (the orchestrator's total-failure error). The three
  // earlier gate.fail events are omitted; they carry the same shape and do
  // not change the verdict.
  // Replayed through c0093918 this whole cycle classifies
  // `transient / environment:true / "agent rate-limited"`. The
  // classification actually recorded on disk in June 2026 was
  // `terminal / "dev-loop completed 0/N work items"` — so the blob scan is a
  // live REGRESSION against a real, already-diagnosed cycle.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({
      event_id: 'EV_mpv8y2zq_kew0uozj',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'gate.fail',
      metadata: {
        work_item_id: 'WI-1',
        gate_passed: false,
        gate_exit_code: 1,
        gate_command: 'golangci-lint run -v ./azuredevops/...',
        gate_stdout_tail:
          'azuredevops/internal/service/release/resource_release_definition.go:1529:36: ' +
          'SA1019: opts.EnableAccessToken is deprecated: Use DeploymentInput.EnableAccessToken instead. (staticcheck)',
        // First line verbatim; golangci-lint's remaining ~19 `level=info` lines
        // are elided (none carries a signature the classifier keys on).
        gate_stderr_tail:
          'level=info msg="golangci-lint has version 1.64.8 built with go1.24.1 from 8b37f141 on 2025-03-17T20:41:53Z"',
        iteration: 4,
      },
    }),
    ev({
      event_id: 'EV_mpv902r2_hy3c9rbc',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/1 work items completed — total failure',
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'a genuine lint failure is a work failure, not API pressure');
  assert.equal(c.environment, false, 'environment:true would send this to requeue-resume as a stalled cycle');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
  assert.match(c.reason, /0\/N work items|total failure|dev-loop completed/i);
});

// ---------------------------------------------------------------------------
// W8-F3 — pm.partial-decomposition must not shield a HIDDEN-COUPLING
// violation.
//
// The carve-out at `pmPartialUsable` is deliberate and pinned
// ("partial-usable beats the capped+degenerate terminal rule", above): a
// capped incremental run legitimately leaves a TRUNCATED TAIL work item, and
// a cap is stochastic, so a fresh pass is a legitimate retry. A hidden-
// coupling violation is a different animal: it is an overlap between work
// items the PM actually WROTE, computed deterministically from them. Capping
// cannot cause it and a fresh pass cannot be expected to avoid it. So
// partial-usable keeps shielding per-item errors and stops shielding
// coupling.
// ---------------------------------------------------------------------------

// Two cases, because two different rules produce the verdict and an assertion
// that accepts either cannot tell them apart. Both are RED at c0093918, where
// `pmPartialUsable` returned transient before either could be reached.
test('classifyCycleFailure: W8-F3 — a CAPPED partial-usable run with hidden coupling is "never converged" terminal', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { result_subtype: 'error_max_turns', work_item_count: 4, valid_count: 3, planned_count: 6, usable: true },
    }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'project-manager phase failed: 5 hidden-coupling pair(s)',
      metadata: {
        result_subtype: 'error_max_turns',
        per_item_error_count: 4,
        hidden_coupling_violations: [{ a: 'WI-4a', b: 'WI-4b', sharedFiles: ['docs/gap-registry.md'] }],
      },
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'the overlap is between WIs the PM wrote — a fresh pass re-derives it');
  assert.equal(c.recoverable, false);
  assert.doesNotMatch(c.reason, /partial/i);
  // The `pm.partial-decomposition` event itself sets `pmCapped`, so the
  // capped+degenerate rule is what fires here. Naming it keeps this test
  // honest about which branch it proves.
  assert.match(c.reason, /never converged/i);
});

test('classifyCycleFailure: W8-F3 — an UNCAPPED partial-usable run with hidden coupling returns via the hidden-coupling rule', () => {
  // No `result_subtype` anywhere ⇒ `pmCapped` is false ⇒ the capped+degenerate
  // rule cannot fire, so this reaches the `pmHiddenCoupling` rule and pins it
  // specifically. Deleting that rule turns this test RED and the one above
  // green — which is exactly the discrimination the pair exists to provide.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { work_item_count: 4, valid_count: 3, planned_count: 6, usable: true },
    }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'project-manager phase failed: 5 hidden-coupling pair(s)',
      metadata: {
        hidden_coupling_violations: [{ a: 'WI-4a', b: 'WI-4b', sharedFiles: ['docs/gap-registry.md'] }],
      },
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.doesNotMatch(c.reason, /partial/i);
  assert.match(c.reason, /hidden coupling/i);
  assert.doesNotMatch(c.reason, /never converged/i);
});

// ---------------------------------------------------------------------------
// W8-F3 / WI-4 — the cost-ceiling stop.
//
// The C4 critic's premise ("the rule at :200 did not fire on the real event")
// is a CHRONOLOGY artifact, not a defect: `git log -S "startsWith('cost-
// ceiling:')"` puts the rule in 16288047 (2026-08-23 14:40); the run failed
// 2026-08-22 18:49. The rule did not exist yet. Replaying the real file
// through this tree already yields the right verdict — pinned below so the
// claim stops being re-litigated from the log alone.
//
// The LIVE residue is different and real: the cost-ceiling capture at :200
// runs early, but its RETURN sits below `rateLimited`. Its own doc comment
// claims "matching it here means the branch never depends on the blob-based
// rate-limit/agent_threw checks happening to miss it" — which was false.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: W8-F3 — a cost-ceiling stop outranks a rate-limit error in the same window', () => {
  // RED at c0093918. A flow that burned through its ceiling has very often
  // been retrying against API pressure on the way there, so the two signals
  // co-occur naturally. Auto-retrying re-spends against an ALREADY-CROSSED
  // ceiling: guaranteed repeat, zero new work, at cost.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'agent step failed: rate_limit_error (429) from upstream',
    }),
    ev({
      event_id: 'EV_mt4qg6tm_52d98gro',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message:
        'cost-ceiling: flow spent $80.8324 which meets or exceeds the $52.00 ceiling — ' +
        'stopping at a clean phase boundary (resumable).',
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'a retry re-spends against a ceiling it already crossed');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /cost ceiling/i, 'the operator must be told the run stopped for a NAMEABLE reason');
  assert.match(c.reason, /80\.83/);
});

test('classifyCycleFailure: W8-F3 — replay of the REAL cost-ceiling cycle tail classifies terminal with the real evidence id', () => {
  // The three real tail events of
  // _logs/2026-08-18T12-42-15_INIT-2026-08-14-betterado-gap-registry
  // (1601 dev-loop end 6/6 complete, 1602 flow.cost-ceiling-stop, 1603 the
  // orchestrator error), verbatim. Green at c0093918 — recorded as a
  // regression pin, not as a red-first repro; see the chronology note above.
  const c = classifyCycleFailure([
    ev({
      event_id: 'EV_mt4qg6tm_hfybv5zl',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'end',
      metadata: { work_item_count: 6, complete: 6, failed: 0, resumed: false },
    }),
    ev({
      event_id: 'EV_mt4qg6tm_3ce4g2ff',
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'log',
      message: 'flow.cost-ceiling-stop',
      metadata: { spentUsd: 80.83237065, ceilingUsd: 52, pct: 155.4, stoppedBeforeNode: 'demo' },
    }),
    ev({
      event_id: 'EV_mt4qg6tm_52d98gro',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message:
        'cost-ceiling: flow spent $80.8324 which meets or exceeds the $52.00 ceiling — ' +
        'stopping at a clean phase boundary (resumable).',
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.doesNotMatch(c.reason, /could not be classified/i);
  assert.match(c.reason, /80\.83/);
  assert.deepEqual(c.evidence_event_ids, ['EV_mt4qg6tm_52d98gro'], 'the operator must be pointed at the real event');
});

// ---------------------------------------------------------------------------
// W8-F3 — the DETECTOR half, pinned on its own.
//
// An adversarial review of the first cut found the digit-adjacency guard in
// `HTTP_PRESSURE_STATUS_RE` unpinned: reverting it to a bare /429|529/ left
// every test green, because the PM fixtures above are all shielded by the
// PRECEDENCE half (they set `pmHiddenCoupling`, so the deterministic block
// returns before the environment chain is consulted) and the only other
// fixture carried its token in metadata, which the narrowed detector never
// reads. These tests exercise `errorOwnFieldsSignalRateLimit` directly,
// through an error event's OWN message and typed fields, with no deterministic
// rule in play — so a mutation of the detector has nowhere to hide.
//
// Both directions matter. Losing a GENUINE rate-limit detection is the
// mirror-image defect: a cycle that stops auto-retrying through real API
// pressure and lands in failed/ with its dependents collapsed behind it.
// ---------------------------------------------------------------------------

/** A lone dev-loop error event — no other signal, so the verdict is decided
 *  by the rate-limit detector and nothing else. */
function loneError(message: string, metadata: Record<string, unknown> = {}): EventLogEntry[] {
  return [
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({ phase: 'developer-loop', skill: 'developer-ralph', event_type: 'error', message, metadata }),
  ];
}

for (const [label, message] of [
  ['a source line number', 'panic in internal/provider/client.go:429:12 — nil map write'],
  ['a git SHA fragment', 'push rejected: commit 0529de0abc is not a fast-forward'],
  ['a byte/item count', 'agent step failed: processed batch 4290 items before aborting'],
  ['a semver-ish build id', 'toolchain mismatch: expected 1.529.0, found 1.530.2'],
  // Found by adversarial review of the first cut, which guarded only digit,
  // dot and colon adjacency — a letter is none of those.
  // NB: no `agent_threw` token in these fixtures — that branch's own reason
  // string is "agent threw a non-rate-limit error", which the assertion below
  // would read as a rate-limit mention.
  ['a PR reference', 'failed to rebase onto main after PR429 merged out from under it'],
  ['an issue id', 'reopened issue429 — the fixture still asserts the old shape'],
  ['a work-item id', 'ralph.end: WI-429 exhausted its iteration budget'],
  ['a lint problem count', 'golangci-lint reported 429 problems (400 errors, 29 warnings)'],
] as const) {
  test(`classifyCycleFailure: W8-F3 — ${label} in an error's own message is NOT API pressure`, () => {
    const c = classifyCycleFailure(loneError(message));
    assert.notEqual(c.kind, 'transient', `"${message}" must not read as a rate limit`);
    assert.equal(c.environment, false, 'environment:true routes this to requeue-resume as a stalled cycle');
    assert.doesNotMatch(c.reason, /rate.?limit/i);
  });
}

for (const [label, message] of [
  ['a bare HTTP status', 'agent step failed: HTTP 429 Too Many Requests'],
  ['a compact statusCode', 'request failed, statusCode:429'],
  ['a sentence-terminal status', 'upstream returned error 429.'],
  ['a trailing status', 'anthropic api error, status: 429'],
  ['the typed API error name', 'agent_threw: rate_limit_error from the SDK'],
] as const) {
  test(`classifyCycleFailure: W8-F3 — ${label} IS still detected as API pressure`, () => {
    const c = classifyCycleFailure(loneError(message));
    assert.equal(c.kind, 'transient', `"${message}" is a genuine rate limit and must still auto-retry`);
    assert.equal(c.environment, true);
    assert.match(c.reason, /rate.?limit/i);
  });
}

test("classifyCycleFailure: W8-F3 — the SDK's typed error kind is read from the error's own metadata", () => {
  const c = classifyCycleFailure(loneError('agent step failed', { type: 'rate_limit_error' }));
  assert.equal(c.kind, 'transient');
  assert.equal(c.environment, true);
});

test('classifyCycleFailure: W8-F3 — an HTTP status field is compared as a NUMBER, not a substring', () => {
  const hit = classifyCycleFailure(loneError('agent step failed', { http_status: 429 }));
  assert.equal(hit.kind, 'transient', 'a real 429 status must still be detected');
  // `status` carries a lifecycle word on most forge events; it must not throw
  // and must not match.
  const miss = classifyCycleFailure(loneError('agent step failed', { status: 'failed' }));
  assert.notEqual(miss.kind, 'transient');
  // A numeric field that is not an HTTP status.
  const notAStatus = classifyCycleFailure(loneError('agent step failed', { status: 4290 }));
  assert.notEqual(notAStatus.kind, 'transient');
});

test('classifyCycleFailure: W8-F3 — project payload in metadata is never read as API pressure', () => {
  // The original defect, isolated from the PM rules entirely: the token is in
  // project-supplied metadata and nowhere else, and no deterministic rule is
  // in play to mask the result.
  const c = classifyCycleFailure(
    loneError('gate.fail', {
      gate_stdout_tail: 'internal/provider/rate_limit.go:42:1: undefined: Foo',
      changed_files: ['internal/provider/rate_limit.go', 'docs/adr/429-quota.md'],
    }),
  );
  assert.notEqual(c.kind, 'transient');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
});

test('classifyCycleFailure: W8-F3 — a project test that QUOTES the lint-contention string is not contention', () => {
  // Same class as the rate-limit defect, on the sibling rule: `tails` is
  // captured tool output, i.e. project-controlled. A project whose own test
  // asserts on this string bought its deterministic test failure two
  // auto-retries. Found by adversarial review; RED before the signature was
  // anchored to golangci-lint's own error line.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'gate.fail',
      metadata: {
        gate_stdout_tail:
          'FAIL lint_wrapper_test.go:12: expected the wrapper to surface exit 1 when ' +
          '"parallel golangci-lint is running" is seen on stderr, got exit 0',
      },
    }),
  ]);
  assert.notEqual(c.kind, 'transient', 'a deterministic test failure must not buy auto-retries');
  assert.equal(c.environment, false);
  assert.doesNotMatch(c.reason, /contention/i);
});

test('classifyCycleFailure: W8-F3 — all three real contention forms are still detected', () => {
  // Two are verbatim from the archived logs
  // (_logs/2026-07-01T08-39-27_INIT-2026-07-01-*), the third is the `ERRO`
  // form a pre-existing pin carries. Guards the mirror-image regression:
  // losing a genuine detection stops a cycle that should have self-healed.
  for (const tail of [
    'Error: parallel golangci-lint is running',
    'The command is terminated due to an error: parallel golangci-lint is running',
    'ERRO parallel golangci-lint is running',
  ]) {
    const c = classifyCycleFailure([
      ev({ event_type: 'error', message: 'gate.fail', metadata: { gate_stderr_tail: tail } }),
    ]);
    assert.equal(c.kind, 'transient', `"${tail}" is real host contention and must still auto-retry`);
    assert.equal(c.environment, true);
  }
});
