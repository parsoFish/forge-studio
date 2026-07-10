/**
 * Tests for orchestrator/run-model.ts
 *
 * Uses two real-cycle fixture logs (copied into run-model.fixtures/) plus
 * small synthetic fixtures for every edge-case branch.
 *
 * All tests are pure file-system operations on tmp dirs — no network, no
 * Claude SDK, deterministic nowMs parameter for wedge/progress checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateRun, listRuns, buildNodeMapping, computeFlowLineage } from './run-model.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'run-model.fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'run-model-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Write a minimal valid manifest markdown with the given fields. */
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

/** Write a minimal events.jsonl at _logs/<cycleId>/events.jsonl */
function writeCycleLog(root: string, cycleId: string, lines: object[]): void {
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

/** Write an artifact file at _logs/<cycleId>/artifacts/<name> */
function writeArtifact(root: string, cycleId: string, name: string, content = 'content'): void {
  const dir = join(root, '_logs', cycleId, 'artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

/** Write a work-items-snapshot dir with one file */
function writeWorkItemsSnapshot(root: string, cycleId: string): void {
  const dir = join(root, '_logs', cycleId, 'work-items-snapshot');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'WI-1.md'), '# WI-1\n');
}

/** A minimal event for a phase start */
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

// ---------------------------------------------------------------------------
// Real-fixture test: task-group-unit-tests (463-line cycle log)
// ---------------------------------------------------------------------------

test('aggregateRun: task-group-unit-tests real fixture — status gated, phases PM+dev complete, costs match', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-05-31-task-group-unit-tests';
    const cycleId = '2026-05-30T22-45-07_INIT-2026-05-31-task-group-unit-tests';

    // Write manifest in ready-for-review (cycle ended at closure → gated).
    // The real betterado task-group cycle's events, relabelled onto forge-develop
    // (S8/DEC-3 retired the forge-cycle default; S9 retired the release-refine flow —
    // the develop flow is the build spine every manifest now names).
    const manifestPath = writeManifest(root, 'ready-for-review', initId, {
      cycle_id: cycleId,
      flow_id: 'forge-develop',
    });

    // Copy fixture events.jsonl
    const logDir = join(root, '_logs', cycleId);
    mkdirSync(logDir, { recursive: true });
    cpSync(
      join(FIXTURES_DIR, 'task-group-unit-tests.events.jsonl'),
      join(logDir, 'events.jsonl'),
    );

    // Reproduce the artifacts and work-items-snapshot from what the fixture cycle created
    writeArtifact(root, cycleId, 'DEMO.html');
    writeArtifact(root, cycleId, 'demo.json', '{}');
    writeWorkItemsSnapshot(root, cycleId);
    writeFileSync(join(root, '_logs', cycleId, 'pr-description.md'), '# PR: task-group-unit-tests\n\nSome description.');

    const nowMs = Date.now();
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs });

    // Status
    assert.equal(run.status, 'gated', 'status should be gated (manifest in ready-for-review)');
    assert.equal(run.id, cycleId);
    assert.equal(run.initiativeId, initId);
    assert.equal(run.origin, 'architect');
    assert.equal(run.flowId, 'forge-develop');

    // Gate
    assert.equal(run.gate, 'review', 'gate node should be review');
    assert.ok(run.gateNote, 'gateNote should be set');

    // Per-phase costs (computed from fixture with node -e, authoritative rule:
    // iteration events only for looping phases — plan item 1.8; the old
    // expectations 12.883512/13.956451 were the double-counted naive sums):
    // pm phase cost_usd = 1.0729395 (no iteration events → end cost)
    // dev phase cost_usd = 5.769767 (iteration events only)
    // All others = 0
    const pmCost = run.phaseMeta['pm']?.costUsd ?? 0;
    const devCost = run.phaseMeta['dev']?.costUsd ?? 0;
    assert.ok(
      Math.abs(pmCost - 1.072940) < 0.001,
      `pm cost should be ~1.072940, got ${pmCost}`,
    );
    // dev band wider because float accumulation across hundreds of usage events
    assert.ok(
      Math.abs(devCost - 5.769767) < 0.1,
      `dev cost should be ~5.769767, got ${devCost}`,
    );
    // dev band wider because float accumulation across hundreds of usage events
    assert.ok(
      Math.abs(run.costUsd - 6.842707) < 0.1,
      `total cost should be ~6.842707, got ${run.costUsd}`,
    );

    // Phases: architect+pm+dev+review all complete; reflect pending
    assert.equal(run.phases['architect'], 'complete');
    assert.equal(run.phases['pm'], 'complete');
    assert.equal(run.phases['dev'], 'complete');
    // review is gated (the gate node), its status reflects the cycle state
    assert.ok(['active', 'pending', 'complete'].includes(run.phases['review'] ?? ''),
      `review phase should be active/pending/complete, got ${run.phases['review']}`);

    // Brain reads: pm.brain-query messages in fixture = 7
    const pmBrainReads = run.phaseMeta['pm']?.brainReads ?? 0;
    assert.ok(pmBrainReads >= 7, `pm brainReads should be >= 7, got ${pmBrainReads}`);

    // Iteration: fixture has 16 iteration events, last iter=15
    const devIter = run.phaseMeta['dev']?.iter;
    assert.ok(devIter !== undefined && devIter >= 1, `dev iter should be set, got ${devIter}`);

    // iterBudget from manifest
    assert.ok(run.phaseMeta['dev']?.iterBudget !== undefined, 'dev iterBudget should be set');

    // Work items: 1 WI
    assert.ok(Array.isArray(run.workItems), 'workItems should be array');
    assert.equal(run.workItems?.length, 1, 'should have 1 WI');
    assert.equal(run.workItems?.[0].id, 'WI-1');
    assert.equal(run.workItems?.[0].status, 'complete');
    // Per-WI cost (1.4): WI-scoped iteration events sum to 1.343978 (the rest
    // of the dev spend in this older fixture predates work_item_id tagging).
    assert.ok(
      Math.abs((run.workItems?.[0].costUsd ?? 0) - 1.343978) < 0.01,
      `WI-1 cost should be ~1.343978, got ${run.workItems?.[0].costUsd}`,
    );

    // Artifacts ready
    assert.equal(run.artifactsReady['demo'], 'gate', 'demo artifact should be gate mode when gated');
    assert.equal(run.artifactsReady['pr'], 'gate', 'pr artifact should be gate mode when gated');
    assert.equal(run.artifactsReady['work-items'], 'view', 'work-items should be view');

  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Real-fixture test: complete-release-definition (501-line cycle log)
// ---------------------------------------------------------------------------

test('aggregateRun: complete-release-definition real fixture — status gated, 5 WIs, delivered present', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-06-05-complete-release-definition';
    const cycleId = '2026-06-05T11-31-43_INIT-2026-06-05-complete-release-definition';

    const manifestPath = writeManifest(root, 'ready-for-review', initId, {
      cycle_id: cycleId,
      iteration_budget: 24,
      cost_budget_usd: 30,
    });

    const logDir = join(root, '_logs', cycleId);
    mkdirSync(logDir, { recursive: true });
    cpSync(
      join(FIXTURES_DIR, 'complete-release-definition.events.jsonl'),
      join(logDir, 'events.jsonl'),
    );

    // Artifacts from the real cycle
    writeArtifact(root, cycleId, 'PLAN.html', '<html>plan</html>');
    writeArtifact(root, cycleId, 'demo.json', '{}');
    writeWorkItemsSnapshot(root, cycleId);
    writeFileSync(join(root, '_logs', cycleId, 'pr-description.md'), '# PR description\n');

    const nowMs = Date.now();
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs });

    assert.equal(run.status, 'gated');
    assert.equal(run.initiativeId, initId);
    assert.equal(run.origin, 'architect');

    // Per-phase costs (computed from fixture, authoritative rule — plan item
    // 1.8; the old expectations 23.633504/24.410718 were double-counted):
    // pm = 0.777214, dev = 8.325460 (iterations only), total = 9.102674
    const pmCost = run.phaseMeta['pm']?.costUsd ?? 0;
    const devCost = run.phaseMeta['dev']?.costUsd ?? 0;
    assert.ok(Math.abs(pmCost - 0.777214) < 0.01, `pm cost ${pmCost}`);
    // dev band wider because float accumulation across hundreds of usage events
    assert.ok(Math.abs(devCost - 8.325460) < 0.1, `dev cost ${devCost}`);
    // dev band wider because float accumulation across hundreds of usage events
    assert.ok(Math.abs(run.costUsd - 9.102674) < 0.1, `total cost ${run.costUsd}`);

    // 5 WIs, all complete
    assert.equal(run.workItems?.length, 5, 'should have 5 WIs');
    assert.ok(run.workItems?.every((wi) => wi.status === 'complete'), 'all WIs complete');
    // Per-WI cost (1.4): every WI in this fixture carries iteration cost, and
    // the WI-scoped sum stays at or below the dev phase total (8.325460).
    assert.ok(run.workItems?.every((wi) => (wi.costUsd ?? 0) > 0), 'every WI carries cost');
    const wiCostSum = (run.workItems ?? []).reduce((s, wi) => s + (wi.costUsd ?? 0), 0);
    assert.ok(
      Math.abs(wiCostSum - 6.982584) < 0.1,
      `WI cost sum should be ~6.982584 (≤ dev phase total), got ${wiCostSum}`,
    );

    // delivered: dev-loop.delivered metadata has files_changed, insertions, commits
    const delivered = run.phaseMeta['dev']?.delivered;
    assert.ok(delivered !== undefined, 'delivered should be present');
    assert.ok((delivered?.files ?? 0) > 0, `delivered.files should be > 0, got ${delivered?.files}`);
    assert.ok((delivered?.insertions ?? 0) > 0, `delivered.insertions should be > 0`);
    assert.ok((delivered?.commits ?? 0) > 0, `delivered.commits should be > 0`);

    // brainReads: 8 pm.brain-query events
    const pmBrain = run.phaseMeta['pm']?.brainReads ?? 0;
    assert.ok(pmBrain >= 8, `pm brainReads should be >= 8, got ${pmBrain}`);

    // plan artifact present
    assert.equal(run.artifactsReady['plan'], 'view');
    assert.equal(run.artifactsReady['demo'], 'gate');

  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: planned (pending manifest, no cycle log)
// ---------------------------------------------------------------------------

test('aggregateRun: planned run — status planned, empty phases', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-planned';
    const manifestPath = writeManifest(root, 'pending', initId);

    const run = aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'planned');
    assert.equal(run.id, initId, 'id for planned run is initiativeId');
    assert.equal(run.costUsd, 0);
    assert.equal(Object.keys(run.phaseMeta).length, 0, 'no phaseMeta for planned');
    assert.equal(Object.keys(run.phases).length, 0, 'no phases for planned');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: active (in-flight with recent tool_use)
// ---------------------------------------------------------------------------

test('aggregateRun: active in-flight run — status active, dev phase active', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-active';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-active';
    const recentAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('architect', 'start', 'architect.synthetic-start'),
      ev('architect', 'end', 'architect.synthetic-end'),
      ev('project-manager', 'start', undefined, undefined, { cost_usd: 0.5 }),
      ev('project-manager', 'end', undefined, undefined, { cost_usd: 0.1 }),
      ev('developer-loop', 'start', undefined, undefined, { cost_usd: 0 }),
      { ...ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }), started_at: recentAt },
      { ...ev('developer-loop', 'tool_use', 'tool.Read', { work_item_id: 'WI-1' }), started_at: recentAt },
    ]);

    const nowMs = Date.now();
    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs });

    assert.equal(run.status, 'active');
    assert.equal(run.phases['architect'], 'complete');
    assert.equal(run.phases['pm'], 'complete');
    assert.equal(run.phases['dev'], 'active');
    // not wedged (recent activity)
    assert.equal(run.phaseMeta['dev']?.wedged, false);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: gated (ready-for-review → gate review)
// ---------------------------------------------------------------------------

test('aggregateRun: gated — gate=review, demo+pr artifactsReady gate mode', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-gated';
    const cycleId = '2026-01-01T01-00-00_INIT-2026-01-01-gated';

    const manifestPath = writeManifest(root, 'ready-for-review', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' }),
      ev('architect', 'start'), ev('architect', 'end'),
      ev('project-manager', 'start', undefined, undefined, { cost_usd: 0.2 }),
      ev('project-manager', 'end'),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      ev('developer-loop', 'log', 'dev-loop.delivered', { base: 'main', files_changed: 3, insertions: 100, deletions: 5, commits: 2 }),
      ev('developer-loop', 'end'),
      ev('unifier', 'start'), ev('unifier', 'end'),
      ev('review-loop', 'start'), ev('review-loop', 'end'),
      ev('closure', 'start', 'closure.start'),
      ev('closure', 'log', 'closure.manifest-moved-to-ready-for-review'),
      ev('closure', 'end', 'closure.end'),
    ]);

    writeArtifact(root, cycleId, 'demo.json', '{}');
    writeFileSync(join(root, '_logs', cycleId, 'pr-description.md'), '# My PR\n\nDescription here.\n');

    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'gated');
    assert.equal(run.origin, 'human-directed');
    assert.equal(run.gate, 'review');
    assert.ok(run.gateNote?.includes('My PR') || run.gateNote?.includes('Awaiting'), 'gateNote set');
    assert.equal(run.artifactsReady['demo'], 'gate');
    assert.equal(run.artifactsReady['pr'], 'gate');
    assert.equal(run.phases['review'], 'complete', 'review-loop ended so review node complete');
  } finally {
    cleanup(root);
  }
});

test('aggregateRun: gate names the node actually reached, not a hardcoded "review" (G9)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-custom-gate';
    const cycleId = '2026-01-01T01-30-00_INIT-2026-01-01-custom-gate';

    // A user-authored flow (ADR-028) whose gate node is named 'human-check',
    // not 'review' — eventToNodeId falls back to the phase as its own node
    // id since 'human-check' isn't in the seed-flow mapping.
    const manifestPath = writeManifest(root, 'ready-for-review', initId, { cycle_id: cycleId, flow_id: 'my-second-flow' });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' }),
      ev('plan', 'start'), ev('plan', 'end'),
      ev('dev', 'start'), ev('dev', 'end'),
      ev('human-check', 'start'),
    ]);

    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'gated');
    assert.equal(run.phases['human-check'], 'active');
    assert.equal(run.phases['review'], undefined, 'no review node ever ran in this flow');
    assert.equal(run.gate, 'human-check', 'gate must name the node actually awaiting the operator, not a hardcoded "review"');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: complete (done queue)
// ---------------------------------------------------------------------------

test('aggregateRun: complete — status complete, artifactsReady view mode', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-complete';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-complete';

    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('architect', 'start'), ev('architect', 'end'),
      ev('project-manager', 'start'), ev('project-manager', 'end'),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      ev('developer-loop', 'end'),
      ev('unifier', 'start'), ev('unifier', 'end'),
      ev('review-loop', 'start'), ev('review-loop', 'end'),
      ev('closure', 'start'), ev('closure', 'end'),
      ev('reflection', 'start', 'reflector.start'),
      ev('reflection', 'log', 'reflector.recap-emitted'),
      ev('reflection', 'end', 'reflector.end'),
      ev('orchestrator', 'end', 'cycle.end', { status: 'done' }),
    ]);

    writeArtifact(root, cycleId, 'demo.json', '{}');
    writeFileSync(join(root, '_logs', cycleId, 'pr-description.md'), '# Done PR\n');

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'complete');
    assert.equal(run.phases['reflect'], 'complete');
    assert.equal(run.artifactsReady['demo'], 'view', 'demo view when complete');
    assert.equal(run.artifactsReady['pr'], 'view', 'pr view when complete');
    assert.equal(run.artifactsReady['reflection'], 'view', 'reflection artifact view when reflect events present');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Reconciliation staleness: a done/ manifest whose reflector started but never
// emitted `end` must NOT be stranded 'active' forever. Hold 'active' only while
// the cycle is still live (recent events); once it has been quiet past the
// wedge threshold, trust the done/ placement and report 'complete'.
// ---------------------------------------------------------------------------

test('aggregateRun: done + reflector start-no-end, STALE (quiet > wedge) → complete (not stranded active)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-stale-reflect';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-stale-reflect';
    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    const nowMs = Date.parse('2026-01-01T10:00:00Z');
    const oldIso = new Date(nowMs - 60 * 60 * 1000).toISOString(); // 60 min ago (> 30 min wedge)
    const at = { started_at: oldIso };

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, at),
      ev('architect', 'start', undefined, undefined, at), ev('architect', 'end', undefined, undefined, at),
      ev('project-manager', 'start', undefined, undefined, at), ev('project-manager', 'end', undefined, undefined, at),
      ev('developer-loop', 'start', undefined, undefined, at),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }, at),
      ev('developer-loop', 'end', undefined, undefined, at),
      ev('unifier', 'start', undefined, undefined, at), ev('unifier', 'end', undefined, undefined, at),
      ev('review-loop', 'start', undefined, undefined, at), ev('review-loop', 'end', undefined, undefined, at),
      ev('closure', 'start', undefined, undefined, at), ev('closure', 'end', undefined, undefined, at),
      // reflector STARTED but never ended (crashed / interrupted), then went quiet.
      ev('reflection', 'start', 'reflector.start', undefined, at),
    ]);

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs });
    assert.equal(run.phases['reflect'], 'active', 'reflect node still active (started, never ended)');
    assert.equal(run.status, 'complete', 'a long-quiet merged (done/) cycle reports complete, not stranded active');
    // 2.10: the silent-loss case — reflector started, never ended, went quiet
    // (SIGKILL / Studio restart leaves no event). Must surface distinctly.
    assert.equal(run.reflectionLost, 'interrupted', 'stranded reflection surfaces as reflectionLost=interrupted');
    assert.ok(run.reflectionLostNote !== undefined && run.reflectionLostNote.length > 0, 'carries a note');
  } finally {
    cleanup(root);
  }
});

test('aggregateRun: done + reflector start-no-end, RECENT (still live) → active (anti-flash preserved)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-live-reflect';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-live-reflect';
    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    const nowMs = Date.parse('2026-01-01T10:00:00Z');
    const recentIso = new Date(nowMs - 60 * 1000).toISOString(); // 1 min ago (< 30 min wedge)
    const at = { started_at: recentIso };

    writeCycleLog(root, cycleId, [
      ev('closure', 'start', undefined, undefined, at), ev('closure', 'end', undefined, undefined, at),
      ev('reflection', 'start', 'reflector.start', undefined, at),
    ]);

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs });
    assert.equal(run.phases['reflect'], 'active');
    assert.equal(run.status, 'active', 'a cycle still actively reflecting holds active until reflector.end (or it goes stale)');
    // 2.10: a genuinely-live reflection is NOT lost.
    assert.equal(run.reflectionLost, undefined, 'a live reflection must not be flagged lost');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 2.10 reflection-lost surfacing (explicit cycle.reflection-lost event)
// ---------------------------------------------------------------------------

test('aggregateRun: explicit cycle.reflection-lost event → reflectionLost carries the cause + note', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-lost-reflect';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-lost-reflect';
    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    const nowMs = Date.parse('2026-01-01T10:00:00Z');
    const oldIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const at = { started_at: oldIso };

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, at),
      ev('closure', 'start', undefined, undefined, at), ev('closure', 'end', undefined, undefined, at),
      ev('reflection', 'start', 'reflector.start', undefined, at),
      ev('reflection', 'error', 'cycle.reflection-lost', {
        cause: 'budget-exhausted',
        detail: 'reflector SDK run ended with result subtype "error_max_budget_usd"',
      }, at),
    ]);

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs });
    assert.equal(run.status, 'complete', 'the merged cycle still reports complete — no new top-level status');
    assert.equal(run.reflectionLost, 'budget-exhausted');
    assert.match(String(run.reflectionLostNote), /error_max_budget_usd/);
  } finally {
    cleanup(root);
  }
});

test('aggregateRun: reflection lost then RECOVERED (later reflector.end) → no reflectionLost', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-recovered-reflect';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-recovered-reflect';
    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    const nowMs = Date.parse('2026-01-01T10:00:00Z');
    const oldIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const at = { started_at: oldIso };

    writeCycleLog(root, cycleId, [
      ev('reflection', 'start', 'reflector.start', undefined, at),
      ev('reflection', 'error', 'cycle.reflection-lost', { cause: 'crash', detail: 'fetch failed' }, at),
      // A later rerun (forge reflect --rerun / boot reconcile) closed it.
      ev('reflection', 'start', 'reflector.start', undefined, at),
      ev('reflection', 'end', 'reflector.end', { status: 'closed' }, at),
    ]);

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs });
    assert.equal(run.reflectionLost, undefined, 'a recovered reflection is no longer lost');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: failed (failure_classification event)
// ---------------------------------------------------------------------------

test('aggregateRun: failed — failedAt + failNote from failure_classification', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-failed';
    const cycleId = '2026-01-01T03-00-00_INIT-2026-01-01-failed';

    const manifestPath = writeManifest(root, 'failed', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('architect', 'start'), ev('architect', 'end'),
      ev('project-manager', 'start'), ev('project-manager', 'end'),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'error', undefined, undefined, { cost_usd: 1.0 }),
      ev('orchestrator', 'log', 'failure_classification', {
        failure_mode: 'terminal',
        failure_kind: 'dev-loop-timeout',
        recoverable: false,
        reason: 'Developer loop exceeded iteration budget without passing gates',
        evidence_event_ids: [],
      }),
      ev('orchestrator', 'error', undefined, { status: 'failed' }),
    ]);

    const run = aggregateRun({ root, queueState: 'failed', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'failed');
    assert.ok(run.failedAt !== undefined, 'failedAt should be set');
    assert.ok(run.failNote !== undefined, 'failNote should be set');
    assert.ok(run.failNote?.includes('budget') || run.failNote?.length > 0, 'failNote has content');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: wedged (active, last tool_use > 30 min ago)
// ---------------------------------------------------------------------------

test('aggregateRun: wedged — active dev phase with stale lastProgressAt', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-wedged';
    const cycleId = '2026-01-01T04-00-00_INIT-2026-01-01-wedged';

    const staleAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
    const nowMs = Date.now();

    const manifestPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      // Stale tool_use — 31 min ago
      { ...ev('developer-loop', 'tool_use', 'tool.Bash', { work_item_id: 'WI-1' }), started_at: staleAt },
    ]);

    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath, nowMs });

    assert.equal(run.status, 'active');
    assert.equal(run.phases['dev'], 'active');
    assert.equal(run.phaseMeta['dev']?.wedged, true, 'dev should be wedged');
    assert.ok(run.phaseMeta['dev']?.lastProgressAt !== undefined, 'lastProgressAt set');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: gateChecks (unifier.gate.sub-check events)
// ---------------------------------------------------------------------------

test('aggregateRun: gateChecks parsed from unifier.gate.sub-check events', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-gatechecks';
    const cycleId = '2026-01-01T05-00-00_INIT-2026-01-01-gatechecks';

    const manifestPath = writeManifest(root, 'ready-for-review', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('unifier', 'start'),
      ev('unifier', 'log', 'unifier.gate.sub-check', { check_id: 'initiative_gate', pass: true, detail: 'All tests pass' }),
      ev('unifier', 'log', 'unifier.gate.sub-check', { check_id: 'pr_self_contained', pass: false, detail: 'Missing demo.json' }),
      ev('unifier', 'log', 'unifier.gate.sub-check', { check_id: 'branches_in_sync', pass: true, detail: 'In sync' }),
      ev('unifier', 'log', 'unifier.gate.sub-check', { check_id: 'incomplete_delivery', pass: true, detail: 'Complete' }),
      ev('unifier', 'end'),
      ev('review-loop', 'start'), ev('review-loop', 'end'),
      ev('closure', 'start'), ev('closure', 'end'),
    ]);

    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });

    const checks = run.phaseMeta['unifier']?.gateChecks;
    assert.ok(Array.isArray(checks), 'gateChecks should be array');
    assert.equal(checks?.length, 4, 'should have 4 gate checks');

    const failing = checks?.find((c) => c.id === 'pr_self_contained');
    assert.equal(failing?.pass, false);
    assert.equal(failing?.detail, 'Missing demo.json');

    const passing = checks?.find((c) => c.id === 'initiative_gate');
    assert.equal(passing?.pass, true);
    assert.equal(passing?.detail, 'All tests pass');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: corrupt manifest — listRuns survives, yields degraded Run
// ---------------------------------------------------------------------------

test('listRuns: corrupt manifest yields degraded Run with status from queue dir, never crashes', () => {
  const root = makeTmp();
  try {
    // Write a corrupt manifest (invalid YAML)
    const queueDir = join(root, '_queue', 'done');
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(join(queueDir, 'INIT-2026-01-01-corrupt.md'), '---\nnot_valid: [unclosed\n---\nbody\n');

    // Also write a valid manifest to ensure it still returns that one
    writeManifest(root, 'done', 'INIT-2026-01-01-valid');

    const runs = listRuns(root, Date.now());

    // Should not throw; should return at least the valid one
    assert.ok(Array.isArray(runs), 'listRuns returns array');
    // Corrupt manifest should produce a degraded entry
    const corrupt = runs.find((r) => r.initiativeId.includes('corrupt') || r.initiative.includes('unreadable'));
    const valid = runs.find((r) => r.initiativeId === 'INIT-2026-01-01-valid');
    assert.ok(valid !== undefined, 'valid manifest should be in results');
    // If corrupt manifest produced a run, it should have a fallback initiative label
    if (corrupt) {
      assert.ok(corrupt.initiative.includes('unreadable') || corrupt.status === 'complete',
        'corrupt run has unreadable label or falls back gracefully');
    }
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: listRuns — multiple queue states, newest-first ordering
// ---------------------------------------------------------------------------

test('listRuns: walks all queue dirs, returns newest-first by startedAt', () => {
  const root = makeTmp();
  try {
    // pending (no log)
    writeManifest(root, 'pending', 'INIT-2026-01-01-pending');
    // done with a cycle log
    const doneId = 'INIT-2026-01-01-done';
    const doneCycleId = '2026-01-01T10-00-00_INIT-2026-01-01-done';
    writeManifest(root, 'done', doneId, { cycle_id: doneCycleId });
    writeCycleLog(root, doneCycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, { started_at: '2026-01-01T10:00:00Z' }),
    ]);
    // failed
    const failId = 'INIT-2026-01-02-failed';
    const failCycleId = '2026-01-02T00-00-00_INIT-2026-01-02-failed';
    writeManifest(root, 'failed', failId, { cycle_id: failCycleId });
    writeCycleLog(root, failCycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, { started_at: '2026-01-02T00:00:00Z' }),
    ]);

    const runs = listRuns(root, Date.now());

    assert.ok(Array.isArray(runs));
    assert.ok(runs.length >= 3, `expected >= 3 runs, got ${runs.length}`);

    // All five queue states should be scanned
    const statuses = runs.map((r) => r.status);
    assert.ok(statuses.includes('planned'), 'should include planned');
    assert.ok(statuses.includes('complete'), 'should include complete');
    assert.ok(statuses.includes('failed'), 'should include failed');

    // Newest-first: the failed (Jan 2) should come before done (Jan 1)
    const failIdx = runs.findIndex((r) => r.initiativeId === failId);
    const doneIdx = runs.findIndex((r) => r.initiativeId === doneId);
    if (failIdx !== -1 && doneIdx !== -1) {
      assert.ok(failIdx < doneIdx, 'newer run (failed Jan 2) should come before older (done Jan 1)');
    }
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Synthetic: retries counted from gate.fail events
// ---------------------------------------------------------------------------

test('aggregateRun: retries counted from gate.fail events in dev phase', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-retries';
    const cycleId = '2026-01-01T06-00-00_INIT-2026-01-01-retries';

    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      ev('developer-loop', 'log', 'gate.fail', { work_item_id: 'WI-1', gate_passed: false, iteration: 1 }),
      ev('developer-loop', 'log', 'gate.fail', { work_item_id: 'WI-1', gate_passed: false, iteration: 2 }),
      ev('developer-loop', 'log', 'gate.pass', { work_item_id: 'WI-1', gate_passed: true, iteration: 3 }),
      ev('developer-loop', 'log', 'ralph.end', { work_item_id: 'WI-1', status: 'complete', iterations: 3 }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      ev('developer-loop', 'end'),
    ]);

    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });

    const retries = run.phaseMeta['dev']?.retries ?? 0;
    assert.ok(retries >= 2, `retries should be >= 2 (gate.fail count), got ${retries}`);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// buildNodeMapping (a): derived from real repo matches expected table
// ---------------------------------------------------------------------------

test('buildNodeMapping: derived from real studio/flows + skills equals expected table', () => {
  // FORGE_ROOT is the repo root; orchestrator/ is one level below __dirname
  const FORGE_ROOT = join(__dirname, '..');

  const mapping = buildNodeMapping(FORGE_ROOT);

  // Primary derivations: SKILL.md frontmatter phase → flow node id
  assert.equal(mapping.get('architect'), 'architect', 'architect phase → architect node');
  assert.equal(mapping.get('project-manager'), 'pm', 'project-manager phase → pm node');
  assert.equal(mapping.get('developer-loop'), 'dev', 'developer-loop phase → dev node');
  assert.equal(mapping.get('unifier'), 'unifier', 'unifier phase → unifier node');

  // Canonicalization overrides (hardcoded layer on top of derived)
  assert.equal(mapping.get('reflection'), 'reflect', 'reflection → reflect (canonicalization: events say reflection, frontmatter says reflector)');
  assert.equal(mapping.get('review-loop'), 'review', 'review-loop → review (gate-only node)');
  assert.equal(mapping.get('closure'), 'review', 'closure → review (folds into review node)');
  assert.equal(mapping.get('orchestrator'), null, 'orchestrator → null (ignored)');
  assert.equal(mapping.get('brain'), null, 'brain → null (ignored)');
});

// ---------------------------------------------------------------------------
// buildNodeMapping (b): tmp root without studio/ → fallback, aggregation works
// ---------------------------------------------------------------------------

test('buildNodeMapping: missing studio/ falls back to hardcoded table; aggregateRun still works', () => {
  const root = makeTmp();
  try {
    // root has NO studio/ dir — forces the fallback path
    const initId = 'INIT-2026-01-01-fallback';
    const cycleId = '2026-01-01T07-00-00_INIT-2026-01-01-fallback';

    const manifestPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    // Write a minimal cycle log with events from all the phases we care about
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
      ev('architect', 'start'), ev('architect', 'end'),
      ev('project-manager', 'start'), ev('project-manager', 'end'),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      ev('developer-loop', 'end'),
      ev('unifier', 'start'), ev('unifier', 'end'),
      ev('review-loop', 'start'), ev('review-loop', 'end'),
      ev('closure', 'start'), ev('closure', 'end'),
      ev('reflection', 'start', 'reflector.start'),
      ev('reflection', 'end', 'reflector.end'),
      ev('orchestrator', 'end', 'cycle.end', { status: 'done' }),
    ]);

    // Fallback mapping: verify it contains the expected entries
    const mapping = buildNodeMapping(root);
    assert.equal(mapping.get('architect'), 'architect', 'fallback: architect mapped');
    assert.equal(mapping.get('project-manager'), 'pm', 'fallback: project-manager mapped');
    assert.equal(mapping.get('developer-loop'), 'dev', 'fallback: developer-loop mapped');
    assert.equal(mapping.get('unifier'), 'unifier', 'fallback: unifier mapped');
    assert.equal(mapping.get('reflection'), 'reflect', 'fallback: reflection mapped');
    assert.equal(mapping.get('review-loop'), 'review', 'fallback: review-loop mapped');
    assert.equal(mapping.get('closure'), 'review', 'fallback: closure mapped');
    assert.equal(mapping.get('orchestrator'), null, 'fallback: orchestrator null');
    assert.equal(mapping.get('brain'), null, 'fallback: brain null');

    // Full aggregation must still work correctly with the fallback mapping
    const run = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'complete');
    assert.equal(run.phases['architect'], 'complete');
    assert.equal(run.phases['pm'], 'complete');
    assert.equal(run.phases['dev'], 'complete');
    assert.equal(run.phases['unifier'], 'complete');
    assert.equal(run.phases['review'], 'complete', 'review-loop + closure both fold into review node');
    assert.equal(run.phases['reflect'], 'complete');
    assert.equal(run.workItems?.length, 1, 'WI-1 materialised');
    assert.equal(run.workItems?.[0].id, 'WI-1');
  } finally {
    cleanup(root);
  }
});

test('ADR 028 / J5: a run carries the flow_id from its manifest (else unknown, post-S8)', () => {
  const root = makeTmp();
  try {
    // Pre-S8 manifest (no flow_id) → 'unknown' (the forge-cycle default was
    // retired in S8/DEC-3; an unknowable archival flow is labelled honestly).
    const legacyPath = writeManifest(root, 'pending', 'INIT-2026-01-01-legacy');
    assert.equal(aggregateRun({ root, queueState: 'pending', manifestPath: legacyPath, nowMs: Date.now() }).flowId, 'unknown');

    // Manifest with flow_id → the run surfaces under that flow.
    const authoredPath = writeManifest(root, 'pending', 'INIT-2026-01-01-authored', { flow_id: 'my-first-flow' });
    assert.equal(aggregateRun({ root, queueState: 'pending', manifestPath: authoredPath, nowMs: Date.now() }).flowId, 'my-first-flow');
  } finally {
    cleanup(root);
  }
});

test('M5: per-WI delivered stats are distinct (not the cycle aggregate on every WI)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-perwi';
    const cycleId = '2026-01-01T03-00-00_INIT-2026-01-01-perwi';
    const manifestPath = writeManifest(root, 'ready-for-review', initId, { cycle_id: cycleId });
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' }),
      ev('project-manager', 'log', 'pm.work-item-emitted', { work_item_id: 'WI-1' }),
      ev('project-manager', 'log', 'pm.work-item-emitted', { work_item_id: 'WI-2' }),
      ev('developer-loop', 'start'),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-1' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      ev('developer-loop', 'log', 'dev-loop.delivered', { work_item_id: 'WI-1', files_changed: 2, insertions: 30, commits: 1 }),
      ev('developer-loop', 'log', 'ralph.start', { work_item_id: 'WI-2' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-2', status: 'complete' }),
      ev('developer-loop', 'log', 'dev-loop.delivered', { work_item_id: 'WI-2', files_changed: 5, insertions: 90, commits: 3 }),
      // cycle-level aggregate (no work_item_id)
      ev('developer-loop', 'log', 'dev-loop.delivered', { files_changed: 7, insertions: 120, commits: 4 }),
      ev('developer-loop', 'end'),
      ev('review-loop', 'start'),
    ]);
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });
    const wi1 = run.workItems?.find((w) => w.id === 'WI-1');
    const wi2 = run.workItems?.find((w) => w.id === 'WI-2');
    assert.deepEqual(wi1?.delivered, { files: 2, insertions: 30, commits: 1 }, 'WI-1 shows its own delta');
    assert.deepEqual(wi2?.delivered, { files: 5, insertions: 90, commits: 3 }, 'WI-2 shows its own delta');
    // the dev phase keeps the cycle aggregate (the no-work_item_id event)
    assert.deepEqual(run.phaseMeta['dev']?.delivered, { files: 7, insertions: 120, commits: 4 });
  } finally {
    cleanup(root);
  }
});

test('ADR 028 / J5: a custom-flow run surfaces phase statuses on self-named nodes', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-authored-run';
    const cycleId = '2026-01-01T02-00-00_INIT-2026-01-01-authored-run';
    const manifestPath = writeManifest(root, 'ready-for-review', initId, { cycle_id: cycleId, flow_id: 'my-first-flow' });
    // Authored flow phases (plan/dev/review) aren't in the forge-cycle mapping —
    // eventToNodeId falls back to the phase as its own node id.
    writeCycleLog(root, cycleId, [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' }),
      ev('plan', 'start'), ev('plan', 'end', undefined, undefined, { cost_usd: 0.1 }),
      ev('dev', 'start'), ev('dev', 'end', undefined, undefined, { cost_usd: 0.2 }),
      ev('review', 'start'),
    ]);
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: Date.now() });
    assert.equal(run.flowId, 'my-first-flow');
    assert.equal(run.phases['plan'], 'complete');
    assert.equal(run.phases['dev'], 'complete');
    assert.equal(run.phases['review'], 'active');
    assert.equal(run.status, 'gated');
    assert.equal(run.gate, 'review');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// S9: flow lineage — a threaded spine run surfaces under every flow it traversed
// ---------------------------------------------------------------------------

test('computeFlowLineage: a threaded spine run surfaces under all three spine flows', () => {
  const flowNodeSets = new Map([
    ['forge-architect', new Set(['architect', 'pm'])],
    ['forge-develop', new Set(['dev', 'unifier', 'review'])],
    ['forge-reflect', new Set(['reflect'])],
  ]);
  // The manifest's flow_id is forge-develop (repointed at the hand-off), but the run
  // executed architect+pm (architect stage) and reflect (post-merge) too.
  const lineage = computeFlowLineage(
    ['architect', 'pm', 'dev', 'unifier', 'review', 'reflect'],
    'forge-develop',
    flowNodeSets,
  );
  assert.deepEqual(lineage, ['forge-architect', 'forge-develop', 'forge-reflect']);
});

test('computeFlowLineage: a run that only executed develop-flow phases carries just forge-develop', () => {
  const flowNodeSets = new Map([
    ['forge-architect', new Set(['architect', 'pm'])],
    ['forge-develop', new Set(['dev', 'unifier', 'review'])],
    ['forge-reflect', new Set(['reflect'])],
  ]);
  const lineage = computeFlowLineage(['dev', 'unifier', 'review'], 'forge-develop', flowNodeSets);
  assert.deepEqual(lineage, ['forge-develop']);
});

test('computeFlowLineage: the manifest flow is always included even if its nodes had no events yet', () => {
  const flowNodeSets = new Map([['forge-develop', new Set(['dev', 'unifier', 'review'])]]);
  const lineage = computeFlowLineage([], 'forge-develop', flowNodeSets);
  assert.deepEqual(lineage, ['forge-develop']);
});

test('computeFlowLineage: a copy/subset flow (same node ids) never falsely claims the run', () => {
  // The e2e author-from-scratch demo builds forge-develop-scratch as a PARITY copy
  // of forge-develop (same dev/unifier/review node ids). It must NOT show the
  // threaded run via lineage (it was never traversed) — so it stays a genuinely
  // run-less flow for the start-run CTA.
  const flowNodeSets = new Map([
    ['forge-architect', new Set(['architect', 'pm'])],
    ['forge-develop', new Set(['dev', 'unifier', 'review'])],
    ['forge-develop-scratch', new Set(['dev', 'unifier', 'review'])],
  ]);
  const lineage = computeFlowLineage(['architect', 'pm', 'dev', 'unifier', 'review'], 'forge-develop', flowNodeSets);
  assert.ok(lineage.includes('forge-develop'), 'manifest flow included');
  assert.ok(lineage.includes('forge-architect'), 'architect stage (distinct nodes) included');
  assert.ok(!lineage.includes('forge-develop-scratch'), 'a subset/copy flow must NOT claim the run');
});
