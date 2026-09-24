/**
 * M7-C (forge-omk0/forge-aug) — bounds the standalone-dispatch scan behind
 * `collectStandaloneRows` (`GET /api/agents/:slug/history`) and the
 * standalone half of `collectRecentAgentRuns` (`GET /api/agents/runs/
 * recent`). Before this fix, both walked EVERY `_agent-*` dir under `_logs/`
 * on every request, fully reading+parsing each one's `events.jsonl`, with no
 * cap and no order — unbounded on a long-lived instance (bead forge-aug
 * measured 4000 dirs / ~200MB -> ~260ms per request, linear).
 *
 * PAGE mirrors `STANDALONE_HISTORY_MAX_ROWS` as a LITERAL (not an import) so
 * this file's imports stay valid whether or not that export exists yet —
 * confirming RED must be an assertion failure, never an import error.
 *
 * RED-A pins `collectStandaloneRows`: PAGE matching dirs for the target slug
 * interleaved with PAGE noise dirs for another slug (all newer), one EXCESS
 * target match older than the page, and one FORBIDDEN dir (oldest of all)
 * whose reads throw if touched at all. Proves: (1) exactly the newest PAGE
 * target rows come back, (2) the excess/forbidden dirs are dropped, (3) a
 * noise dir is never fully parsed (the cheap first-event filter caught it).
 *
 * RED-B pins `collectRecentAgentRuns`'s standalone half the same way against
 * its own `limit`.
 *
 * RED-D (security-review finding, bead forge-omk0): the cap+order bound above
 * only proves the RIGHT dirs come back, not that finding them is cheap. The
 * newest-first ORDER itself was built on `entries.sort((a,b) => mtimeOf(b) -
 * mtimeOf(a))` — a comparator-embedded stat, called by V8's sort roughly
 * `2*n*log2(n)` times, not `n` (measured ~21x at n=4000, ~29x at n=50000 in
 * the finding). `resolveGuardedPath`/`statSync` are imported directly, not
 * part of `AgentHistoryDeps`, so there is no pre-existing seam to count real
 * guarded stats through `collectStandaloneRows`; `sortEntriesByMtimeDesc`
 * (exported from the module under test) is that seam — a pure decorate/sort/
 * undecorate helper taking an injectable `mtimeOf`, which this test counts.
 *
 * RUN: node --experimental-strip-types --test packages/agents/tests/unit/standalone-history-bounded-scan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  collectStandaloneRows,
  collectRecentAgentRuns,
  sortEntriesByMtimeDesc,
  type AgentHistoryDeps,
} from '../../bridge-agents-history-rows.ts';

const PAGE = 50; // mirrors STANDALONE_HISTORY_MAX_ROWS

/** Plants one `_agent-*` run dir with a real t0 event (both `metadata.
 *  agent_slug` and top-level `skill` carry `slug` — the shape every real
 *  dispatch route writes first) and an explicit directory mtime. */
function writeRun(logsRoot: string, runId: string, slug: string, mtimeMs: number): void {
  const dir = join(logsRoot, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'events.jsonl'),
    `${JSON.stringify({
      event_id: 'e0', event_type: 'start', started_at: new Date(mtimeMs).toISOString(),
      skill: slug, metadata: { agent_slug: slug },
    })}\n`,
  );
  const t = new Date(mtimeMs);
  utimesSync(dir, t, t);
}

/** A `parseGuardedEventsJsonl` stand-in that THROWS for any entry in
 *  `forbidden` and otherwise records every entry it was actually asked to
 *  fully parse, in `calls.full`. */
function fullParseTracking(forbidden: ReadonlySet<string>, calls: { full: string[] }) {
  return (logsRoot: string, entry: string): Record<string, unknown>[] | null => {
    if (forbidden.has(entry)) throw new Error(`must not be fully parsed: ${entry}`);
    calls.full.push(entry);
    const p = join(logsRoot, entry, 'events.jsonl');
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  };
}

/** A `parseGuardedFirstEvent` stand-in that THROWS for any entry in
 *  `forbidden` and otherwise returns just the first parsed event. */
function firstEventTracking(forbidden: ReadonlySet<string>) {
  return (logsRoot: string, entry: string): Record<string, unknown> | null => {
    if (forbidden.has(entry)) throw new Error(`must not even be peeked at: ${entry}`);
    const p = join(logsRoot, entry, 'events.jsonl');
    if (!existsSync(p)) return null;
    const first = readFileSync(p, 'utf8').trim().split('\n')[0];
    return first ? (JSON.parse(first) as Record<string, unknown>) : null;
  };
}

test('M7-C RED-A: collectStandaloneRows returns exactly the newest PAGE matches, never fully parsing a non-matching dir or one beyond the page', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'm7c-standalone-'));
  const logsRoot = join(forgeRoot, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  try {
    const now = Date.parse('2026-09-19T00:00:00.000Z');
    const targetIds: string[] = [];
    for (let i = 0; i < PAGE; i += 1) {
      const t = now - i * 20_000;
      const targetId = `_agent-target-${i}`;
      writeRun(logsRoot, targetId, 'target', t);
      targetIds.push(targetId);
      writeRun(logsRoot, `_agent-noise-${i}`, 'noise', t - 10_000); // interleaved, always slightly older
    }
    // The (PAGE+1)-th newest target match — older than every dir above, must be dropped by the cap.
    writeRun(logsRoot, '_agent-target-excess', 'target', now - PAGE * 20_000 - 50_000);
    // Oldest of all, matching slug — must never be opened at all, by either dep.
    const forbidden = new Set(['_agent-target-forbidden']);
    writeRun(logsRoot, '_agent-target-forbidden', 'target', now - PAGE * 20_000 - 100_000);

    const calls = { full: [] as string[] };
    const deps: AgentHistoryDeps = {
      projectsRoot: forgeRoot,
      cachedListRuns: () => [],
      buildAgentSlugToNodeId: () => new Map(),
      loadFlowDefinition: () => ({ id: 'none', nodes: [] }),
      loadSessionKinds: () => [],
      parseGuardedFirstEvent: firstEventTracking(forbidden),
      parseGuardedEventsJsonl: fullParseTracking(forbidden, calls),
      isTurnAlive: () => false,
      extractErrorMessage: () => '',
      stallCeilingMs: 10 * 60 * 1000,
    };

    const rows = collectStandaloneRows(deps, logsRoot, 'target');

    assert.equal(rows.length, PAGE, `expected exactly ${PAGE} rows, got ${rows.length}: ${JSON.stringify(rows.map((r) => r.id))}`);
    assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(targetIds), 'must be exactly the newest PAGE target dirs');
    assert.ok(!calls.full.some((e) => e.startsWith('_agent-noise-')), `a noise dir was fully parsed: ${JSON.stringify(calls.full)}`);
    assert.equal(calls.full.length, PAGE, `expected exactly ${PAGE} full parses (the real matches only), got ${calls.full.length}: ${JSON.stringify(calls.full)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('M7-C RED-C: a first event with NEITHER identity field is INDETERMINATE, not a definite non-match — a run whose identity lands only on a LATER event must still be found', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'm7c-ambiguous-'));
  const logsRoot = join(forgeRoot, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  try {
    const runId = '_agent-ambiguous-late-identity';
    const dir = join(logsRoot, runId);
    mkdirSync(dir, { recursive: true });
    // First event carries no `metadata.agent_slug` and no top-level `skill`
    // at all — a shape the "every dispatch route writes the slug on its t0
    // marker" claim did not verify against a real installation's logs.
    // Identity lands only on the SECOND event.
    writeFileSync(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({ event_id: 'e0', event_type: 'start' })}\n` +
        `${JSON.stringify({ event_id: 'e1', event_type: 'log', metadata: { agent_slug: 'target' } })}\n`,
    );

    const deps: AgentHistoryDeps = {
      projectsRoot: forgeRoot,
      cachedListRuns: () => [],
      buildAgentSlugToNodeId: () => new Map(),
      loadFlowDefinition: () => ({ id: 'none', nodes: [] }),
      loadSessionKinds: () => [],
      parseGuardedFirstEvent: firstEventTracking(new Set()),
      parseGuardedEventsJsonl: fullParseTracking(new Set(), { full: [] }),
      isTurnAlive: () => false,
      extractErrorMessage: () => '',
      stallCeilingMs: 10 * 60 * 1000,
    };

    const rows = collectStandaloneRows(deps, logsRoot, 'target');
    assert.equal(rows.length, 1, `expected the run to be found via its SECOND event's identity, got ${rows.length}: ${JSON.stringify(rows)}`);
    assert.equal(rows[0]?.id, runId);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test("M7-C RED-B: collectRecentAgentRuns's standalone half never opens more than `limit` dirs' full logs, newest first", () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'm7c-recent-'));
  const logsRoot = join(forgeRoot, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  try {
    const LIMIT = 10;
    const now = Date.parse('2026-09-19T00:00:00.000Z');
    const newestIds: string[] = [];
    for (let i = 0; i < LIMIT; i += 1) {
      const id = `_agent-recent-${i}`;
      writeRun(logsRoot, id, `slug-${i}`, now - i * 20_000);
      newestIds.push(id);
    }
    const forbidden = new Set(['_agent-recent-forbidden']);
    writeRun(logsRoot, '_agent-recent-forbidden', 'slug-forbidden', now - LIMIT * 20_000 - 100_000);

    const calls = { full: [] as string[] };
    const deps: AgentHistoryDeps = {
      projectsRoot: forgeRoot,
      cachedListRuns: () => [],
      buildAgentSlugToNodeId: () => new Map(),
      loadFlowDefinition: () => ({ id: 'none', nodes: [] }),
      loadSessionKinds: () => [],
      parseGuardedFirstEvent: () => null,
      parseGuardedEventsJsonl: fullParseTracking(forbidden, calls),
      isTurnAlive: () => false,
      extractErrorMessage: () => '',
      stallCeilingMs: 10 * 60 * 1000,
    };

    const rows = collectRecentAgentRuns(deps, forgeRoot, logsRoot, LIMIT, 'standalone');

    assert.equal(rows.length, LIMIT, `expected exactly ${LIMIT} rows, got ${rows.length}: ${JSON.stringify(rows.map((r) => r.id))}`);
    assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(newestIds));
    assert.ok(!calls.full.includes('_agent-recent-forbidden'), `the oldest dir must never be opened: ${JSON.stringify(calls.full)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('M7-C RED-D: sortEntriesByMtimeDesc stats each entry exactly once, never once per comparison', () => {
  const N = 200;
  const entries = Array.from({ length: N }, (_, i) => `_agent-e-${i}`);
  // Fisher-Yates shuffle so a real sort has real reordering work to do — a
  // pre-sorted or reverse-sorted input can let some comparator-based sorts
  // dodge comparisons a truly-buggy implementation would otherwise make.
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = entries[i]!;
    entries[i] = entries[j]!;
    entries[j] = tmp;
  }

  let calls = 0;
  // The synthetic "mtime" is just the index encoded in the entry's own name,
  // so newest-first order is independently checkable without touching disk.
  const countingMtimeOf = (entry: string): number => {
    calls += 1;
    return Number(entry.slice(entry.lastIndexOf('-') + 1));
  };

  const sorted = sortEntriesByMtimeDesc(entries, countingMtimeOf);

  assert.equal(calls, N, `stat each entry exactly once: expected ${N} mtimeOf calls, got ${calls}`);
  assert.equal(sorted.length, N);
  assert.deepEqual(new Set(sorted), new Set(entries), 'must be a reordering, not a drop/duplicate');
  for (let i = 1; i < sorted.length; i += 1) {
    const prevIdx = Number(sorted[i - 1]!.slice(sorted[i - 1]!.lastIndexOf('-') + 1));
    const curIdx = Number(sorted[i]!.slice(sorted[i]!.lastIndexOf('-') + 1));
    assert.ok(prevIdx >= curIdx, `not newest-first at index ${i}: ${sorted[i - 1]} before ${sorted[i]}`);
  }
});
