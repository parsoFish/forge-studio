/**
 * Smoke tests for the JSONL event logger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from './logging.ts';

test('logger: writes JSONL events to _logs/<cycle-id>/events.jsonl', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-'));
  try {
    const logger = createLogger('cycle-smoke', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-smoke',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'start',
      input_refs: ['fixture.md'],
      output_refs: [],
    });
    logger.emit({
      initiative_id: 'INIT-smoke',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'end',
      input_refs: ['fixture.md'],
      output_refs: [],
      duration_ms: 42,
    });

    const lines = readFileSync(logger.logFilePath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const start = JSON.parse(lines[0]);
    const end = JSON.parse(lines[1]);
    assert.equal(start.event_type, 'start');
    assert.equal(end.event_type, 'end');
    assert.equal(start.cycle_id, 'cycle-smoke');
    assert.equal(end.duration_ms, 42);
    assert.match(start.event_id, /^EV_/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
