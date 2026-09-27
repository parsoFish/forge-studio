/**
 * Row 155 (bead forge-8vfn.8.1.43, ruling 1849) — a resumed/requeued run
 * transiently back in `_queue/pending/` must keep its cycle id and its real
 * phases/workItems, not the blank never-claimed-initiative shape.
 *
 * `forge-requeue.ts`'s Resume and Requeue actions (the ONLY two writers of
 * `_queue/pending/` for an ALREADY-claimed manifest) move the manifest back
 * to `pending/` to await the scheduler's next claim, but deliberately
 * PRESERVE `cycle_id` across that move — the resumed cycle runs against the
 * SAME cycle log (`packages/flows/forge-requeue.ts`'s step 3, "Atomic move to
 * pending/"). Before this fix, `run-model.ts`'s `aggregateRunWithMapping`
 * treated EVERY `pending`-queue manifest as a blank, never-run initiative
 * (`makePlannedRun`), regardless of whether it already carried a `cycle_id`.
 * That swapped the run's reported `id` from the cycle id (every other queue
 * state, and this same run a moment earlier while `in-flight`/`failed`,
 * reports it under) to the bare initiative id, and dropped its
 * phases/workItems entirely — which is what broke a caller (the flow
 * monitor, `apps/studio/app/flows/[id]/page.tsx`) still tracking the run by
 * cycle id: every id-keyed refresh (`refreshRuns`/`refreshActiveRun`) missed
 * during the pending window, and `RunControls`/`FlowTopology` had nothing
 * real to render.
 *
 * A separate, small file (not appended to the baselined
 * `run-model.test.ts`, `scripts/baselines/file-size.json` — a baseline is a
 * ceiling, never a licence to grow) so this row's regression test does not
 * push that file further over its exempted line count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun, listRuns } from '../../run-model.ts';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'run-model-pending-resume-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Write a minimal valid manifest markdown with the given fields — mirrors
 *  run-model.test.ts's own helper exactly (kept local so this file has no
 *  cross-file test-helper coupling to the baselined file). */
function writeManifest(
  dir: string, state: string, initId: string, extra: Record<string, unknown> = {},
): string {
  const queueDir = join(dir, '_queue', state);
  mkdirSync(queueDir, { recursive: true });
  const fields: Record<string, unknown> = {
    initiative_id: initId,
    project: 'test-project',
    project_repo_path: '/tmp/test',
    created_at: '2026-01-01T00:00:00Z',
    iteration_budget: 10,
    cost_budget_usd: 5, class: 'code',
    phase: state,
    origin: 'architect',
    ...extra,
  };
  let frontmatter = '---\n';
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    frontmatter += typeof v === 'string' ? `${k}: '${v}'\n` : `${k}: ${JSON.stringify(v)}\n`;
  }
  frontmatter += '---\n\n## Body\n\nTest initiative.\n';
  const manifestPath = join(queueDir, `${initId}.md`);
  writeFileSync(manifestPath, frontmatter);
  return manifestPath;
}

function writeCycleLog(root: string, cycleId: string, lines: object[]): void {
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function ev(phase: string, event_type: string, msg?: string, meta?: Record<string, unknown>): object {
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
  };
}

test('aggregateRun: never-claimed pending manifest (no cycle_id) reports the blank planned shape', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-never-claimed';
    const manifestPath = writeManifest(root, 'pending', initId);

    const run = aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'planned');
    // Unchanged by this fix: a genuinely never-run initiative stays keyed by
    // its initiative id, not a cycle id it has never had.
    assert.equal(run.id, initId);
    assert.equal(run.workItems, undefined);
  } finally {
    cleanup(root);
  }
});

test('aggregateRun: triggered pending manifest (mint-time cycle_id, no log) is still blank/planned', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-triggered-not-yet-claimed';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-triggered-not-yet-claimed';
    // ADR 026 (`mint-triggered-initiative.ts`'s `mintAndPersistManifestCycleId`)
    // anchors a triggered initiative's cycle_id at MINT time, before the
    // scheduler ever claims it — no `_logs/<cycleId>/` exists yet. This must
    // stay indistinguishable, at the wire, from any other never-run planned
    // initiative: `cycle_id` presence alone is NOT the signal for "has this
    // actually run" (bridge-studio-triggers.test.ts pins the real HTTP shape).
    const manifestPath = writeManifest(root, 'pending', initId, { cycle_id: cycleId, origin: 'triggered' });

    const run = aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });

    assert.equal(run.status, 'planned');
    // Still keyed by initiativeId, not its mint-time cycle_id — the cycle
    // never actually started (no events.jsonl for it).
    assert.equal(run.id, initId);
    assert.equal(run.workItems, undefined);
  } finally {
    cleanup(root);
  }
});

test('aggregateRun: resumed run transiently in pending/ keeps cycle id + real work items', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-resumed';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-resumed';
    // `forge-requeue.ts` step 3 moves the manifest to pending/ but keeps
    // `cycle_id` — mirror that exact shape here.
    const manifestPath = writeManifest(root, 'pending', initId, { cycle_id: cycleId });

    writeCycleLog(root, cycleId, [
      ev('developer-loop', 'start', undefined, { work_item_id: 'WI-1' }),
      ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }),
      // A skipped WI carries only a non-lifecycle `log` event
      // (run-model-derive-status.ts's LIFECYCLE_TYPES excludes it) — zero
      // real lifecycle events, so it must still read 'pending'.
      ev('developer-loop', 'log', 'ralph.skipped', { work_item_id: 'WI-2' }),
      ev('orchestrator', 'log', 'flow.operator-stop', {}),
    ]);

    const run = aggregateRun({ root, queueState: 'pending', manifestPath, nowMs: Date.now() });

    // The single-run path must report the SAME identity every other queue
    // state (and this run a moment earlier) reports it under — the cycle id,
    // not the bare initiative id `makePlannedRun` uses for a never-claimed
    // initiative.
    assert.equal(run.id, cycleId, 'a resumed run keeps its cycle id, not the bare initiative id');
    assert.equal(run.initiativeId, initId);
    // Real history must survive the transient pending/ hop.
    const wi1 = run.workItems?.find((w) => w.id === 'WI-1');
    const wi2 = run.workItems?.find((w) => w.id === 'WI-2');
    assert.equal(wi1?.status, 'complete');
    assert.equal(wi2?.status, 'pending');

    // listRuns (the flow monitor's LIST path) must agree with aggregateRun
    // (the run-detail single-run path) — one derivation, not two.
    const list = listRuns(root, Date.now());
    const fromList = list.find((r) => r.initiativeId === initId);
    assert.deepEqual(fromList, run, 'listRuns and aggregateRun must agree on this run');
  } finally {
    cleanup(root);
  }
});
