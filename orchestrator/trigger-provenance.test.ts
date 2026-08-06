/**
 * ACCEPTANCE TESTS (T3, R2-08-F4) — trigger provenance on the run model.
 *
 * Pins the contract (docs/decisions/027-studio-object-model.md "Run-model
 * trigger provenance (R2-08-F4) is derived, not stored" +
 * docs/roadmaps/R2-runnable-componentry.md R2-08-F4):
 *
 *   Run.trigger?: { kind: TriggerKindId; source: string; scope: string | null }
 *
 * derived from the staged FlowRunRequest (orchestrator/flow-run-requests.ts)
 * — never free text, never a new stored object. Must be RED against
 * dcbfee0f (HEAD at pin time): `Run` carries no `trigger` field anywhere in
 * orchestrator/run-model.ts, and `VALID_ORIGINS` silently coerces a
 * `manifest.origin === 'triggered'` down to `'architect'`.
 *
 * Fixture strategy per shipped kind (SHIPPED_TRIGGER_KIND_IDS,
 * orchestrator/flow-trigger.ts:56 = ['flow-complete','agent-complete',
 * 'merged','cron','webhook']):
 *
 *  - cron / webhook / agent-complete: these are the three kinds that MINT a
 *    FRESH initiative (no `sourceInitiativeId` on the FlowRunRequest ⇒
 *    `mintTriggeredInitiative`, per flow-run-requests.ts's own
 *    `defaultStartFlowRun`). Driven through the REAL, already-shipped
 *    `mintTriggeredInitiative` (orchestrator/mint-triggered-initiative.ts)
 *    with a hand-built `FlowRunRequest` mirroring each real call site's
 *    shape exactly (cron-triggers.ts `makeFireFn`, cli/bridge-hooks.ts's
 *    webhook route, flow-trigger.ts `fireAgentCompleteTriggers`) — then the
 *    REAL `aggregateRun`/`listRuns` reads the resulting on-disk manifest.
 *    This is "plant it directly" in the sense that requires no change to
 *    ANY code under test: `mintTriggeredInitiative` is real, shipped,
 *    upstream-of-F4 infrastructure (R2-04/R2-08-F1..F3), not the code path
 *    F4 is adding.
 *
 *  - flow-complete (chaining via `enqueueFlowRun`) and merged (inline
 *    reflect dispatch in finalize-merged.ts): NEITHER mints a fresh
 *    manifest today — chaining repoints the SAME cycle_id
 *    ("DEC-2 lineage: the run threads the SAME cycle_id... No sibling cycle
 *    is born" — enqueue-flow-run.ts), and the merged-agent-target dispatch
 *    runs the reflect handler inline within the SAME cycle
 *    (finalize-merged.ts). Neither path persists ANY trigger info today —
 *    not even prose. The one artifact either path DOES already emit, for
 *    real, onto the firing run's OWN `_logs/<cycleId>/events.jsonl`, is the
 *    `flow-runner.trigger-firing` / `finalize.trigger-firing` event with
 *    `metadata: { on, target, source_flow }` (flow-runner.ts:1403-1415,
 *    finalize-merged.ts:176-190 onFire callbacks) — verified by reading the
 *    actual source. These two fixtures plant that REAL, verified event
 *    shape directly into a synthetic events.jsonl (mirroring the exact
 *    pattern orchestrator/run-model.test.ts already uses for every other
 *    edge case in this file), since no live call path produces it as a
 *    file on disk without running a real cycle.
 *
 *    AMBIGUITY (escalated in the T3 report, not guessed silently): whether
 *    F4 should derive flow-complete/merged provenance from this
 *    *-trigger-firing event on the run's own log (my assumption here,
 *    consistent with run-model.ts's existing findOrigin-from-cycle.start
 *    pattern and ADR 008's "the event log is written once; readers
 *    aggregate from it" rule cited by ADR-027), or whether the
 *    implementation instead needs new manifest-frontmatter plumbing
 *    threaded through enqueueFlowRun/finalize-merged.ts. Both are
 *    consistent with "derived from the staged request"; only the former is
 *    achievable without a production change outside run-model.ts today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun, listRuns } from './run-model.ts';
import { mintTriggeredInitiative } from './mint-triggered-initiative.ts';
import { getPaths } from './queue.ts';
import { normalizeProjectId } from './studio/registry.ts';
import type { FlowRunRequest } from './flow-run-requests.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'trigger-provenance-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A minimal, loadable FlowDefinition — mirrors mint-triggered-initiative.test.ts's flowYaml(). */
function flowYaml(opts: { id: string; project: string | null }): string {
  const projectLine = opts.project === null ? 'project: null' : `project: ${opts.project}`;
  return [
    `id: ${opts.id}`,
    `name: ${opts.id}`,
    'version: 1',
    'goal: R2-08-F4 trigger-provenance test fixture.',
    projectLine,
    'kb: null',
    'costCeilingUsd: 10',
    'origin: seed',
    'nodes:',
    '  - { id: dev, agent: developer-ralph }',
    'edges: []',
    'triggers: []',
    '',
  ].join('\n');
}

/** Register a target flow (with a project binding) under <root>/studio/flows/<id>/. */
function planFlow(root: string, id: string, project: string): void {
  const dir = join(root, 'studio', 'flows', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow.yaml'), flowYaml({ id, project }));
  mkdirSync(join(root, 'projects', project), { recursive: true });
}

/**
 * Mint a fresh triggered initiative via the REAL mintTriggeredInitiative,
 * given a FlowRunRequest shaped exactly like a real call site's. Returns the
 * resulting Run (queueState 'pending' — a freshly-minted, not-yet-claimed
 * run; the realistic state for "a run derived from a staged request").
 */
function mintAndDeriveRun(
  root: string,
  req: Omit<FlowRunRequest, 'createdAt'> & { createdAt?: string },
): ReturnType<typeof aggregateRun> {
  const queueRoot = join(root, '_queue');
  const logsRoot = join(root, '_logs');
  const result = mintTriggeredInitiative(
    { ...req, createdAt: req.createdAt ?? new Date().toISOString() } as FlowRunRequest,
    { forgeRoot: root, queueRoot, logsRoot },
  );
  assert.equal(result.status, 'minted', `fixture mint failed: ${JSON.stringify(result)}`);
  const paths = getPaths(queueRoot);
  const manifestPath = join(paths.pending, `${result.initiativeId}.md`);
  return aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });
}

/** Write a minimal valid manifest markdown with the given fields (mirrors run-model.test.ts). */
function writeManifestFixture(dir: string, state: string, initId: string, extra: Record<string, unknown> = {}): string {
  const queueDir = join(dir, '_queue', state);
  mkdirSync(queueDir, { recursive: true });
  const fields: Record<string, unknown> = {
    initiative_id: initId,
    project: 'test-project',
    project_repo_path: '/tmp/test',
    created_at: '2026-01-01T00:00:00Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
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

/** Write a minimal events.jsonl at _logs/<cycleId>/events.jsonl (mirrors run-model.test.ts). */
function writeCycleLog(root: string, cycleId: string, lines: object[]): void {
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

/** A minimal event for a phase start/end (mirrors run-model.test.ts's ev()). */
function ev(phase: string, event_type: string, msg?: string, meta?: Record<string, unknown>, extra: Record<string, unknown> = {}): object {
  return {
    event_id: `EV_${Math.random().toString(36).slice(2)}`,
    cycle_id: 'synthetic',
    initiative_id: 'INIT-2026-01-01-test',
    phase,
    skill: phase,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    ...(msg !== undefined ? { message: msg } : {}),
    ...(meta !== undefined ? { metadata: meta } : {}),
    ...extra,
  };
}

/** Recursively list every file under root, as paths relative to root, sorted. */
function listAllFilesRec(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else out.push(rel);
    }
  }
  walk(root, '');
  return out.sort();
}

const ATTACKER_STRING = "'; DROP TABLE runs; --<script>alert(document.cookie)</script>";

// ---------------------------------------------------------------------------
// Test 1 — table-driven: every shipped kind exposes trigger.kind correctly
// ---------------------------------------------------------------------------
// Kills: (a) Run carrying no `trigger` field at all; (b) a hardcoded/partial
// derivation that only covers a subset of SHIPPED_TRIGGER_KIND_IDS.

test('trigger.kind === "cron" for a run derived from a staged cron request', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-cron', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-cron' },
      origin: 'cron',
      triggeredBy: 'cron:watcher-cron',
      concurrency: 'allow',
      payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
    });
    assert.equal(run.trigger?.kind, 'cron', `expected trigger.kind 'cron', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('trigger.kind === "webhook" for a run derived from a staged webhook request', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-webhook', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-webhook' },
      origin: 'webhook',
      triggeredBy: 'webhook:demo-runner-hook',
      payload: {
        kind: 'webhook',
        provider: 'github',
        event: 'push',
        repo: 'acme/widgets',
        ref: 'refs/heads/main',
        headSha: 'a'.repeat(40),
        pusherLogin: 'octocat',
        commitCount: 1,
        headCommitMessage: 'fix: widget alignment',
      },
    });
    assert.equal(run.trigger?.kind, 'webhook', `expected trigger.kind 'webhook', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('trigger.kind === "agent-complete" for a run derived from a staged agent-complete request', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-agent-complete', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-agent-complete' },
      origin: 'agent-complete',
      triggeredBy: 'agent-complete:doc-updater',
      sourceAgent: 'doc-updater',
    });
    assert.equal(run.trigger?.kind, 'agent-complete', `expected trigger.kind 'agent-complete', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('trigger.kind === "flow-complete" for a run whose own log carries the real flow-runner.trigger-firing event', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-flow-complete';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-flow-complete';
    const manifestPath = writeManifestFixture(root, 'in-flight', initId, { cycle_id: cycleId, flow_id: 'forge-develop', project: 'test-project' });
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      // The REAL event shape emitted by flow-runner.ts:1403-1415's onFire callback.
      ev('orchestrator', 'log', 'flow-runner.trigger-firing', {
        on: 'flow-complete',
        target: { kind: 'flow', ref: 'forge-develop' },
        source_flow: 'forge-architect',
      }),
    ]);
    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs: Date.now() });
    assert.equal(run.trigger?.kind, 'flow-complete', `expected trigger.kind 'flow-complete', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('trigger.kind === "merged" for a run whose own log carries the real finalize.trigger-firing event', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-merged';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-merged';
    const manifestPath = writeManifestFixture(root, 'done', initId, { cycle_id: cycleId, flow_id: 'forge-develop', project: 'test-project' });
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      // The REAL event shape emitted by finalize-merged.ts:176-190's onFire callback.
      ev('orchestrator', 'log', 'finalize.trigger-firing', {
        on: 'merged',
        target: { kind: 'agent', ref: 'reflector' },
        source_flow: 'forge-develop',
      }),
      ev('orchestrator', 'end', 'cycle.end', { status: 'done' }),
    ]);
    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });
    assert.equal(run.trigger?.kind, 'merged', `expected trigger.kind 'merged', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 2 — trigger.source is the DECLARING DEFINITION id, never prose/payload
// ---------------------------------------------------------------------------
// Kills: (a) source populated from triggeredBy verbatim (e.g. "cron:watcher-cron"
// including the kind prefix, rather than the bare definition id); (b) source
// populated from the TARGET flow id instead of the DECLARING one; (c) any
// payload free-text field leaking into ANY trigger member.

test('trigger.source is the declaring flow id (cron) — distinct from the target flow id', () => {
  const root = makeTmp();
  try {
    // Declaring flow ('watcher-cron') != target flow ('worker-cron-2') — if
    // source were wrongly derived from target.ref this assertion fails.
    planFlow(root, 'worker-cron-2', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-cron-2' },
      origin: 'cron',
      triggeredBy: 'cron:watcher-cron',
      payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
    });
    assert.equal(run.flowId, 'worker-cron-2', 'sanity: the run itself runs the TARGET flow');
    assert.equal(run.trigger?.source, 'watcher-cron', `expected trigger.source to be the DECLARING flow id 'watcher-cron' (never the target 'worker-cron-2'), got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('trigger.source is the sourceAgent slug (agent-complete), never operator prose', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-agent-complete-2', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-agent-complete-2' },
      origin: 'agent-complete',
      triggeredBy: 'agent-complete:reviewer-bot',
      sourceAgent: 'reviewer-bot',
    });
    assert.equal(run.trigger?.source, 'reviewer-bot', `expected trigger.source to be the sourceAgent slug 'reviewer-bot', got ${JSON.stringify(run.trigger)}`);
  } finally {
    cleanup(root);
  }
});

test('an attacker-controlled webhook payload string never appears anywhere in trigger (kind/source/scope)', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-webhook-2', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-webhook-2' },
      origin: 'webhook',
      triggeredBy: 'webhook:demo-runner-hook',
      payload: {
        kind: 'webhook',
        provider: 'github',
        event: 'push',
        repo: 'acme/widgets',
        ref: 'refs/heads/main',
        headSha: 'a'.repeat(40),
        pusherLogin: 'octocat',
        commitCount: 1,
        // Free text (trigger-payload.ts: "carried verbatim AS DATA") — the
        // attacker-ish string. Must never leak into the derived trigger.
        headCommitMessage: ATTACKER_STRING,
      },
    });
    assert.ok(run.trigger, 'expected a trigger object to be derived at all');
    const serialized = JSON.stringify(run.trigger);
    assert.ok(
      !serialized.includes(ATTACKER_STRING),
      `attacker payload text leaked into trigger: ${serialized}`,
    );
    assert.notEqual(run.trigger?.kind, ATTACKER_STRING);
    assert.notEqual(run.trigger?.source, ATTACKER_STRING);
    assert.notEqual(run.trigger?.scope, ATTACKER_STRING);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 3 — trigger.scope agrees with normalizeProjectId; unscoped => null
// ---------------------------------------------------------------------------
// Kills: (a) scope carrying a raw, un-normalized project string that
// disagrees with the ONE normalizer (studio/registry.ts normalizeProjectId)
// every other project-id comparison in the codebase is required to use; (b)
// an unresolved/absent eventProject being reported as '' or silently
// defaulted to some project, rather than the honest `null`.

test('trigger.scope is normalizeProjectId-agreeing for a resolved project (fixture dir needs normalization)', () => {
  const root = makeTmp();
  try {
    // "My_Project" needs normalization (mixed case + underscore) — mirrors
    // cron-triggers.ts's OWN real normalizeProjectId(flowDef.project) call
    // (the declaring flow's project), which arrives at staging time already
    // normalized in every real production caller.
    planFlow(root, 'worker-scoped', 'My_Project');
    const normalized = normalizeProjectId('My_Project');
    assert.equal(normalized, 'my-project', 'sanity on the normalizer itself');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-scoped' },
      origin: 'cron',
      triggeredBy: 'cron:worker-scoped',
      payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
      eventProject: normalized,
    });
    assert.equal(
      run.trigger?.scope,
      normalized,
      `expected trigger.scope to agree with normalizeProjectId('My_Project') === '${normalized}', got ${JSON.stringify(run.trigger)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('trigger.scope is exactly null (not undefined, not "") when the firing event has no resolved project', () => {
  const root = makeTmp();
  try {
    // Webhook is the real, documented case: cli/bridge-hooks.ts deliberately
    // never sets eventProject ("there is no repo->forge-project-id mapping
    // anywhere in the codebase... a scoped webhook trigger fails closed").
    planFlow(root, 'worker-unscoped', 'test-project');
    const run = mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-unscoped' },
      origin: 'webhook',
      triggeredBy: 'webhook:some-hook',
      payload: {
        kind: 'webhook',
        provider: 'github',
        event: 'release',
        repo: 'acme/widgets',
        tag: 'v1.0.0',
        releaseName: 'v1.0.0',
        publishedAt: '2026-01-01T00:00:00Z',
        body: 'release notes',
      },
      // eventProject deliberately absent — mirrors real bridge-hooks.ts.
    });
    assert.ok(run.trigger, 'expected a trigger object to be derived at all');
    assert.equal(run.trigger?.scope, null, `expected scope === null exactly, got ${JSON.stringify(run.trigger?.scope)} (typeof ${typeof run.trigger?.scope})`);
    assert.notEqual(run.trigger?.scope, undefined, 'scope must be present-and-null, not absent');
    assert.notEqual(run.trigger?.scope, '', 'scope must be null, not an empty string');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 4 — no trigger provenance => trigger is ABSENT, and the Run stays valid
// ---------------------------------------------------------------------------
// Kills: "every run gets a fabricated default trigger" (e.g. defaulting
// missing provenance to {kind:'flow-complete', source:'', scope:null} or
// similar) — a pre-R2-08 archived run, or a normal architect-originated run,
// must expose NO trigger member at all, not a synthesized placeholder.

test('a plain architect-originated run (no trigger provenance) exposes trigger as absent, and is still a valid Run', () => {
  const root = makeTmp();
  try {
    // Path 1: buildRun (a real, executed run with events).
    const initId = 'INIT-2026-01-01-no-trigger';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-no-trigger';
    const manifestPath = writeManifestFixture(root, 'done', initId, { cycle_id: cycleId, flow_id: 'forge-develop' });
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('architect', 'start'), ev('architect', 'end'),
      ev('orchestrator', 'end', 'cycle.end', { status: 'done' }),
    ]);
    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });
    assert.equal(run.trigger, undefined, `expected NO trigger member (a fabricated default would fail this), got ${JSON.stringify(run.trigger)}`);
    assert.equal('trigger' in run, false, 'trigger key must not even be present (not merely undefined-valued)');
    // Still a valid Run — sanity on the surrounding shape.
    assert.equal(run.id, cycleId);
    assert.equal(run.status, 'complete');
    assert.equal(run.origin, 'architect');

    // Path 2: makePlannedRun (a pre-run, pending manifest — a different code
    // branch than buildRun; both independently carry the "no fabricated
    // default" obligation).
    const plannedId = 'INIT-2026-01-01-no-trigger-planned';
    const plannedPath = writeManifestFixture(root, 'pending', plannedId);
    const plannedRun = aggregateRun({ root, queueState: 'pending', manifestPath: plannedPath, nowMs: Date.now() });
    assert.equal(plannedRun.status, 'planned');
    assert.equal(plannedRun.trigger, undefined, `expected NO trigger member on a planned run either, got ${JSON.stringify(plannedRun.trigger)}`);
    assert.equal('trigger' in plannedRun, false);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 5 — the fidelity gap: origin: 'triggered' must survive, not silently
// coerce to 'architect'
// ---------------------------------------------------------------------------
// Kills: run-model.ts's current `VALID_ORIGINS = new Set(['architect',
// 'human-directed'])` + `validatedOrigin` fallback, which today silently
// reports ANY manifest.origin outside that set — including the legitimate
// `origin: 'triggered'` InitiativeOrigin value (manifest.ts's own
// INITIATIVE_ORIGINS already includes 'triggered') — as 'architect'. A
// triggered run must be honestly distinguishable from an architect run.

test('a manifest with origin: "triggered" is reported as origin "triggered", not silently coerced to "architect"', () => {
  const root = makeTmp();
  try {
    // Path 1: buildRun — origin resolution prefers the cycle.start event's
    // metadata.origin (findOrigin) over manifest.origin; set both so either
    // resolution strategy is pinned.
    const initId = 'INIT-2026-01-01-triggered-origin';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-triggered-origin';
    const manifestPath = writeManifestFixture(root, 'done', initId, {
      cycle_id: cycleId,
      flow_id: 'forge-develop',
      origin: 'triggered',
    });
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'triggered' }),
      ev('orchestrator', 'end', 'cycle.end', { status: 'done' }),
    ]);
    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });
    assert.equal(
      run.origin,
      'triggered',
      `today VALID_ORIGINS silently coerces this to 'architect' — a triggered run must stay honestly distinguishable from an architect run; got ${run.origin}`,
    );

    // Path 2: makePlannedRun — origin read straight off manifest frontmatter,
    // no events at all.
    const plannedId = 'INIT-2026-01-01-triggered-origin-planned';
    const plannedPath = writeManifestFixture(root, 'pending', plannedId, { origin: 'triggered' });
    const plannedRun = aggregateRun({ root, queueState: 'pending', manifestPath: plannedPath, nowMs: Date.now() });
    assert.equal(
      plannedRun.origin,
      'triggered',
      `makePlannedRun's independent VALID_ORIGINS check has the SAME bug — got ${plannedRun.origin}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 6 — derivation is pure: asking for trigger provenance writes NO file
// ---------------------------------------------------------------------------
// Mirrors orchestrator/trigger-harness-guard.test.ts's "COMPLETE effect set"
// pattern. Kills any implementation that persists a NEW cached/materialized
// trigger record to disk (violating "no new stored run object" — ADR-027).

test('reading a triggered run\'s trigger provenance (aggregateRun + listRuns) writes NO new file anywhere under root', () => {
  const root = makeTmp();
  try {
    planFlow(root, 'worker-purity', 'test-project');
    mintAndDeriveRun(root, {
      target: { kind: 'flow', ref: 'worker-purity' },
      origin: 'cron',
      triggeredBy: 'cron:worker-purity',
      payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
    });

    const before = listAllFilesRec(root);

    // Re-derive the SAME run's trigger provenance twice more, via both
    // single-run and whole-tree aggregation — the two real read paths
    // GET /api/runs/<id> and GET /api/runs use.
    const queueRoot = join(root, '_queue');
    const paths = getPaths(queueRoot);
    const files = readdirSync(paths.pending).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1, 'sanity: exactly one minted manifest');
    const manifestPath = join(paths.pending, files[0]);

    const run1 = aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });
    assert.ok(run1.trigger, 'sanity: the fixture actually carries trigger provenance to read');
    listRuns(root, Date.now());

    const after = listAllFilesRec(root);
    assert.deepEqual(
      after,
      before,
      `reading trigger provenance must be a pure derivation — no new file may appear.\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(after)}`,
    );
  } finally {
    cleanup(root);
  }
});
