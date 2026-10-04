/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qh (1) — a reflector run
 * that ends through `cycle.reflection-lost` writes THAT start's own
 * `reflector.end`, carrying `errorEndMetadata`'s failed marker, so every
 * `reflector.start` gets exactly one end.
 *
 * The R6j shape (S10 capture `2026-10-02T05-13-08_…exclude-author-flag-complete`):
 * reflector start `EV_muqjyxhv_3hfdxtnr` at 05:59:03, then at 06:09:22
 * `cycle.reflection-lost` (cause `budget-exhausted`, result subtype
 * `error_max_budget_usd`) parented to that start, and no end. The operator's
 * rerun `EV_muqkc7s4_3wrx4wzu` then FIFO-paired with it at run end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runReflector, type ReflectorDeps } from '../../phases/reflector.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const INIT = 'INIT-2026-10-02-exclude-author-flag-complete';

function harness(suffix: string) {
  const tmp = mkdtempSync(join(tmpdir(), `reflector-lost-end-${suffix}-`));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(manifestPath, [
    '---', `initiative_id: ${INIT}`, 'project: demo-project', 'created_at: 2026-10-02T05:13:08Z',
    'iteration_budget: 3', 'cost_budget_usd: 1.0', 'class: code', 'phase: done', 'origin: architect', '---', '', 'body', '',
  ].join('\n'));
  const logsRoot = join(tmp, '_logs');
  const cycleId = `2026-10-02T05-13-08_${INIT}-${suffix}-${Date.now().toString(36)}`;
  const logger = createLogger(cycleId, logsRoot);
  const input: CycleInput = { initiativeId: INIT, manifestPath, projectRepoPath: tmp, worktreePath: tmp, cycleId, logsRoot };
  const events = (): EventLogEntry[] => existsSync(logger.logFilePath)
    ? readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry)
    : [];
  return { tmp, logger, input, events, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const deps = (extra: Partial<ReflectorDeps>): ReflectorDeps => ({
  acquireBrainWriteLease: acquireIsolatedReflectorLease, agentDef: canonicalDef('reflector'),
  brainLint: () => ({ findings: [], exitCode: 0 }), ...extra,
});

/** The ends parented to `start`, in log order. */
function endsOf(events: EventLogEntry[], start: EventLogEntry): EventLogEntry[] {
  return events.filter((e) => e.event_type === 'end' && e.parent_event_id === start.event_id);
}

async function* budgetExhausted(): AsyncIterable<unknown> {
  yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] } };
  yield { type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 3.04, duration_ms: 617_470 };
}

test('R6j: a budget-exhausted reflector writes cycle.reflection-lost AND its start\'s one reflector.end, marked failed with the loss reason', async () => {
  const h = harness('budget');
  try {
    const result = await runReflector(h.input, h.logger, deps({ sdkQuery: budgetExhausted }));
    assert.equal(result.reflection_status, 'failed');
    const events = h.events();
    const start = events.find((e) => e.message === 'reflector.start')!;
    const lost = events.find((e) => e.message === 'cycle.reflection-lost')!;
    assert.equal(lost.parent_event_id, start.event_id, 'the loss is parented to the start, as the R6j row is');
    const ends = endsOf(events, start);
    assert.equal(ends.length, 1, `exactly one end for the start; got ${JSON.stringify(ends)}`);
    const [end] = ends;
    assert.equal(end.message, 'reflector.end');
    assert.equal(end.phase, 'reflection');
    assert.equal(end.skill, 'reflector');
    assert.equal(end.metadata?.['status'], 'failed');
    assert.match(String(end.metadata?.['error']), /budget-exhausted/);
    assert.match(String(end.metadata?.['error']), /error_max_budget_usd/);
    assert.ok(events.indexOf(end) > events.indexOf(lost), 'the end follows the loss row it closes on');
  } finally {
    h.cleanup();
  }
});

test('every reflection-lost path inside runReflector ends its start exactly once, failed: crash, manifest-unreadable, brain-gate', async () => {
  async function* crash(): AsyncIterable<unknown> { throw new Error('fetch failed: socket hang up'); }
  async function* noBrain(): AsyncIterable<unknown> { yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 100 }; }
  for (const [label, extra, input] of [
    ['crash', { sdkQuery: crash }, null],
    ['brain-gate-failed', { sdkQuery: noBrain }, null],
    ['manifest-unreadable', { sdkQuery: budgetExhausted }, 'missing-manifest'],
  ] as const) {
    const h = harness(label);
    try {
      const run = input === null ? h.input : { ...h.input, manifestPath: join(h.tmp, 'no-such.md') };
      const result = await runReflector(run, h.logger, deps(extra));
      assert.equal(result.reflection_status, 'failed', label);
      const events = h.events();
      const start = events.find((e) => e.message === 'reflector.start')!;
      const ends = endsOf(events, start);
      assert.equal(ends.length, 1, `${label}: exactly one end; got ${JSON.stringify(ends)}`);
      assert.equal(ends[0].metadata?.['status'], 'failed', label);
      assert.match(String(ends[0].metadata?.['error']), new RegExp(label), label);
    } finally {
      h.cleanup();
    }
  }
});

test('a throw past reflector.start ends that start once, failed, and still rethrows (the caller writes the loss)', async () => {
  const h = harness('throw');
  try {
    await assert.rejects(
      runReflector(h.input, h.logger, deps({ sdkQuery: budgetExhausted, acquireBrainWriteLease: async () => { throw new Error('EIO: lease dir gone'); } })),
      /EIO: lease dir gone/,
    );
    const events = h.events();
    const start = events.find((e) => e.message === 'reflector.start')!;
    const ends = endsOf(events, start);
    assert.equal(ends.length, 1, `exactly one end; got ${JSON.stringify(ends)}`);
    assert.equal(ends[0].metadata?.['status'], 'failed');
    assert.match(String(ends[0].metadata?.['error']), /EIO: lease dir gone/);
  } finally {
    h.cleanup();
  }
});
