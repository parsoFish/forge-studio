/**
 * bead forge-8vfn.6.11.17 (ruling 241 step (a)) — WHERE the SDK idle deadline
 * lands on the ARCHITECT path, measured rather than assumed.
 *
 * S4 run 2 measured a real architect turn going silent after its 9th tool_use
 * at 16.1 s and staying ALIVE for ten minutes, with `stderr.log` 0 bytes and
 * `status.json` still reading `interviewing` at reap. Two traces should have
 * existed and neither did:
 *
 *   - `withIdleDeadline` (packages/agents/stream-deadline.ts) wraps every
 *     `runStructuredTurn` stream with a 6-minute idle window and THROWS
 *     `StreamDeadlineError` when it lapses;
 *   - `cmdAgentRun`'s failed-turn catch (packages/agents/agent-run.ts) writes a
 *     terminal `failed` phase into the session's `status.json` for any throw
 *     out of the runner.
 *
 * A session 6 probe already proved `withIdleDeadline` fires in ISOLATION (it
 * threw at 201 ms on a stream that went quiet). What was never measured is the
 * architect path itself — whether the throw survives
 * `runInterviewStep` → `runStructured` → `runStructuredTurn` and reaches the
 * caller that writes the terminal phase, or whether something between them
 * swallows it. These pins measure exactly that, at $0, with mocked timers so
 * the real 6-minute default is exercised without waiting for it.
 *
 * The positive control matters as much as the pin: a stream that keeps
 * PRODUCING must never be killed, because the deadline is an idle gap and not
 * a wall clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { DEFAULT_IDLE_DEADLINE_MS } from '@forge/agents/stream-deadline.ts';

/** The bound these pins advance past, written as a LITERAL on purpose.
 *  Deriving it from `DEFAULT_IDLE_DEADLINE_MS` made the first draft of this
 *  file agree with any value of that constant — widening the deadline 600x
 *  also widened the tick, and the pin stayed green. A pin whose expectation
 *  moves with the thing it measures measures nothing. AT-6.11.17-0 holds the
 *  constant to this number separately, so a deliberate change to the product's
 *  window fails there, loudly, instead of silently rescaling these two. */
const SIX_MINUTES_MS = 360_000;

/** The interview turn's shape: an assistant message carrying one `Read`
 *  tool_use, exactly as the nine rows in run 2's archived `events.jsonl`. */
function readMessage(path: string): unknown {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path } }] } };
}

function plantSession(): { projectRoot: string; logsRoot: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-idle-'));
  const projectRoot = join(root, 'projects', 'p1');
  mkdirSync(join(projectRoot, '_architect', 'sess-1'), { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1',
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round: 1,
    idea: 'measure where the idle deadline lands',
    updated_at: new Date().toISOString(),
  };
  writeFileSync(join(projectRoot, '_architect', 'sess-1', 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  const logsRoot = join(root, '_logs');
  mkdirSync(join(logsRoot, '_architect-sess-1'), { recursive: true });
  return { projectRoot, logsRoot, root };
}

test('AT-6.11.17-0 the architect turn inherits the 6-minute default idle window (no override)', () => {
  assert.equal(
    DEFAULT_IDLE_DEADLINE_MS,
    SIX_MINUTES_MS,
    'the architect step passes no `idleMs`, so this constant IS the architect turn\'s stream bound — ' +
      'changing it changes when a hung architect is aborted, and the two pins below advance past 360s literally',
  );
});

test('AT-6.11.17-1 a silent SDK stream on the ARCHITECT path throws StreamDeadlineError out of runArchitectTurn', async (t) => {
  const { projectRoot, logsRoot, root } = plantSession();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // Run 2's shape: a few tool_use messages, then the stream never produces
    // another message and never ends.
    const silentAfterReads: () => AsyncIterable<unknown> = () => ({
      async *[Symbol.asyncIterator]() {
        yield readMessage('brain/projects/p1/profile.md');
        yield readMessage('brain/projects/p1/themes/a.md');
        await new Promise<never>(() => {}); // silent forever — never resolves, never rejects
      },
    });

    const turn = runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(),
      sessionId: 'sess-1',
      projectRoot,
      logsRoot,
      brainCwd: root,
      queryFn: silentAfterReads as never,
    });
    const settled: { rejected?: unknown; resolved?: unknown } = {};
    void turn.then((v) => { settled.resolved = v; }, (e) => { settled.rejected = e; });

    // Let the two messages be consumed so the race on the third `next()` is armed.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    t.mock.timers.tick(SIX_MINUTES_MS + 1_000);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    assert.equal(settled.resolved, undefined, 'the turn must not resolve on a stream that never produced a result');
    assert.ok(settled.rejected, `the idle deadline must reject the architect turn — nothing was thrown after ${SIX_MINUTES_MS} ms of silence`);
    const err = settled.rejected as Error;
    assert.equal(err.name, 'StreamDeadlineError', `expected StreamDeadlineError, got ${err.name}: ${err.message}`);
    assert.match(err.message, /stream-deadline/, err.message);
  } finally {
    t.mock.timers.reset();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.11.17-2 (positive control) a stream that keeps PRODUCING is never killed by the idle deadline', async (t) => {
  const { projectRoot, logsRoot, root } = plantSession();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let emitted = 0;
    const productive: () => AsyncIterable<unknown> = () => ({
      async *[Symbol.asyncIterator]() {
        // Far more messages than the deadline's window would allow if it were a
        // wall clock; each one resets the idle gap.
        while (emitted < 50) {
          emitted += 1;
          yield readMessage(`brain/projects/p1/themes/${emitted}.md`);
        }
        yield { type: 'result', structured_output: { done: true, questions: [] }, total_cost_usd: 0.01 };
      },
    });

    const turn = runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(),
      sessionId: 'sess-1',
      projectRoot,
      logsRoot,
      brainCwd: root,
      queryFn: productive as never,
    });
    const settled: { rejected?: unknown; done?: boolean } = {};
    void turn.then(() => { settled.done = true; }, (e) => { settled.rejected = e; });

    for (let i = 0; i < 200; i += 1) await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    assert.equal(emitted, 50, `every message must have been consumed — got ${emitted}`);
    const rejectedName = settled.rejected instanceof Error ? settled.rejected.name : undefined;
    assert.notEqual(rejectedName, 'StreamDeadlineError', 'a producing stream must never trip the idle deadline');
  } finally {
    t.mock.timers.reset();
    rmSync(root, { recursive: true, force: true });
  }
});
