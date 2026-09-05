/**
 * Acceptance tests for the SERVER-SIDE grounds the flow run-detail surface
 * (R6-01 WI-2 / F4, route `/flows/[id]/run/[runId]`) stands on.
 *
 * F4's whole premise is that "every flow run — live AND completed/archived —
 * gets a detail surface", and that everything on it is DERIVED from the
 * event log with nothing new stored (ADR-008 posture). Two facts have to
 * hold for that to be true, and neither was pinned before this file:
 *
 *   (c) An ARCHIVED run — a manifest that has already been moved to
 *       `_queue/done/` — is served by the SAME `listRuns` path as a live
 *       one, with the SAME shape and per-node `phaseMeta`. If archived runs
 *       came back thinner (or not at all), the detail page would be a
 *       live-only surface wearing an "every run" label.
 *
 *   (d) A runId that NEVER EXISTED resolves to nothing — no fabricated run
 *       object, no invented status. R6-04 established this contract for
 *       agent runs (404 rather than fabricating a `running` state); the
 *       flow-run path must not regress it.
 *
 * These are derivation/route semantics, so they live in `node --test` under
 * the `npm test` glob (`orchestrator/*.test.ts`) rather than forge-ui's
 * vitest — no bridge boot needed, since `listRuns`/`aggregateRun` ARE what
 * `GET /api/runs` and `GET /api/runs/<id>` call (apps/forge/bridge-studio.ts:33).
 *
 * The cost fixture below is not invented: `orchestrator/event-cost.ts`'s
 * header documents that a phase emitting ≥1 `iteration` event RESTATES the
 * same dollars on its per-WI `end` AND its phase-level rollup `end`, so a
 * naive re-sum inflates 2-3x. The dev node here emits
 * `iteration 2.0 · iteration 1.5 · end 3.5 (restatement) · start 0`, which
 * produces three distinct numbers — naive 7.0, run-level 4.1, authoritative
 * 3.5 — so any test asserting the wrong one lands somewhere visible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listRuns, aggregateRun } from '../../run-model.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (mirroring run-model.test.ts / trigger-provenance.test.ts)
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flow-run-detail-test-'));
}

function writeManifest(root: string, state: string, initId: string, extra: Record<string, unknown> = {}): string {
  const queueDir = join(root, '_queue', state);
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
    flow_id: 'forge-develop',
    ...extra,
  };
  let fm = '---\n';
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fm += typeof v === 'string' ? `${k}: '${v}'\n` : `${k}: ${JSON.stringify(v)}\n`;
  }
  fm += '---\n\n## Body\n\nArchived-run acceptance fixture.\n';
  const p = join(queueDir, `${initId}.md`);
  writeFileSync(p, fm);
  return p;
}

function writeCycleLog(root: string, cycleId: string, lines: object[]): void {
  const dir = join(root, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function ev(
  phase: string,
  event_type: string,
  msg?: string,
  meta?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): object {
  return {
    event_id: `EV_${Math.random().toString(36).slice(2)}`,
    cycle_id: 'synthetic',
    initiative_id: 'INIT-archived-1',
    phase,
    skill: phase,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: '2026-01-01T00:10:00Z',
    ...(msg !== undefined ? { message: msg } : {}),
    ...(meta !== undefined ? { metadata: meta } : {}),
    ...extra,
  };
}

const ARCHIVED_INIT = 'INIT-archived-1';
const ARCHIVED_CYCLE = '2026-01-01T00-00-00_INIT-archived-1';

/** Seed a root whose ONLY manifest lives in `_queue/done/` — a closed cycle. */
function seedArchivedRun(root: string): string {
  const manifestPath = writeManifest(root, 'done', ARCHIVED_INIT, {
    cycle_id: ARCHIVED_CYCLE,
    title: 'An initiative that already closed',
    started_at: '2026-01-01T00:05:00Z',
  });
  writeCycleLog(root, ARCHIVED_CYCLE, [
    ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
    ev('project-manager', 'start', undefined, undefined, { cost_usd: 0.5 }),
    ev('project-manager', 'end', undefined, undefined, { cost_usd: 0.1 }),
    ev('developer-loop', 'start', undefined, undefined, { cost_usd: 0 }),
    ev('developer-loop', 'iteration', undefined, { work_item_id: 'WI-1' }, { cost_usd: 2.0 }),
    ev('developer-loop', 'iteration', undefined, { work_item_id: 'WI-1' }, { cost_usd: 1.5 }),
    // The phase-level rollup RESTATES the iteration dollars — counting it is
    // the documented 2-3x inflation defect.
    ev('developer-loop', 'end', undefined, undefined, { cost_usd: 3.5 }),
    ev('developer-loop', 'log', 'dev-loop.delivered', { files: 4, insertions: 120, commits: 2 }),
  ]);
  return manifestPath;
}

// ---------------------------------------------------------------------------
// (c) The ARCHIVED run is a first-class run
// ---------------------------------------------------------------------------

test('an archived run (_queue/done/) is served by the SAME listRuns path as a live one', () => {
  // KILLS: a run-detail surface that only works for in-flight runs — i.e. an
  // implementation (or a `listRuns` regression) that skips the terminal
  // queue dirs. F4 promises completed runs get a detail page; if `done/`
  // manifests never reach the list, that promise is unfulfillable.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const runs = listRuns(root, Date.now());

    assert.equal(runs.length, 1, 'the archived manifest must appear in listRuns');
    assert.equal(runs[0].id, ARCHIVED_CYCLE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an archived run reports RunStatus "complete" — the measured _queue/done mapping', () => {
  // KILLS: leaving an archived run in a live-looking status. Measured at
  // orchestrator/run-model.ts:169 — QUEUE_STATE_TO_RUN_STATUS maps
  // 'done' → 'complete' (as it does 'merged'); the detail page renders this
  // value directly, so a wrong mapping shows the operator a finished cycle
  // as still running.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const run = listRuns(root, Date.now())[0];

    assert.equal(run.status, 'complete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the archived run carries the SAME shape from listRuns as from aggregateRun', () => {
  // KILLS: a thinner archived payload — e.g. a list path that omits
  // phaseMeta/workItems for terminal runs to save work, which would leave
  // the detail page with nothing to render for exactly the runs F4 adds.
  const root = makeTmp();
  try {
    const manifestPath = seedArchivedRun(root);
    const listed = listRuns(root, Date.now())[0];
    const direct = aggregateRun({ root, queueState: 'done', manifestPath, nowMs: Date.now() });

    assert.deepEqual(
      Object.keys(listed).sort(),
      Object.keys(direct).sort(),
      'listRuns and aggregateRun must produce the same Run shape for an archived manifest',
    );
    assert.equal(listed.status, direct.status);
    assert.equal(listed.id, direct.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an archived run carries per-node phaseMeta with AUTHORITATIVE per-node cost', () => {
  // KILLS: the twice-repeated re-summation defect, pinned at its source.
  // The dev node's events sum naively to 7.0 (0 + 2.0 + 1.5 + 3.5) because
  // the phase-level `end` restates the iteration spend; the authoritative
  // rule (orchestrator/event-cost.ts) counts ONLY the iteration events, so
  // phaseMeta.dev.costUsd is 3.5. The run's own total (4.1 = pm 0.6 + dev
  // 3.5) is a THIRD distinct number, asserted here so any node-vs-run
  // attribution mistake is caught too.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const run = listRuns(root, Date.now())[0];

    assert.equal(run.phaseMeta['dev']?.costUsd, 3.5, 'dev node cost must be the authoritative iteration sum');
    assert.notEqual(run.phaseMeta['dev']?.costUsd, 7.0, 'a naive re-sum would read 7.0');
    assert.equal(run.phaseMeta['pm']?.costUsd, 0.6, 'pm has no iteration events, so every row counts');
    assert.equal(run.costUsd, 4.1, 'the run-level total is distinct from every per-node value');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an archived run's per-node delivered numbers survive to phaseMeta", () => {
  // KILLS: an archived-run path that drops the per-node evidence the
  // timeline note is derived from, leaving the detail page to invent prose.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const run = listRuns(root, Date.now())[0];

    assert.deepEqual(run.phaseMeta['dev']?.delivered, { files: 4, insertions: 120, commits: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) The never-existed run
// ---------------------------------------------------------------------------

test('a runId that never existed resolves to NOTHING — no fabricated run object', () => {
  // KILLS: the exact defect R6-04 closed once already for agent runs —
  // answering an unknown runId with an invented `running` record. This is
  // the derivation-level fact `GET /api/runs/<id>`'s 404 rests on: if
  // lookup-by-id ever synthesised a Run, the route would 200 with a lie and
  // the detail page would render a timeline for a cycle that never ran.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const runs = listRuns(root, Date.now());

    assert.equal(
      runs.find((r) => r.id === 'never-existed-run-id-xyz'),
      undefined,
      'an unknown runId must be absent, not fabricated',
    );
    assert.equal(runs.length, 1, 'only the one real archived run exists');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an EMPTY forge root yields zero runs rather than a placeholder run', () => {
  // KILLS: a "helpful" empty-state that manufactures a run so a detail page
  // always has something to show. No manifests ⇒ no runs, full stop.
  const root = makeTmp();
  try {
    mkdirSync(join(root, '_queue', 'done'), { recursive: true });
    assert.deepEqual(listRuns(root, Date.now()), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-008 posture — reading a run writes nothing
// ---------------------------------------------------------------------------

test('deriving an archived run writes NO new file — nothing is stored for the detail page', () => {
  // KILLS: any implementation that materialises a per-run detail cache /
  // timeline artifact on read. F4's stated posture is "everything is DERIVED
  // from the event log; nothing new is stored"; a cache file written on
  // first view would silently break that and go stale against the log.
  const root = makeTmp();
  try {
    seedArchivedRun(root);
    const before = listAllFiles(root);

    listRuns(root, Date.now());
    listRuns(root, Date.now());

    assert.deepEqual(listAllFiles(root), before, 'reading a run must not create or modify any file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function listAllFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  }
  walk(root, '');
  return out.sort();
}
