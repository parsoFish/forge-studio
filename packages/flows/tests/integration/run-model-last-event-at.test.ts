/**
 * Acceptance tests (R6-01 WI-1, amendment) for a NEW additive field,
 * `RunPhaseMeta.lastEventAt` (`orchestrator/run-model.ts`), derived in
 * `orchestrator/run-model-derive.ts`'s `buildNodeMeta`/`computeProgress`
 * neighbourhood — it does not exist yet. Every assertion reading
 * `phaseMeta[...].lastEventAt` below is a legitimate RED (the property is
 * simply absent from the real `RunPhaseMeta` object today) until the
 * implementer adds it.
 *
 * WHY THIS FIELD EXISTS (amendment to the original WI-1 pin,
 * apps/studio/lib/phase-log-refresh.test.ts): that file's first version
 * attributed a `tailEvents` entry to a node via `event.phase === nodeId` —
 * a naive client-side re-derivation of attribution that the codebase's
 * OWN authoritative resolver, `eventToNodeId` (this file's own
 * `orchestrator/run-model-derive.ts`), does NOT do. Measured against the
 * live flow set (`buildNodeMapping`/`buildAgentSlugToNodeId` over
 * `studio/flows/*`): only 4 of 12 real phase strings equal their node id
 * (`architect`, `demo`, `review`, `unifier`) — `developer-loop -> dev`,
 * `project-manager -> pm`, `review-loop -> review`, `reflector -> reflect`
 * all differ. `developer-loop -> dev` is the busiest node of every real
 * cycle, so the naive client pin would have shipped F1 non-functional for
 * exactly the node operators watch most, with a fully green suite. The
 * FIX moves attribution server-side: `lastEventAt` is computed over EVERY
 * event `eventToNodeId` attributes to a node (not filtered to
 * `PROGRESS_EVENT_TYPES`, unlike its sibling `lastProgressAt`), reusing the
 * SAME resolver `GET /api/runs/<id>/phases/<node>/log` already uses.
 *
 * FIXTURE PATTERN: mirrors `orchestrator/run-model.test.ts`'s own
 * `writeManifest`/`writeCycleLog`/`ev` helpers (real temp `_queue/` +
 * `_logs/<cycleId>/events.jsonl`, driven through the real `aggregateRun`)
 * — not hand-built `RunPhaseMeta` objects that bypass the read path. Case 3
 * additionally seeds a real `studio/flows/<flow-id>/flow.yaml` (the SAME
 * minimal shape `apps/forge/bridge-studio.test.ts`'s `makeGenericFlowYaml()` uses,
 * already proven to parse and resolve via `buildAgentSlugToNodeId` in that
 * file's own passing "resolves a generic-agent node's phase:orchestrator
 * events" test) so the generic-agent attribution path is exercised for
 * real, not asserted-in-principle.
 *
 * RUN: cd /home/parso/forge/.claude/worktrees/lane-r6-01 && FORGE_ARCHITECT_NO_SPAWN=1 node --test --experimental-strip-types orchestrator/run-model-last-event-at.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun } from '../../run-model.ts';

// ---------------------------------------------------------------------------
// Helpers — self-contained (do not import from run-model.test.ts, which
// exports nothing; establishing its own preconditions per this file's own
// acceptance-test contract)
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'run-model-last-event-at-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writeManifest(dir: string, state: string, initId: string, extra: Record<string, unknown> = {}): string {
  const queueDir = join(dir, '_queue', state);
  mkdirSync(queueDir, { recursive: true });
  const fields: Record<string, unknown> = {
    initiative_id: initId,
    project: 'test-project',
    project_repo_path: '/tmp/test',
    created_at: '2026-01-01T00:00:00Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
    class: 'code',
    phase: state,
    origin: 'architect',
    ...extra,
  };
  let frontmatter = '---\n';
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      frontmatter += `${k}: '${v}'\n`;
    } else {
      frontmatter += `${k}: ${JSON.stringify(v)}\n`;
    }
  }
  frontmatter += '---\n\n## Body\n\nTest initiative.\n';
  const manifestPath = join(queueDir, `${initId}.md`);
  writeFileSync(manifestPath, frontmatter);
  return manifestPath;
}

function writeCycleLog(root: string, cycleId: string, lines: object[]): void {
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

function ev(phase: string, event_type: string, started_at: string, msg?: string, meta?: Record<string, unknown>, extra: Record<string, unknown> = {}): object {
  return {
    event_id: `EV_${Math.random().toString(36).slice(2)}`,
    cycle_id: 'synthetic',
    initiative_id: 'INIT-2026-01-01-test',
    phase,
    skill: phase,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at,
    ...(msg !== undefined ? { message: msg } : {}),
    ...(meta !== undefined ? { metadata: meta } : {}),
    ...extra,
  };
}

/** Same minimal shape as apps/forge/bridge-studio.test.ts's makeGenericFlowYaml —
 *  already proven (in that file's own passing test) to parse and populate
 *  buildAgentSlugToNodeId with `demo-agent -> demo`. */
function writeGenericFlow(root: string): void {
  const dir = join(root, 'studio', 'flows', 'generic-flow');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'flow.yaml'),
    [
      'id: generic-flow',
      'name: generic-flow',
      'version: 1',
      'goal: Test flow for generic-agent node resolution.',
      'project: null',
      'kb: null',
      'costCeilingUsd: 5',
      'origin: architect',
      'nodes:',
      '  - id: demo',
      '    agent: demo-agent',
      'edges: []',
      'triggers: []',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Case 1 — a log-only node gets lastEventAt; lastProgressAt stays undefined
// ---------------------------------------------------------------------------

test('lastEventAt: a node whose only events are "log"-typed still gets a lastEventAt, while lastProgressAt stays undefined — kills lastEventAt aliased to lastProgressAt (the whole PROGRESS_EVENT_TYPES-only bug this field exists to fix)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-logonly';
    const cycleId = '2026-01-01T01-00-00_INIT-2026-01-01-logonly';
    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', '2026-01-01T01:00:00.000Z', 'cycle.start', { origin: 'architect' }),
      ev('developer-loop', 'start', '2026-01-01T01:00:01.000Z'),
      ev('developer-loop', 'log', '2026-01-01T01:00:02.000Z', 'ralph.narration-only-line'),
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });

    assert.equal(run.phaseMeta['dev']?.lastProgressAt, undefined,
      'no tool_use/file_change/test_run/iteration event occurred for dev — lastProgressAt must stay undefined');
    assert.notEqual(run.phaseMeta['dev']?.lastEventAt, undefined,
      'a "log" event DID occur for dev — lastEventAt must be set even though lastProgressAt is not');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Case 2 — lastEventAt advances to the LATEST qualifying event, not the first
// ---------------------------------------------------------------------------

test('lastEventAt: advances to the LATEST event for the node, not the first — kills a first-write-wins derivation that sets lastEventAt once and never updates it', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-advances';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-advances';
    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    const t1 = '2026-01-01T02:00:01.000Z';
    const t2 = '2026-01-01T02:00:05.000Z';
    const t3 = '2026-01-01T02:00:09.000Z'; // latest — must win

    writeCycleLog(root, cycleId, [
      ev('developer-loop', 'start', t1),
      ev('developer-loop', 'log', t2, 'ralph.line-2'),
      ev('developer-loop', 'log', t3, 'ralph.line-3-latest'),
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });

    assert.equal(run.phaseMeta['dev']?.lastEventAt, t3,
      `lastEventAt must equal the LATEST event's started_at (${t3}), got ${run.phaseMeta['dev']?.lastEventAt}`);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Case 3 — THE attribution case: developer-loop -> dev, orchestrator+agent_slug -> demo
// ---------------------------------------------------------------------------

test('lastEventAt: attributed via the REAL eventToNodeId resolver, not phase===nodeId — a developer-loop event lands on node "dev" (phase !== nodeId) and an orchestrator+agent_slug:demo-agent event lands on node "demo" — kills naive phase===nodeId attribution, the exact defect the amendment exists to fix', () => {
  const root = makeTmp();
  try {
    writeGenericFlow(root); // seeds studio/flows so buildAgentSlugToNodeId resolves demo-agent -> demo
    const initId = 'INIT-2026-01-01-attribution';
    const cycleId = '2026-01-01T03-00-00_INIT-2026-01-01-attribution';
    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId, flow_id: 'generic-flow' });

    writeCycleLog(root, cycleId, [
      // phase:'developer-loop' — FALLBACK_PHASE_TO_NODE maps this to 'dev',
      // NOT to a node literally named 'developer-loop' (which doesn't exist).
      ev('developer-loop', 'log', '2026-01-01T03:00:01.000Z', 'dev-loop narration'),
      // phase:'orchestrator' + metadata.agent_slug:'demo-agent' — resolved via
      // buildAgentSlugToNodeId (generic-flow declares node "demo" -> agent
      // "demo-agent"), NOT literally to a node named 'orchestrator'.
      ev('orchestrator', 'log', '2026-01-01T03:00:02.000Z', 'demo narration', { agent_slug: 'demo-agent' }),
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });

    assert.notEqual(run.phaseMeta['dev']?.lastEventAt, undefined,
      'a developer-loop event must attribute to node "dev" (FALLBACK_PHASE_TO_NODE), not a node literally named "developer-loop"');
    assert.notEqual(run.phaseMeta['demo']?.lastEventAt, undefined,
      'an orchestrator+agent_slug:demo-agent event must attribute to node "demo" (buildAgentSlugToNodeId), not a node literally named "orchestrator"');
    // A naive `phase === nodeId` implementation would instead produce
    // phaseMeta['developer-loop'] and phaseMeta['orchestrator'] entries —
    // node ids that do not exist on this flow at all.
    assert.equal(run.phaseMeta['developer-loop'], undefined,
      'must NOT create a phantom node keyed by the raw phase string "developer-loop"');
    assert.equal(run.phaseMeta['orchestrator'], undefined,
      'must NOT create a phantom node keyed by the raw phase string "orchestrator" (CANONICAL_PHASE_OVERRIDES maps it to null — ignored)');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Case 4 — an event for a DIFFERENT node does not move this node's lastEventAt
// ---------------------------------------------------------------------------

test('lastEventAt: a later event on a DIFFERENT node does not move this node\'s own lastEventAt — kills run-wide (non-per-node) attribution', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-crossnode';
    const cycleId = '2026-01-01T04-00-00_INIT-2026-01-01-crossnode';
    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    const devAt = '2026-01-01T04:00:01.000Z';
    const pmAt = '2026-01-01T04:00:59.000Z'; // LATER than devAt, but on a different node (pm)

    writeCycleLog(root, cycleId, [
      ev('developer-loop', 'log', devAt, 'dev narration'),
      ev('project-manager', 'log', pmAt, 'pm narration'), // pm -> node "pm", not "dev"
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });

    assert.equal(run.phaseMeta['dev']?.lastEventAt, devAt,
      `dev's lastEventAt must stay at its own latest event (${devAt}); a run-wide derivation would incorrectly pick up pm's later timestamp (${pmAt}), got ${run.phaseMeta['dev']?.lastEventAt}`);
    assert.equal(run.phaseMeta['pm']?.lastEventAt, pmAt,
      `pm's own lastEventAt must independently reflect its own event, got ${run.phaseMeta['pm']?.lastEventAt}`);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Case 5 — REGRESSION LOCK: lastProgressAt keeps its exact current semantics
// (progress types only). GREEN ON ARRIVAL — see the report's mutation proof.
// ---------------------------------------------------------------------------

test('lastProgressAt regression lock: a "log"-typed event alone never sets lastProgressAt (progress-type-only semantics unchanged by this amendment) — the liveness/wedge display (useLivenessColor/useLivenessText, PhaseDrawer.tsx) reads this exact field and must not start reporting stale liveness as fresh', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-progresslock';
    const cycleId = '2026-01-01T05-00-00_INIT-2026-01-01-progresslock';
    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('developer-loop', 'start', '2026-01-01T05:00:01.000Z'),
      ev('developer-loop', 'log', '2026-01-01T05:00:02.000Z', 'narration only, no tool/file/test/iteration'),
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });

    assert.equal(run.phaseMeta['dev']?.lastProgressAt, undefined,
      'lastProgressAt must remain undefined for a node with only start/log events — PROGRESS_EVENT_TYPES semantics are unchanged by this amendment');
  } finally {
    cleanup(root);
  }
});
