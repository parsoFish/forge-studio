/**
 * Tests for cli/run-list-cache.ts — ADR-044 P1: an mtime-keyed memo of the
 * single run derivation (docs/decisions/044-read-path-memoization.md).
 *
 * Structure mirrors orchestrator/run-model.test.ts's fixture helpers (small
 * synthetic manifests + events.jsonl trees on tmp dirs) since this module
 * is a thin caching layer over exactly that derivation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listRuns } from '../orchestrator/run-model.ts';
import {
  cachedListRuns,
  _resetRunListCacheForTest,
  _getDeriveCountForTest,
  _setStatImplForTest,
} from './run-list-cache.ts';

// ---------------------------------------------------------------------------
// Helpers (mirrors orchestrator/run-model.test.ts's fixture builders)
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'run-list-cache-test-'));
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

/** Build a small multi-state fixture tree used by several tests below. */
function buildFixtureTree(root: string): { doneId: string; doneCycleId: string } {
  writeManifest(root, 'pending', 'INIT-2026-01-01-pending');

  const doneId = 'INIT-2026-01-01-done';
  const doneCycleId = '2026-01-01T10-00-00_INIT-2026-01-01-done';
  writeManifest(root, 'done', doneId, { cycle_id: doneCycleId, flow_id: 'forge-develop' });
  writeCycleLog(root, doneCycleId, [
    ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, { started_at: '2026-01-01T10:00:00Z' }),
    ev('developer-loop', 'start', undefined, undefined, { started_at: '2026-01-01T10:05:00Z' }),
    ev('developer-loop', 'end', undefined, { work_item_id: 'WI-1', status: 'complete' }, { started_at: '2026-01-01T10:10:00Z' }),
  ]);

  const failId = 'INIT-2026-01-02-failed';
  const failCycleId = '2026-01-02T00-00-00_INIT-2026-01-02-failed';
  writeManifest(root, 'failed', failId, { cycle_id: failCycleId });
  writeCycleLog(root, failCycleId, [
    ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }, { started_at: '2026-01-02T00:00:00Z' }),
  ]);

  const inFlightId = 'INIT-2026-01-03-inflight';
  const inFlightCycleId = '2026-01-03T00-00-00_INIT-2026-01-03-inflight';
  // In-flight manifest whose cycle log hasn't written events.jsonl yet — the
  // "absent events file = its own key state" case.
  writeManifest(root, 'in-flight', inFlightId, { cycle_id: inFlightCycleId });

  return { doneId, doneCycleId };
}

test.beforeEach(() => {
  _resetRunListCacheForTest();
  _setStatImplForTest(null);
});

// ---------------------------------------------------------------------------
// Rule 1 (ADR-044): same derivation, byte-identical output
// ---------------------------------------------------------------------------

test('cachedListRuns: byte-identical to listRuns, stable across repeat calls', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const uncached = listRuns(root, nowMs);
    const cachedFirst = cachedListRuns(root, nowMs);
    const cachedSecond = cachedListRuns(root, nowMs);

    assert.deepStrictEqual(cachedFirst, uncached, 'first cachedListRuns call must match listRuns exactly');
    assert.deepStrictEqual(cachedSecond, uncached, 'second cachedListRuns call must still match listRuns exactly');
    assert.ok(uncached.length >= 4, `expected >= 4 runs in fixture tree, got ${uncached.length}`);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Rule 2 (ADR-044): invalidation is the inputs' own metadata
// ---------------------------------------------------------------------------

test('cachedListRuns: unchanged manifest+events tree hits the cache — zero re-derivations', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    cachedListRuns(root, nowMs); // cold pass — populates the cache
    const coldDeriveCount = _getDeriveCountForTest();
    assert.ok(coldDeriveCount > 0, 'cold pass must derive at least once');

    cachedListRuns(root, nowMs); // warm pass — nothing on disk changed
    const warmDeriveCount = _getDeriveCountForTest();

    assert.strictEqual(
      warmDeriveCount,
      coldDeriveCount,
      'a second call over an unchanged tree must not perform any additional derivation',
    );
  } finally {
    cleanup(root);
  }
});

test('cachedListRuns: touching events.jsonl re-derives only that manifest', () => {
  const root = makeTmp();
  try {
    const { doneId, doneCycleId } = buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    cachedListRuns(root, nowMs);
    const coldDeriveCount = _getDeriveCountForTest();

    // Append a new event — changes both mtime and size of the done cycle's log.
    appendFileSync(
      join(root, '_logs', doneCycleId, 'events.jsonl'),
      JSON.stringify(ev('developer-loop', 'log', 'gate.pass', { work_item_id: 'WI-1' })) + '\n',
    );

    const runsAfterTouch = cachedListRuns(root, nowMs);
    const afterTouchDeriveCount = _getDeriveCountForTest();

    assert.ok(
      afterTouchDeriveCount > coldDeriveCount,
      'touching events.jsonl must trigger at least one re-derivation',
    );

    // The re-derived output must match a fully uncached derivation over the
    // same (now-changed) tree — same derivation, not a second one.
    const uncachedAfterTouch = listRuns(root, nowMs);
    assert.deepStrictEqual(runsAfterTouch, uncachedAfterTouch);

    const doneRun = runsAfterTouch.find((r) => r.initiativeId === doneId);
    assert.ok(doneRun, 'done run should still be present after re-derivation');
  } finally {
    cleanup(root);
  }
});

test('cachedListRuns: editing manifest frontmatter invalidates its own cache entry', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    cachedListRuns(root, nowMs);
    const coldDeriveCount = _getDeriveCountForTest();

    // Rewrite the pending manifest with a different title (body change only —
    // still valid frontmatter) to bump its mtime+size.
    const pendingPath = join(root, '_queue', 'pending', 'INIT-2026-01-01-pending.md');
    writeManifest(root, 'pending', 'INIT-2026-01-01-pending', { origin: 'human-directed' });
    void pendingPath;

    cachedListRuns(root, nowMs);
    const afterEditDeriveCount = _getDeriveCountForTest();

    assert.ok(
      afterEditDeriveCount > coldDeriveCount,
      'editing the manifest must trigger re-derivation',
    );
  } finally {
    cleanup(root);
  }
});

test('cachedListRuns: absent events file is its own key state — appearance of the file invalidates', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const firstPass = cachedListRuns(root, nowMs);
    const inFlightRun = firstPass.find((r) => r.initiativeId === 'INIT-2026-01-03-inflight');
    assert.ok(inFlightRun, 'in-flight run with no events.jsonl yet should still be listed');

    const coldDeriveCount = _getDeriveCountForTest();

    // Now the cycle actually starts writing events.
    writeCycleLog(root, '2026-01-03T00-00-00_INIT-2026-01-03-inflight', [
      ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
    ]);

    const secondPass = cachedListRuns(root, nowMs);
    const afterAppearDeriveCount = _getDeriveCountForTest();

    assert.ok(
      afterAppearDeriveCount > coldDeriveCount,
      'events.jsonl appearing where it was absent must trigger re-derivation',
    );

    const uncached = listRuns(root, nowMs);
    assert.deepStrictEqual(secondPass, uncached);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Rule 4 (ADR-044): fail open to the derivation on any doubt
// ---------------------------------------------------------------------------

test('cachedListRuns: a stat error on the manifest fails open to the uncached derivation', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const uncached = listRuns(root, nowMs);

    _setStatImplForTest((path: string) => {
      if (path.includes('INIT-2026-01-01-done.md')) {
        throw new Error('EIO: simulated stat failure (test-injected, not ENOENT)');
      }
      return statSync(path);
    });

    let result: ReturnType<typeof cachedListRuns> | undefined;
    assert.doesNotThrow(() => {
      result = cachedListRuns(root, nowMs);
    }, 'a stat error on one manifest must not crash the whole list');

    assert.ok(result, 'cachedListRuns must still return a result');
    assert.deepStrictEqual(result, uncached, 'fail-open path must still produce the same derivation as listRuns');
  } finally {
    _setStatImplForTest(null);
    cleanup(root);
  }
});

test('cachedListRuns: a stat error never leaves a poisoned cache entry behind', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    _setStatImplForTest((path: string) => {
      if (path.includes('INIT-2026-01-01-done.md')) {
        throw new Error('EIO: simulated stat failure');
      }
      return statSync(path);
    });

    cachedListRuns(root, nowMs); // errors on the 'done' manifest every time — never cached
    _setStatImplForTest(null); // now stat works again

    const recovered = cachedListRuns(root, nowMs);
    const uncached = listRuns(root, nowMs);
    assert.deepStrictEqual(recovered, uncached, 'once stat works again the run must derive correctly, not stay poisoned');
  } finally {
    _setStatImplForTest(null);
    cleanup(root);
  }
});
