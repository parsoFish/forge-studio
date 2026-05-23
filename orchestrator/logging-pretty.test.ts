/**
 * Snapshot-style tests for the pretty-printer adapter (plan 07a).
 *
 * Approach: deterministic input → deterministic output. Each test fixes:
 *   - a known `started_at` ISO timestamp (so the HH:MM:SS column is stable)
 *   - `colorize: false` so the snapshot is plain ASCII
 *
 * Two suites:
 *   - per-phase coverage: ensure each `Phase` renders without throwing and
 *     the phase column is correct.
 *   - per-new-event-type coverage: assert the synthesised message for each
 *     new EventType (file_change / test_run / phase_transition /
 *     agent_heartbeat / cost_tick) so any schema drift trips immediately.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatLine, createPrettyTransform, MESSAGE_FORMAT, CUSTOM_LEVELS, PHASE_COLOURS } from './logging-pretty.ts';
import type { EventLogEntry } from './logging.ts';

function entry(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'EV_test',
    cycle_id: 'cycle-pretty',
    initiative_id: 'INIT-pretty',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    started_at: '2026-05-23T14:30:01.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Spec exports — they're load-bearing for council 07's eng:02 traceability.
// ---------------------------------------------------------------------------

test('exports the council-locked messageFormat spec verbatim', () => {
  assert.equal(
    MESSAGE_FORMAT,
    '{phase|UPPERCASE} {event_type} {if work_item_id}{work_item_id} {/if}{msg|truncate:120}',
  );
});

test('exports the council-locked customLevels map verbatim', () => {
  assert.deepEqual(CUSTOM_LEVELS, {
    cycle: 50,
    pm: 40,
    'developer-ralph': 40,
    'developer-unifier': 40,
    reviewer: 40,
    'review-router': 35,
    reflector: 40,
    'brain-lint': 30,
  });
});

test('every Phase has a colour entry (plus unknown fallback)', () => {
  for (const p of [
    'orchestrator',
    'brain',
    'architect',
    'project-manager',
    'developer-loop',
    'review-loop',
    'closure',
    'reflection',
    'unknown',
  ] as const) {
    assert.ok(PHASE_COLOURS[p], `missing colour for phase=${p}`);
  }
});

// ---------------------------------------------------------------------------
// Per-phase snapshots (colorize: false; deterministic ISO).
// ---------------------------------------------------------------------------

test('formatLine: orchestrator cycle.start (colorize: false)', () => {
  const line = formatLine(
    entry({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'start',
      message: 'cycle.start',
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  ORCHESTRATOR  start  cycle.start');
});

test('formatLine: project-manager pm.work-item-emitted', () => {
  const line = formatLine(
    entry({
      phase: 'project-manager',
      skill: 'pm',
      event_type: 'log',
      message: 'pm.work-item-emitted',
      metadata: { work_item_id: 'WI-3' },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  PROJECT-MANAGER  log  WI-3  pm.work-item-emitted');
});

test('formatLine: developer-loop iteration with cost', () => {
  const line = formatLine(
    entry({
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'iteration',
      iteration: 2,
      cost_usd: 0.1234,
      metadata: { work_item_id: 'WI-1' },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  DEVELOPER-LOOP  iteration  WI-1  iteration 2 ($0.1234)');
});

test('formatLine: review-loop end', () => {
  const line = formatLine(
    entry({
      phase: 'review-loop',
      skill: 'reviewer',
      event_type: 'end',
      message: 'reviewer.holistic-intent-aligned',
      duration_ms: 1200,
    }),
    { colorize: false },
  );
  assert.equal(
    line,
    '14:30:01  REVIEW-LOOP  end  reviewer.holistic-intent-aligned  (dur=1200ms)',
  );
});

test('formatLine: reflection start', () => {
  const line = formatLine(
    entry({
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'start',
      message: 'reflector.start',
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  REFLECTION  start  reflector.start');
});

// ---------------------------------------------------------------------------
// Per-new-event-type snapshots.
// ---------------------------------------------------------------------------

test('formatLine: file_change synthesises "<op> <path> (<size>b)"', () => {
  const line = formatLine(
    entry({
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'file_change',
      metadata: { work_item_id: 'WI-2', path: 'src/foo.ts', op: 'modify', size_bytes: 480 },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  DEVELOPER-LOOP  file_change  WI-2  modify src/foo.ts (480b)');
});

test('formatLine: test_run synthesises "<cmd> → N pass / M fail"', () => {
  const line = formatLine(
    entry({
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'test_run',
      duration_ms: 1430,
      metadata: { command: 'npm test', exit_code: 0, pass_count: 42, fail_count: 0 },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  DEVELOPER-LOOP  test_run  npm test → 42 pass / 0 fail');
});

test('formatLine: test_run with no counts falls back to exit code', () => {
  const line = formatLine(
    entry({
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'test_run',
      metadata: { command: 'pytest', exit_code: 1 },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  DEVELOPER-LOOP  test_run  pytest → exit 1');
});

test('formatLine: phase_transition synthesises "<from> → <to> (<reason>)"', () => {
  const line = formatLine(
    entry({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'phase_transition',
      metadata: { from: 'project-manager', to: 'developer-loop', reason: 'pm-complete' },
    }),
    { colorize: false },
  );
  assert.equal(
    line,
    '14:30:01  ORCHESTRATOR  phase_transition  project-manager → developer-loop (pm-complete)',
  );
});

test('formatLine: agent_heartbeat synthesises liveness summary', () => {
  const line = formatLine(
    entry({
      phase: 'developer-loop',
      skill: 'dev-ralph',
      event_type: 'agent_heartbeat',
      metadata: { tool_use_count: 7, last_tool: 'Bash', since_ms: 15_000 },
    }),
    { colorize: false },
  );
  assert.equal(
    line,
    '14:30:01  DEVELOPER-LOOP  agent_heartbeat  idle 15s tools=7 last=Bash',
  );
});

test('formatLine: cost_tick surfaces cycle + wi cost', () => {
  const line = formatLine(
    entry({
      phase: 'orchestrator',
      skill: 'cost-tick',
      event_type: 'cost_tick',
      metadata: { cycle_cost_usd: 0.42, wi_cost_usd: 0.18 },
    }),
    { colorize: false },
  );
  assert.equal(line, '14:30:01  ORCHESTRATOR  cost_tick  cycle $0.4200 / wi $0.1800');
});

// ---------------------------------------------------------------------------
// Truncation.
// ---------------------------------------------------------------------------

test('formatLine: truncates message to 120 chars + ellipsis', () => {
  const long = 'x'.repeat(200);
  const line = formatLine(
    entry({ event_type: 'log', message: long }),
    { colorize: false },
  );
  // Find the message column: the 4th block after "  ".
  const cols = line.split('  ');
  // Layout: HH:MM:SS / PHASE / event_type / message
  assert.ok(cols.length >= 4);
  assert.ok(cols[3]!.length <= 120, `expected ≤120 chars, got ${cols[3]!.length}`);
  assert.ok(cols[3]!.endsWith('…'));
});

// ---------------------------------------------------------------------------
// Colourise smoke: ensure the colorize branch doesn't throw.
// ---------------------------------------------------------------------------

test('createPrettyTransform: streams two JSONL lines and pretty-prints each', async () => {
  const stream = createPrettyTransform({ colorize: false });
  const out: string[] = [];
  stream.on('data', (chunk: Buffer | string) => out.push(chunk.toString('utf8')));
  const a = JSON.stringify(entry({
    phase: 'developer-loop',
    skill: 'dev-ralph',
    event_type: 'iteration',
    iteration: 1,
    cost_usd: 0.05,
  }));
  const b = JSON.stringify(entry({
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'end',
    message: 'reflector.end',
  }));
  stream.write(a + '\n' + b + '\n');
  await new Promise<void>((res) => stream.end(() => res()));
  const combined = out.join('');
  assert.match(combined, /DEVELOPER-LOOP/);
  assert.match(combined, /REFLECTION/);
  assert.match(combined, /iteration 1/);
  assert.match(combined, /reflector\.end/);
});

test('createPrettyTransform: malformed JSON yields a bad-line marker, never throws', async () => {
  const stream = createPrettyTransform({ colorize: false });
  const out: string[] = [];
  stream.on('data', (chunk: Buffer | string) => out.push(chunk.toString('utf8')));
  stream.write('not json at all\n');
  await new Promise<void>((res) => stream.end(() => res()));
  assert.match(out.join(''), /# bad-line:/);
});

test('formatLine: colorize: true produces a non-empty ANSI-wrapped phase column', () => {
  const line = formatLine(
    entry({ phase: 'developer-loop', event_type: 'start' }),
    { colorize: true },
  );
  // Either pino-pretty added ANSI codes, or (when stdout isn't a TTY) it
  // returned plain text — either is OK; we only assert the line renders.
  assert.match(line, /DEVELOPER-LOOP/);
});
