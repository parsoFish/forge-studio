/**
 * Tests for packages/flows/run-list-cache.ts — ADR-044 P1: a keyed memo of the single
 * run derivation (docs/decisions/044-read-path-memoization.md).
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
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listRuns } from './run-model.ts';
import {
  cachedListRuns,
  _resetRunListCacheForTest,
  _getDeriveCountForTest,
  _setStatImplForTest,
  _setReadImplForTest,
  _getCachedManifestPathsForTest,
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
  _setReadImplForTest(null);
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

test('cachedListRuns: a stat error on the events.jsonl fingerprint fails open to the uncached derivation', () => {
  const root = makeTmp();
  try {
    const { doneCycleId } = buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const uncached = listRuns(root, nowMs);

    _setStatImplForTest((path: string) => {
      if (path.includes(doneCycleId) && path.endsWith('events.jsonl')) {
        throw new Error('EIO: simulated stat failure (test-injected, not ENOENT)');
      }
      return statSync(path);
    });

    let result: ReturnType<typeof cachedListRuns> | undefined;
    assert.doesNotThrow(() => {
      result = cachedListRuns(root, nowMs);
    }, 'a stat error on one events.jsonl must not crash the whole list');

    assert.ok(result, 'cachedListRuns must still return a result');
    assert.deepStrictEqual(result, uncached, 'fail-open path must still produce the same derivation as listRuns');
  } finally {
    _setStatImplForTest(null);
    cleanup(root);
  }
});

test('cachedListRuns: a stat error on events.jsonl never leaves a poisoned cache entry behind', () => {
  const root = makeTmp();
  try {
    const { doneCycleId } = buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    _setStatImplForTest((path: string) => {
      if (path.includes(doneCycleId) && path.endsWith('events.jsonl')) {
        throw new Error('EIO: simulated stat failure');
      }
      return statSync(path);
    });

    cachedListRuns(root, nowMs); // errors on the 'done' cycle's events.jsonl every time — never cached
    _setStatImplForTest(null); // now stat works again

    const recovered = cachedListRuns(root, nowMs);
    const uncached = listRuns(root, nowMs);
    assert.deepStrictEqual(recovered, uncached, 'once stat works again the run must derive correctly, not stay poisoned');
  } finally {
    _setStatImplForTest(null);
    cleanup(root);
  }
});

test('cachedListRuns: a read error on the manifest fails open to the uncached derivation', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const uncached = listRuns(root, nowMs);

    _setReadImplForTest((path: string) => {
      if (path.includes('INIT-2026-01-01-done.md')) {
        throw new Error('EIO: simulated read failure (test-injected, not ENOENT)');
      }
      return readFileSync(path, 'utf8');
    });

    let result: ReturnType<typeof cachedListRuns> | undefined;
    assert.doesNotThrow(() => {
      result = cachedListRuns(root, nowMs);
    }, 'a read error on one manifest must not crash the whole list');

    assert.ok(result, 'cachedListRuns must still return a result');
    assert.deepStrictEqual(result, uncached, 'fail-open path must still produce the same derivation as listRuns');
  } finally {
    _setReadImplForTest(null);
    cleanup(root);
  }
});

test('cachedListRuns: a read error on the manifest never leaves a poisoned cache entry behind', () => {
  const root = makeTmp();
  try {
    buildFixtureTree(root);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    _setReadImplForTest((path: string) => {
      if (path.includes('INIT-2026-01-01-done.md')) {
        throw new Error('EIO: simulated read failure');
      }
      return readFileSync(path, 'utf8');
    });

    cachedListRuns(root, nowMs); // errors on the 'done' manifest every time — never cached
    _setReadImplForTest(null); // now read works again

    const recovered = cachedListRuns(root, nowMs);
    const uncached = listRuns(root, nowMs);
    assert.deepStrictEqual(recovered, uncached, 'once read works again the run must derive correctly, not stay poisoned');
  } finally {
    _setReadImplForTest(null);
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Reviewer round 1 — MEDIUM: manifest key is a content hash, not mtime+size
// ---------------------------------------------------------------------------

test('cachedListRuns: manifest content change with an IDENTICAL mtime+size still re-derives (same-second-same-size collision)', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-collide';
    const manifestPath = writeManifest(root, 'pending', initId, { origin: 'architect' });
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    // Pin to a single, fully-controlled Date fed to utimesSync IDENTICALLY
    // both times below — round-tripping through a stat READ first (pin to
    // "whatever the OS happened to record") is flaky: some filesystems lose
    // sub-millisecond precision on the SET side that the natural write-time
    // value already had, so the two stats never compare bit-equal. Feeding
    // the exact same Date value to utimesSync both times sidesteps that:
    // whatever rounding utimesSync applies, it applies identically to an
    // identical input.
    const pinned = new Date('2026-01-01T00:00:00.000Z');
    utimesSync(manifestPath, pinned, pinned);

    cachedListRuns(root, nowMs);
    const coldDeriveCount = _getDeriveCountForTest();

    const statBefore = statSync(manifestPath);

    // 'architect' and 'triggered' are both 9 chars — a real content change
    // (a different, still-valid origin) that keeps the file byte length
    // identical, so an mtime+size key would see no change at all.
    const original = readFileSync(manifestPath, 'utf8');
    const edited = original.replace("origin: 'architect'", "origin: 'triggered'");
    assert.notStrictEqual(edited, original, 'the edit must actually change the bytes');
    assert.strictEqual(edited.length, original.length, 'edited content must be the SAME byte length for this test to be meaningful');

    writeFileSync(manifestPath, edited);
    // Re-pin to the SAME Date value — simulates two writes landing inside
    // the same filesystem mtime tick (same-second-same-size collision).
    utimesSync(manifestPath, pinned, pinned);

    const statAfter = statSync(manifestPath);
    assert.strictEqual(statAfter.mtimeMs, statBefore.mtimeMs, 'mtime must be pinned identical for this test to be meaningful');
    assert.strictEqual(statAfter.size, statBefore.size, 'size must be identical (same byte length) for this test to be meaningful');

    const afterEdit = cachedListRuns(root, nowMs);
    const afterEditDeriveCount = _getDeriveCountForTest();

    assert.ok(
      afterEditDeriveCount > coldDeriveCount,
      'content changed despite identical mtime+size — a content-hash key must still re-derive, an mtime+size key would have missed this',
    );

    const uncached = listRuns(root, nowMs);
    assert.deepStrictEqual(afterEdit, uncached);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Reviewer round 1 — MEDIUM: bounded growth via end-of-pass eviction
// ---------------------------------------------------------------------------

test('cachedListRuns: a manifest moved between queue dirs evicts its old-path cache entry', () => {
  const root = makeTmp();
  try {
    const initId = 'INIT-2026-01-01-movegrow';
    const cycleId = '2026-01-01T00-00-00_INIT-2026-01-01-movegrow';
    const oldPath = writeManifest(root, 'in-flight', initId, { cycle_id: cycleId });
    writeCycleLog(root, cycleId, [ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' })]);
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    cachedListRuns(root, nowMs);
    assert.ok(
      _getCachedManifestPathsForTest().includes(oldPath),
      'the in-flight path should be cached after the first pass',
    );

    // Simulate the queue-state transition: the manifest FILE moves dirs
    // (rename in production; delete+recreate here to keep the fixture
    // helpers simple — the effect on cachedListRuns's enumeration is
    // identical either way).
    rmSync(oldPath);
    const newPath = writeManifest(root, 'done', initId, { cycle_id: cycleId });

    cachedListRuns(root, nowMs);
    const cachedPaths = _getCachedManifestPathsForTest();

    assert.ok(
      !cachedPaths.includes(oldPath),
      'the old (in-flight) path entry must be evicted once the manifest no longer enumerates there',
    );
    assert.ok(cachedPaths.includes(newPath), 'the new (done) path should now be cached');
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Reviewer round 1 — HIGH: makeDegradedRun reuse (not a hand-duplicated twin)
// ---------------------------------------------------------------------------

test('cachedListRuns: a manifest that fails to parse produces the SAME degraded Run as listRuns', () => {
  const root = makeTmp();
  try {
    const queueDir = join(root, '_queue', 'done');
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(join(queueDir, 'INIT-2026-01-01-corrupt.md'), '---\nnot_valid: [unclosed\n---\nbody\n');
    // A valid sibling in the same dir, so the degraded branch isn't the
    // only manifest in the pass.
    writeManifest(root, 'done', 'INIT-2026-01-01-valid');
    const nowMs = Date.parse('2026-01-05T00:00:00Z');

    const cached = cachedListRuns(root, nowMs);
    const uncached = listRuns(root, nowMs);

    assert.deepStrictEqual(
      cached,
      uncached,
      'the degraded branch (makeDegradedRun, reused from orchestrator/run-model.ts) must be byte-identical to the uncached derivation',
    );

    const degraded = cached.find((r) => r.initiativeId === 'INIT-2026-01-01-corrupt');
    assert.ok(degraded, 'degraded run for the corrupt manifest should be present');
    assert.strictEqual(degraded.initiative, '(unreadable manifest)');
    assert.strictEqual(degraded.status, 'complete', 'queue dir was done → makeDegradedRun maps it to complete');
  } finally {
    cleanup(root);
  }
});
