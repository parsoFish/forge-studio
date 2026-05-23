/**
 * Smoke tests for the JSONL event logger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from './logging.ts';

test('logger: round-trips cache_read_tokens + cache_creation_tokens through JSONL (S8 / C23)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-cache-'));
  try {
    const logger = createLogger('cycle-cache', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-cache',
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'iteration',
      iteration: 2,
      input_refs: [],
      output_refs: [],
      cost_usd: 0.04,
      tokens_in: 1_200,
      tokens_out: 180,
      cache_read_tokens: 9_500,
      cache_creation_tokens: 250,
    });
    const lines = readFileSync(logger.logFilePath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.cache_read_tokens, 9_500);
    assert.equal(entry.cache_creation_tokens, 250);
    assert.equal(entry.tokens_in, 1_200);
    assert.equal(entry.tokens_out, 180);
    assert.equal(entry.cost_usd, 0.04);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logger: cache token fields are optional — entries without them round-trip cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-nocache-'));
  try {
    const logger = createLogger('cycle-nocache', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-nocache',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'start',
      input_refs: [],
      output_refs: [],
    });
    const lines = readFileSync(logger.logFilePath, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.cache_read_tokens, undefined);
    assert.equal(entry.cache_creation_tokens, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

// ---------------------------------------------------------------------------
// S7 / plan 07a — new event types round-trip through `recordEvent`.
// Each new EventType extension must serialise + deserialise losslessly so
// downstream consumers (`metrics.ts`, `cycle-report.ts`, the reflector,
// `forge watch`) can rely on the schema.
// ---------------------------------------------------------------------------

test('logger: round-trips file_change events (S7)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-filechange-'));
  try {
    const logger = createLogger('cycle-fc', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-fc',
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'file_change',
      input_refs: [],
      output_refs: ['src/foo.ts'],
      metadata: {
        work_item_id: 'WI-1',
        path: 'src/foo.ts',
        op: 'modify',
        size_bytes: 240,
      },
    });
    const entry = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(entry.event_type, 'file_change');
    assert.equal(entry.metadata.op, 'modify');
    assert.equal(entry.metadata.path, 'src/foo.ts');
    assert.equal(entry.metadata.size_bytes, 240);
    assert.equal(entry.metadata.work_item_id, 'WI-1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logger: round-trips test_run events with pass/fail counts (S7)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-testrun-'));
  try {
    const logger = createLogger('cycle-tr', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-tr',
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'test_run',
      input_refs: [],
      output_refs: [],
      duration_ms: 1430,
      metadata: {
        work_item_id: 'WI-2',
        command: 'npm test',
        exit_code: 0,
        pass_count: 42,
        fail_count: 0,
        stdout_tail: '42 passing',
      },
    });
    const entry = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(entry.event_type, 'test_run');
    assert.equal(entry.metadata.command, 'npm test');
    assert.equal(entry.metadata.exit_code, 0);
    assert.equal(entry.metadata.pass_count, 42);
    assert.equal(entry.metadata.fail_count, 0);
    assert.equal(entry.duration_ms, 1430);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logger: round-trips phase_transition events (S7)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-pt-'));
  try {
    const logger = createLogger('cycle-pt', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-pt',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'phase_transition',
      input_refs: [],
      output_refs: [],
      metadata: {
        from: 'project-manager',
        to: 'developer-loop',
        reason: 'pm-complete',
      },
    });
    const entry = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(entry.event_type, 'phase_transition');
    assert.equal(entry.metadata.from, 'project-manager');
    assert.equal(entry.metadata.to, 'developer-loop');
    assert.equal(entry.metadata.reason, 'pm-complete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logger: round-trips agent_heartbeat events (S7 / C13)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-hb-'));
  try {
    const logger = createLogger('cycle-hb', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-hb',
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'agent_heartbeat',
      input_refs: [],
      output_refs: [],
      metadata: {
        tool_use_count: 7,
        last_tool: 'Bash',
        since_ms: 15_000,
      },
    });
    const entry = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(entry.event_type, 'agent_heartbeat');
    assert.equal(entry.metadata.tool_use_count, 7);
    assert.equal(entry.metadata.last_tool, 'Bash');
    assert.equal(entry.metadata.since_ms, 15_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logger: round-trips cost_tick events (S7 / C14)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-log-ct-'));
  try {
    const logger = createLogger('cycle-ct', join(root, '_logs'));
    logger.emit({
      initiative_id: 'INIT-ct',
      phase: 'orchestrator',
      skill: 'cost-tick',
      event_type: 'cost_tick',
      input_refs: [],
      output_refs: [],
      metadata: {
        cycle_cost_usd: 0.42,
        wi_cost_usd: 0.18,
      },
    });
    const entry = JSON.parse(readFileSync(logger.logFilePath, 'utf8').trim());
    assert.equal(entry.event_type, 'cost_tick');
    assert.equal(entry.metadata.cycle_cost_usd, 0.42);
    assert.equal(entry.metadata.wi_cost_usd, 0.18);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
