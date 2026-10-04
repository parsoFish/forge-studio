/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qf item B — every row the
 * event logger writes carries an `event_id`. Run-end parity
 * (`scripts/stories/agent-parity.mjs`) reads an id-less row as "not written
 * by forge's own logger", so the logger must never produce one — including
 * when a caller spreads an object whose `event_id` key is present but
 * `undefined`, which `JSON.stringify` then drops from the written line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, isPerWorkItemRow, endStartOnThrow } from '../../index.ts';

test('createLogger.emit: an explicit `event_id: undefined` still gets a minted id, in the return value and on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logger-event-id-'));
  try {
    const logger = createLogger('C-1', dir);
    const entry = logger.emit({
      event_id: undefined, started_at: undefined,
      initiative_id: 'INIT-x', phase: 'reflection', skill: 'reflector', event_type: 'start',
      input_refs: [], output_refs: [], message: 'reflector.start',
    });
    assert.match(entry.event_id, /^EV_/);
    assert.equal(typeof entry.started_at, 'string');
    const written = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(written.event_id, entry.event_id);
    assert.equal(typeof written.started_at, 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createLogger.emit: a caller-supplied event_id is kept as given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logger-event-id-'));
  try {
    const entry = createLogger('C-1', dir).emit({
      event_id: 'EV_given', initiative_id: 'INIT-x', phase: 'orchestrator', skill: 'cycle', event_type: 'log',
      input_refs: [], output_refs: [],
    });
    assert.equal(entry.event_id, 'EV_given');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isPerWorkItemRow: a row carrying a string metadata.work_item_id, start or end, is per-WI — never a phase boundary', () => {
  assert.equal(isPerWorkItemRow({ event_type: 'end', metadata: { work_item_id: 'WI-1' } }), true);
  assert.equal(isPerWorkItemRow({ event_type: 'start', metadata: { work_item_id: 'WI-1' } }), true);
  assert.equal(isPerWorkItemRow({ event_type: 'end', metadata: { work_item_count: 3 } }), false);
  assert.equal(isPerWorkItemRow({ event_type: 'end' }), false);
  assert.equal(isPerWorkItemRow(null), false);
});

test('endStartOnThrow: a throwing body writes the start\'s own end (failed marker, parent = start) and rethrows; a clean body writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'logger-end-on-throw-'));
  try {
    const logger = createLogger('C-1', dir);
    const start = logger.emit({
      initiative_id: 'INIT-x', phase: 'orchestrator', skill: 'demo-agent', event_type: 'start', input_refs: [], output_refs: [],
      metadata: { agent_phase: 'integrate', node_id: 'integrate' },
    });
    assert.equal(await endStartOnThrow(logger, start, async () => 7), 7);
    await assert.rejects(() => endStartOnThrow(logger, start, async () => { throw new TypeError('boom'); }), /boom/);
    const rows = readFileSync(logger.logFilePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 2);
    assert.deepEqual(
      { type: rows[1].event_type, parent: rows[1].parent_event_id, skill: rows[1].skill, metadata: rows[1].metadata },
      { type: 'end', parent: start.event_id, skill: 'demo-agent', metadata: { agent_phase: 'integrate', node_id: 'integrate', status: 'failed', error: 'TypeError: boom' } },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
