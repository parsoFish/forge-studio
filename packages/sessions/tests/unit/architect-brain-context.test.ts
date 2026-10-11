/**
 * forge-mfv5.1.24 — the architect PLAN's "Brain context" lists the brain files the SESSION read.
 *
 * gitweave I1 (architect session 2026-10-10T00-31-50-43ce1241): PLAN.md said "No brain entries
 * consulted (brain-gap event emitted)" while its constraints quoted five brain themes. The session
 * Read them during the INTERVIEW turns (its own `brain.read` events list sharp-edges, build-and-test,
 * structure, key-patterns, conventions); `brain_context` was built from the DRAFT turn's reads only.
 * And no brain-gap event was ever emitted — the PLAN text claimed one.
 *
 * Fixture: that session's `events.jsonl`, copied (`../test-fixtures/gitweave-i1-architect/`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { architectBrainContext, sessionBrainReadPaths } from '../../kinds/architect-brain-read.ts';
import type { EventLogger } from '@forge/kernel';

const I1_LOG = resolve(import.meta.dirname, '..', 'test-fixtures', 'gitweave-i1-architect', 'events.jsonl');
const FIVE = [
  'brain/projects/gitweave/themes/build-and-test.md',
  'brain/projects/gitweave/themes/conventions.md',
  'brain/projects/gitweave/themes/key-patterns.md',
  'brain/projects/gitweave/themes/sharp-edges.md',
  'brain/projects/gitweave/themes/structure.md',
];

function recorder(): { logger: EventLogger; events: Array<{ message?: string; event_type?: string; metadata?: Record<string, unknown> }> } {
  const events: Array<{ message?: string; event_type?: string; metadata?: Record<string, unknown> }> = [];
  const logger = { emit: (e: Record<string, unknown>) => { events.push(e as never); return { ...e, event_id: 'x' }; }, logFilePath: '' } as unknown as EventLogger;
  return { logger, events };
}

test('the I1 session read log names the five themes the interview turns read', () => {
  assert.deepEqual(sessionBrainReadPaths(I1_LOG), FIVE);
});

test('I1: the draft turn read no brain file, the session did — the PLAN lists all five and no gap is emitted', () => {
  const { logger, events } = recorder();
  const ctx = architectBrainContext({ draftReads: [], logFilePath: I1_LOG, logger, initiativeId: 'architect-session-I1' });
  assert.deepEqual(ctx.map((e) => e.path), FIVE);
  assert.equal(events.filter((e) => e.message === 'architect.brain-gap').length, 0);
});

test('draft reads (absolute paths) and session reads merge into one brain-relative list', () => {
  const { logger } = recorder();
  const ctx = architectBrainContext({ draftReads: ['/home/x/forge/brain/cycles/patterns.md', '/home/x/forge/brain/projects/gitweave/themes/structure.md'], logFilePath: I1_LOG, logger, initiativeId: 'a' });
  assert.deepEqual(ctx.map((e) => e.path), ['brain/cycles/patterns.md', ...FIVE]);
});

test('empty-log control: nothing read anywhere → "none" (empty context) AND the brain-gap event fires', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-brain-ctx-'));
  try {
    const log = join(dir, 'events.jsonl');
    writeFileSync(log, `${JSON.stringify({ message: 'architect turn (phase=interviewing)', event_type: 'start' })}\n`);
    const { logger, events } = recorder();
    assert.deepEqual(architectBrainContext({ draftReads: [], logFilePath: log, logger, initiativeId: 'a' }), []);
    const gap = events.filter((e) => e.message === 'architect.brain-gap');
    assert.equal(gap.length, 1);
    assert.equal(gap[0].event_type, 'brain-query', 'the brain event family, as brain.read uses');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refusal path: an unreadable read log is UNKNOWN — no "none consulted" claim and no gap event (§6.15)', () => {
  const { logger, events } = recorder();
  const ctx = architectBrainContext({ draftReads: [], logFilePath: '/nonexistent/events.jsonl', logger, initiativeId: 'a' });
  assert.equal(ctx.length, 1);
  assert.match(ctx[0].summary, /read log unreadable/);
  assert.equal(events.filter((e) => e.message === 'architect.brain-gap').length, 0);
});
