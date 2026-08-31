/**
 * W7-FIX-A2 (W7A2-01, HIGH) — the terminal `cancelled` phase is STICKY at
 * the ONE status-write seam, and every runner completion honours it.
 *
 * The sweep confirmed: cancel writes `phase: 'cancelled'` and returns 200,
 * but a turn the bridge never tracked (onboarding's `spawnAgentDispatch`
 * child) or a turn already past its SIGTERM keeps running and, on
 * completion, spreads its STALE pre-turn status object over the terminal
 * phase — resurrecting the session into `complete`/`failed`/`awaiting-…`.
 * Nothing on the write path re-read the on-disk phase.
 *
 * Pins (RED at branch base):
 *   1. `guardedWriteSessionStatus` (orchestrator/interactive-session.ts —
 *      the primitive EVERY status write rides) refuses to overwrite an
 *      on-disk `cancelled` phase with any other phase: returns null and the
 *      file is byte-unchanged. It still allows cancelled→cancelled (a
 *      re-stamp) and every non-cancelled→X write (no behaviour change for
 *      the live routes).
 *   2. `runInteractiveTurn`'s post-turn `next` write: a session cancelled
 *      WHILE the agent turn runs stays `cancelled` on disk afterwards; the
 *      runner reports the discard loudly (a named error, so stderr.log
 *      records that a turn finished after the cancel), never a silent
 *      resurrection.
 *   3. `CANCELLED_PHASE` lives at the seam (orchestrator) and
 *      cli/bridge-studio.ts re-exports the SAME value — one constant.
 *
 * RUN: node --test --experimental-strip-types orchestrator/interactive-session-cancel-sticky.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  guardedWriteSessionStatus,
  guardedReadSessionStatus,
  writeSessionStatus,
  readSessionStatus,
  cancelledPhaseWins,
  CANCELLED_PHASE,
  type QueryFn,
} from './interactive-session.ts';
import { CANCELLED_PHASE as BRIDGE_CANCELLED_PHASE } from '../cli/bridge-studio.ts';
import { runInteractiveTurn } from './interactive-runner.ts';
import { loadSessionKinds } from './studio/session-kinds.ts';
import { createLogger } from './logging.ts';

// ---------------------------------------------------------------------------
// 3. ONE constant
// ---------------------------------------------------------------------------

test('sticky-cancel: CANCELLED_PHASE is defined at the orchestrator seam and cli/bridge-studio.ts re-exports the identical value', () => {
  assert.equal(CANCELLED_PHASE, 'cancelled');
  assert.equal(BRIDGE_CANCELLED_PHASE, CANCELLED_PHASE);
});

test('sticky-cancel: cancelledPhaseWins is true ONLY for on-disk cancelled + a different incoming phase', () => {
  assert.equal(cancelledPhaseWins('cancelled', 'complete'), true);
  assert.equal(cancelledPhaseWins('cancelled', 'awaiting-review'), true);
  assert.equal(cancelledPhaseWins('cancelled', 'cancelled'), false, 'a re-stamp of cancelled is not a resurrection');
  assert.equal(cancelledPhaseWins('running', 'cancelled'), false, 'cancelling a live session is the normal transition');
  assert.equal(cancelledPhaseWins('running', 'complete'), false);
  assert.equal(cancelledPhaseWins(undefined, 'complete'), false, 'no on-disk status at all is a first write');
  assert.equal(cancelledPhaseWins('cancelled', undefined), true, 'an incoming status with NO phase must not clobber cancelled either');
});

// ---------------------------------------------------------------------------
// 1. The seam
// ---------------------------------------------------------------------------

function seamFixture(): { projectsRoot: string; dirSegs: string[]; statusPath: string } {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'sticky-cancel-seam-'));
  const dirSegs = ['proj', '_onboarding', '2026-08-19T10-00-00'];
  const dir = join(projectsRoot, ...dirSegs);
  mkdirSync(dir, { recursive: true });
  return { projectsRoot, dirSegs, statusPath: join(dir, 'status.json') };
}

test('sticky-cancel seam: guardedWriteSessionStatus refuses to overwrite an on-disk cancelled phase with complete — returns null, file byte-unchanged', () => {
  const { projectsRoot, dirSegs, statusPath } = seamFixture();
  const cancelledBody = { phase: CANCELLED_PHASE, project: 'proj', runId: 'r1', cancelled_from: 'running', cancelled_at: '2026-08-19T10:05:00.000Z' };
  writeFileSync(statusPath, JSON.stringify(cancelledBody, null, 2));
  const before = readFileSync(statusPath);

  // The exact shape agent-run.ts's writeSessionTerminalPhase / a runner's
  // final write produce: a STALE pre-turn object spread with the new phase.
  const stale = { phase: 'running', project: 'proj', runId: 'r1', startedAt: '2026-08-19T10:00:00.000Z' };
  const written = guardedWriteSessionStatus(projectsRoot, dirSegs, { ...stale, phase: 'complete' });
  assert.equal(written, null, 'a late completion must be REFUSED at the seam');
  assert.deepEqual(readFileSync(statusPath), before, 'status.json must be byte-unchanged (no updated_at re-stamp either)');
  assert.equal(guardedReadSessionStatus<{ phase: string }>(projectsRoot, dirSegs)?.phase, CANCELLED_PHASE);
});

test('sticky-cancel seam: cancelled→cancelled (a re-stamp) and every non-cancelled→X write are still accepted — the live routes are unaffected', () => {
  const { projectsRoot, dirSegs } = seamFixture();
  // First write (no file yet) — accepted.
  assert.notEqual(guardedWriteSessionStatus(projectsRoot, dirSegs, { phase: 'running' }), null);
  // Normal advance — accepted.
  assert.notEqual(guardedWriteSessionStatus(projectsRoot, dirSegs, { phase: 'awaiting-review' }), null);
  // The cancel transition itself — accepted.
  assert.notEqual(guardedWriteSessionStatus(projectsRoot, dirSegs, { phase: CANCELLED_PHASE, cancelled_from: 'awaiting-review' }), null);
  // A second cancel-shaped write (idempotent re-stamp) — accepted, still cancelled.
  assert.notEqual(guardedWriteSessionStatus(projectsRoot, dirSegs, { phase: CANCELLED_PHASE, cancelled_from: 'awaiting-review', note: 'again' }), null);
  assert.equal(guardedReadSessionStatus<{ phase: string }>(projectsRoot, dirSegs)?.phase, CANCELLED_PHASE);
});

test('sticky-cancel seam: an incoming status object WITHOUT a phase key cannot clobber cancelled either (a partial spread is not a bypass)', () => {
  const { projectsRoot, dirSegs, statusPath } = seamFixture();
  writeFileSync(statusPath, JSON.stringify({ phase: CANCELLED_PHASE }));
  const before = readFileSync(statusPath);
  assert.equal(guardedWriteSessionStatus(projectsRoot, dirSegs, { note: 'no phase here' }), null);
  assert.deepEqual(readFileSync(statusPath), before);
});

// ---------------------------------------------------------------------------
// 2. runInteractiveTurn — a mid-turn cancel wins over the post-turn `next` write
// ---------------------------------------------------------------------------

const FIXTURE_YAML = `
- id: sticky-kind
  agent: project-brain-builder
  title: Sticky Cancel Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _stickytest
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;

test('sticky-cancel runner: a session cancelled WHILE the agent turn runs stays cancelled on disk — the runner refuses the post-turn advance loudly (named error), never resurrects awaiting-review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sticky-cancel-runner-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-19T11-00-00';
  const sessionDir = join(projectRoot, '_stickytest', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  const descriptor = loadSessionKinds(forgeRoot).find((d) => d.id === 'sticky-kind')!;

  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      // The agent does its work…
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'out.md'), '# out\n');
      // …and MEANWHILE the operator cancels (the generic cancel route's
      // exact write shape: the reserved terminal phase + transition facts).
      const current = readSessionStatus<Record<string, unknown>>(sessionDir)!;
      writeSessionStatus(sessionDir, { ...current, phase: CANCELLED_PHASE, cancelled_from: 'analyzing', cancelled_at: new Date().toISOString() });
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await assert.rejects(
    runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: createLogger(`_sticky-${sessionId}`, logsRoot) }),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error');
      assert.match(err.message, /cancelled/i, `the refusal must NAME the cancel; got: ${err.message}`);
      assert.doesNotMatch(err.message, /containment/i, 'a sticky-cancel refusal is not a containment failure and must not be reported as one');
      return true;
    },
  );
  const after = readSessionStatus<{ phase: string; cancelled_from?: string }>(sessionDir);
  assert.equal(after?.phase, CANCELLED_PHASE, 'status.json must STAY cancelled — the late turn completion must not overwrite it');
  assert.equal(after?.cancelled_from, 'analyzing', 'the cancel transition facts survive too');
});
