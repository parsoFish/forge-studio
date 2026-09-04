import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  stageFlowRunRequest,
  listFlowRunRequests,
  drainFlowRunRequests,
  flowRunsDir,
  decideTriggerProjectScope,
  type FlowRunRequest,
} from '../../flow-run-requests.ts';
import { getPaths } from '../../queue.ts';
import { serializeManifest, type InitiativeManifest } from '../../manifest.ts';

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'flow-runs-'));
}

/**
 * Seed a `_queue/pending/<id>.md` manifest with `origin: 'triggered'` +
 * `flow_id`, the shape `hasActiveTriggeredRun` scans for. Mirrors the field
 * set `mintTriggeredInitiative` writes (see mint-triggered-initiative.test.ts).
 */
function seedTriggeredManifest(queueRoot: string, id: string, flowId: string): void {
  const paths = getPaths(queueRoot);
  mkdirSync(paths.pending, { recursive: true });
  const manifest: InitiativeManifest = {
    initiative_id: id,
    project: 'someproj',
    project_repo_path: '/tmp/someproj',
    created_at: new Date().toISOString(),
    iteration_budget: 5,
    cost_budget_usd: 10,
    phase: 'pending',
    origin: 'triggered',
    flow_id: flowId,
    body: `# ${id}`,
  };
  writeFileSync(join(paths.pending, `${id}.md`), serializeManifest(manifest));
}

test('staged request lands in _queue/flow-runs/, NOT _queue/pending/ (no mis-claim)', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-x' },
      { queueRoot: root },
    );
    assert.equal(existsSync(join(root, 'pending')), false, 'must not write into pending/');
    assert.equal(readdirSync(flowRunsDir(root)).length, 1);
    const reqs = listFlowRunRequests({ queueRoot: root });
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].req.target.ref, 'forge-develop');
    assert.equal(reqs[0].req.sourceInitiativeId, 'INIT-2026-06-26-x');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain dispatches each request via injected startFlowRun, then removes it', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-a', createdAt: '2026-06-26T10-00-00' },
      { queueRoot: root },
    );
    const dispatched: FlowRunRequest[] = [];
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: (r) => dispatched.push(r) });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].target.ref, 'forge-develop');
    assert.equal(dispatched[0].sourceInitiativeId, 'INIT-2026-06-26-a');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0, 'dispatched request must be removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain drops a context-free request (no source initiative) without dispatching', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'some-flow' }, origin: 'trigger', triggeredBy: 'other', createdAt: '2026-06-26T11-00-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });
    assert.equal(called, false);
    assert.deepEqual(results.map((r) => r.status), ['skipped-no-initiative']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain surfaces a dispatch error and leaves the request in place', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'x', sourceInitiativeId: 'INIT-2026-06-26-b', createdAt: '2026-06-26T12-00-00' },
      { queueRoot: root },
    );
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => { throw new Error('boom'); },
    });
    assert.equal(results[0].status, 'error');
    assert.match(results[0].detail ?? '', /boom/);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 1, 'failed request stays for the next sweep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty queue → drain returns []', () => {
  const root = setup();
  try {
    assert.deepEqual(drainFlowRunRequests({ queueRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-041 §2 concurrency: origination requests are skipped when a prior
// `origin: 'triggered'` run of the SAME target flow is still active.
// ---------------------------------------------------------------------------

test('drain skips an origination request when a triggered run of the same flow is active (concurrency: forbid/omitted)', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-tick-100000', 'tick');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, false, 'startFlowRun must not be invoked');
    assert.deepEqual(results.map((r) => r.status), ['skipped-concurrency']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0, 'the skipped request is removed, not left to retry forever');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request with concurrency: allow even when a triggered run is active', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-tick-100000', 'tick');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', concurrency: 'allow', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true, 'startFlowRun must be invoked when concurrency is allow');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request when no triggered run is active', () => {
  const root = setup();
  try {
    // No seeded manifest anywhere in the queue.
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true);
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request when the active triggered run targets a DIFFERENT flow', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-other-100000', 'other-flow');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true, 'a triggered run of a different flow must not block this origination');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TEST (T3, R2-08-F2 pin #13) — the TRUE current agent-target seam
// behaviour, pinned BEFORE F2 ships so an implementer's comment rewrite
// cannot silently claim it already dispatches. This is green-on-arrival: it
// characterises `defaultStartAgentRun`'s existing default (module doc: "R4-09
// seam: dispatch a standalone-agent target. Default throws (request retained)
// until the reflect cutover wires it"). It must stay green after F1/F2 ship —
// neither feature touches the `target.kind: 'agent'` default itself; F2 only
// makes `agent-complete` a fireable EVENT KIND (see flow-trigger.test.ts /
// agent-complete-trigger.test.ts), which stages `target.kind: 'flow'`
// requests, not agent ones.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (forge-f9g fix, W8-A1) — `decideTriggerProjectScope` is
// the SINGLE extracted predicate `drainFlowRunRequests` above AND
// `fireFlowTriggers` (orchestrator/flow-trigger.ts, the inline `on: merged`
// path) both consult. Direct unit coverage of the pure function's full
// matrix, plus a no-regression assertion that extracting it out of
// `drainFlowRunRequests` left the drain's own observable behaviour
// unchanged (status + notify text).
// ---------------------------------------------------------------------------

test('(RED) [forge-f9g] decideTriggerProjectScope: declaredProjects undefined → always in scope, regardless of eventProject', () => {
  assert.deepEqual(decideTriggerProjectScope(undefined, 'gitpulse'), { inScope: true });
  assert.deepEqual(decideTriggerProjectScope(undefined, null), { inScope: true });
  assert.deepEqual(decideTriggerProjectScope(undefined, undefined), { inScope: true });
});

test('(RED) [forge-f9g] decideTriggerProjectScope: declaredProjects [] → never in scope, even with a resolved eventProject', () => {
  const verdict = decideTriggerProjectScope([], 'gitpulse');
  assert.equal(verdict.inScope, false);
  assert.ok((verdict as { reason: string }).reason.length > 0);
});

test('(RED) [forge-f9g] decideTriggerProjectScope: a member eventProject → in scope', () => {
  assert.deepEqual(decideTriggerProjectScope(['gitpulse', 'betterado'], 'gitpulse'), { inScope: true });
});

test('(RED) [forge-f9g] decideTriggerProjectScope: a non-member eventProject → out of scope, typed reason', () => {
  const verdict = decideTriggerProjectScope(['gitpulse'], 'betterado');
  assert.equal(verdict.inScope, false);
  assert.match((verdict as { reason: string }).reason, /betterado/);
  assert.match((verdict as { reason: string }).reason, /gitpulse/);
});

test('(RED) [forge-f9g] decideTriggerProjectScope: unresolved eventProject (null or undefined) against a declared scope fails closed', () => {
  assert.equal(decideTriggerProjectScope(['gitpulse'], null).inScope, false);
  assert.equal(decideTriggerProjectScope(['gitpulse'], undefined).inScope, false);
});

test('(RED) [forge-f9g] decideTriggerProjectScope: strict identity — no prefix/substring/case-insensitive match', () => {
  for (const nearMiss of ['gitpulse-evil', 'x/gitpulse', 'gitpulseX', 'GITPULSE']) {
    assert.equal(
      decideTriggerProjectScope(['gitpulse'], nearMiss).inScope,
      false,
      `expected "${nearMiss}" to be treated as a non-member of ["gitpulse"]`,
    );
  }
});

test('(no-regression) [forge-f9g] drainFlowRunRequests out-of-scope status + notify text are unchanged after the decideTriggerProjectScope extraction', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'no-regression-fixture',
        sourceInitiativeId: 'INIT-no-regression',
        projects: ['gitpulse'],
        eventProject: 'betterado',
        createdAt: '2026-08-23T00-00-00',
      },
      { queueRoot: root },
    );
    const notifications: string[] = [];
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => { throw new Error('must not be called'); },
      notify: (m) => notifications.push(m),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'skipped-out-of-scope');
    assert.ok(
      notifications.some((m) =>
        m === 'flow-trigger: no-regression-fixture → flow:demo-runner-flow SKIPPED (out of scope — event project "betterado" not in [gitpulse])',
      ),
      `notify text must be byte-identical to the pre-extraction message — got ${JSON.stringify(notifications)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(green-on-arrival) [F2 #13] target.kind: "agent" with no injected startAgentRun returns status "error" and RETAINS the request file on disk', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'agent', ref: 'reflector' }, origin: 'trigger', triggeredBy: 'x', sourceInitiativeId: 'INIT-agent-target', createdAt: '2026-08-07T00-00-00' },
      { queueRoot: root },
    );
    const results = drainFlowRunRequests({ queueRoot: root });

    assert.equal(results.length, 1);
    assert.equal(
      results[0].status,
      'error',
      `expected the default (uninjected) startAgentRun to surface as status "error" — got ${JSON.stringify(results[0])}. Kills an implementer's comment rewrite that silently changes this default (auto-dispatch, silent drop, or a different status) instead of deliberately wiring startAgentRun.`,
    );
    assert.match(results[0].detail ?? '', /R4-09|no standalone-agent dispatch|retained/i);
    assert.equal(
      listFlowRunRequests({ queueRoot: root }).length,
      1,
      'the request file must be RETAINED on disk (never dropped) so the next sweep can retry/inspect it',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W8-F5 (bead forge-6gv.23) — the trigger ref is a PATH SEGMENT here.
// The widened SEC-04 scan scope surfaced this: `enqueueFlowRun` calls
// FLOW_ID_RE "a path-traversal guard on the flow ref" and refuses an invalid
// one, but the STAGE path folded the same value straight into a filename.
// ---------------------------------------------------------------------------

test('W8-F5: stageFlowRunRequest REFUSES a target ref that is not a flow-id slug — the ref never reaches the filename', () => {
  // MEASURED at c0093918, unguarded: ref `../../../../pwned` writes
  // `<tmpdir>/pwned-<ts>.json` — fully outside the queue root (the
  // `flow-run-` prefix eats one `..`, every further one walks up).
  const sandbox = mkdtempSync(join(tmpdir(), 'flow-runs-escape-'));
  const queueRoot = join(sandbox, 'q');
  mkdirSync(queueRoot, { recursive: true });
  try {
    for (const escape of ['../../../../pwned', '../../pwned', 'a/b']) {
      assert.throws(
        () => stageFlowRunRequest(
          { target: { kind: 'flow', ref: escape }, origin: 'cron', triggeredBy: 'cron:evil' } as Omit<FlowRunRequest, 'createdAt'>,
          { queueRoot },
        ),
        /flow id slug|target ref/i,
        `ref ${JSON.stringify(escape)} must fail closed at the stage boundary, exactly as the drain already fails it`,
      );
    }
    const staged = existsSync(flowRunsDir(queueRoot)) ? readdirSync(flowRunsDir(queueRoot)) : [];
    assert.deepEqual(staged, [], 'no request file was written');
    assert.deepEqual(readdirSync(sandbox), ['q'], 'nothing escaped the queue root');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('W8-F5 (GREEN twin): a valid slug ref still stages normally', () => {
  const queueRoot = setup();
  try {
    const file = stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'cron', triggeredBy: 'cron:ok' } as Omit<FlowRunRequest, 'createdAt'>,
      { queueRoot },
    );
    assert.ok(existsSync(file), 'the staged request exists');
    assert.equal(listFlowRunRequests({ queueRoot }).length, 1);
  } finally {
    rmSync(queueRoot, { recursive: true, force: true });
  }
});
