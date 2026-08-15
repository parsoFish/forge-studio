import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPreflightFixTurn, type QueryFn } from './preflight-fix-runner.ts';
import { REDACTED_THINKING_MARKER } from './interactive-session.ts';

function setup(): { forgeRoot: string; projectDir: string; logsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-fix-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  return { forgeRoot, projectDir, logsRoot: join(forgeRoot, '_logs') };
}

/** A query stub that runs `effect` (the agent's "edit") then yields a result. */
function makeQueryFn(effect?: () => void): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      effect?.();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

test('agent edit clears the clause → cleared: true (re-run verified)', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    // C5 (locked-core) fails with no constraints doc; the agent writes one.
    const r = await runPreflightFixTurn({
      runId: 'test-c5',
      projectDir,
      clause: 'C5',
      instruction: 'forge honours git ownership; never edit tests to pass.',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(() => writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '# Constraints\n\nNo test tampering.\n')),
    });
    assert.equal(r.cleared, true);
    assert.ok(existsSync(join(projectDir, 'CONSTRAINTS.md')));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('agent makes no edit → cleared: false (verification gate holds)', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    const r = await runPreflightFixTurn({
      runId: 'test-noop',
      projectDir,
      clause: 'C5',
      instruction: '',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(), // no effect
    });
    assert.equal(r.cleared, false);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('emits a heartbeat + start/end events under _preflight-fix-<runId>/', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    await runPreflightFixTurn({
      runId: 'test-hb',
      projectDir,
      clause: 'C5',
      instruction: 'x',
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(),
    });
    assert.ok(existsSync(join(logsRoot, '_preflight-fix-test-hb', 'events.jsonl')), 'event log written');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// W6-B1: preflight-fix drove its own raw SDK stream loop with NO text/thinking
// sink at all before this change — this pins BOTH landing now, plus the
// unsampled Read tool_use contract every interactive-shaped runner shares.
test('W6-B1: reasoning + thinking blocks are forwarded to the log (kind: reasoning / thinking), redacted_thinking coalesces, and Read tool_use events are unsampled', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    const runId = 'test-run-thinking';
    const READ_CALLS = 6;
    const queryFn: QueryFn = () => {
      async function* gen(): AsyncGenerator<unknown> {
        const reads = Array.from({ length: READ_CALLS }, (_, i) => ({
          type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
        }));
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '  inspecting the failing clause  ' },
              { type: 'thinking', thinking: '  weighing where to apply the fix  ' },
              { type: 'redacted_thinking', data: 'opaque-1' },
              { type: 'redacted_thinking', data: 'opaque-2' }, // consecutive — must coalesce
              ...reads,
            ],
          },
        };
        yield { type: 'result', total_cost_usd: 0 };
      }
      return gen();
    };

    await runPreflightFixTurn({
      runId,
      projectDir,
      clause: 'C5',
      instruction: 'x',
      forgeRoot,
      logsRoot,
      queryFn,
    });

    const logPath = join(logsRoot, `_preflight-fix-${runId}`, 'events.jsonl');
    const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    const reasoningEvents = events.filter((e) => e.metadata?.kind === 'reasoning');
    assert.equal(reasoningEvents.length, 1);
    assert.equal(reasoningEvents[0].message, 'inspecting the failing clause');

    const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
    assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
    assert.equal(thinkingEvents[0].message, 'weighing where to apply the fix');
    assert.equal(thinkingEvents[1].message, REDACTED_THINKING_MARKER);

    const readToolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
    assert.equal(readToolUses.length, READ_CALLS, 'sampler opts {readOnlySampleRate:1, cap:200} — every Read emitted, none sampled out');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
