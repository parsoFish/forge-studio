/**
 * R2-04-F1 (ADR-041) — daemon-level chain integration.
 *
 * The per-seam unit tests inject a fake `startFlowRun`, so the WIRING between
 * the staged request, the REAL default dispatch (`enqueueFlowRun`), and the
 * scheduler's claim predicate (`listPending`) was untested. This test closes
 * that gap: it drives `drainFlowRunRequests` with its REAL default dispatch
 * (no injected double) and asserts the `on: flow-complete` chain repoints the
 * source initiative at a NON-forge-develop target flow and leaves it claimable
 * by the scheduler — i.e. `forge serve`'s sweep would start it on the next
 * tick. (The cycle EXECUTION itself is exercised by the verify:cycle harness,
 * which needs a real project repo + git; this test owns the queue-wiring half.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stageFlowRunRequest, drainFlowRunRequests } from '../../flow-run-requests.ts';
import { serializeManifest, parseManifest, type InitiativeManifest } from '../../manifest.ts';
import { getPaths, listPending } from '../../queue.ts';

function sourceManifest(): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-07-25-chain-src',
    class: 'code',
    acceptance_criteria: [],
    project: 'someproj',
    project_repo_path: '/tmp/someproj',
    created_at: '2026-07-25T00:00:00Z',
    iteration_budget: 30,
    cost_budget_usd: 10,
    phase: 'done',
    origin: 'architect',
    flow_id: 'forge-architect',
    cycle_id: '2026-07-25T00-00-00_INIT-2026-07-25-chain-src',
    body: '# source initiative (completed)',
  };
}

test('on:flow-complete chain → the REAL default dispatch repoints the source at a non-develop target flow, leaving it claimable', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-chain-daemon-'));
  const queueRoot = join(root, '_queue');
  try {
    const paths = getPaths(queueRoot);
    // A completed source initiative sits in done/ (a terminal state a chain
    // trigger legitimately re-runs a different flow from).
    mkdirSync(paths.done, { recursive: true });
    const src = sourceManifest();
    const donePath = join(paths.done, `${src.initiative_id}.md`);
    writeFileSync(donePath, serializeManifest(src));

    // Produce: the flow-runner would stage exactly this on the source flow's
    // terminal success (target = a NON-forge-develop flow).
    stageFlowRunRequest(
      {
        target: { kind: 'flow', ref: 'retro-flow' },
        origin: 'trigger',
        triggeredBy: 'forge-architect',
        sourceInitiativeId: src.initiative_id,
      },
      { queueRoot },
    );

    // Drain with the REAL default dispatch — no injected startFlowRun. This is
    // the produce→stage→drain→dispatch wiring the AC exercises end-to-end.
    const results = drainFlowRunRequests({ queueRoot });
    assert.deepEqual(results.map((r) => r.status), ['dispatched'], 'the chain request dispatched');

    // The source manifest is repointed at the target flow and moved to pending/.
    assert.ok(!existsSync(donePath), 'source manifest left done/');
    const pendingPath = join(paths.pending, `${src.initiative_id}.md`);
    assert.ok(existsSync(pendingPath), 'source manifest is now in pending/');
    const repointed = parseManifest(readFileSync(pendingPath, 'utf8'));
    assert.equal(repointed.flow_id, 'retro-flow', 'repointed at the target flow');
    assert.equal(repointed.phase, 'pending', 'claimable');
    // Cycle identity preserved (mechanism B): the same cycle_id threads through.
    assert.equal(repointed.cycle_id, src.cycle_id, 'the source cycle_id is preserved (no fork)');

    // The scheduler's OWN claim predicate now sees it — `forge serve` would
    // claim it on the next tick.
    const pending = listPending(paths);
    assert.ok(
      pending.includes(`${src.initiative_id}.md`),
      'the scheduler listPending() claim predicate returns the repointed initiative',
    );

    // The request file was consumed.
    const remaining = drainFlowRunRequests({ queueRoot });
    assert.equal(remaining.length, 0, 'no staged requests remain');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
