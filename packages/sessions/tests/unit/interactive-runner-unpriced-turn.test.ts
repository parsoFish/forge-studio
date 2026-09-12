/**
 * A turn that ENDS without the SDK's priced `result` still writes a terminal
 * row — `forge-8vfn.7.6.55`, D's ruling 799, T1 ruling 849.
 *
 * WHAT D MEASURED. S7 run 4: the authoring agent (pid 3269444) died with no
 * terminal event (`NOT reaped: SIGTERM failed: kill ESRCH`), and 7.6.51's
 * enforcer printed `spend UNMEASURED against ceiling $25.00 — nothing was
 * priced` at every beat. Honest, and blind exactly when it matters: an enforced
 * ceiling had nothing to compare against precisely because the run had gone
 * wrong.
 *
 * TOKENS, NOT DOLLARS, AND THAT IS THE RULING NOT A SHORTCUT. `total_cost_usd`
 * reaches us only on the SDK's terminal `result`, which this turn never emits,
 * and forge deliberately has no pricing table to convert tokens with
 * (`ralph/claude-agent.ts:136`, `_adapters/gemini/index.ts:212`). 849 refused
 * to add one: a ceiling compared against a figure we derived ourselves fails in
 * the direction that LOOKS safe. So the row carries what was observed and omits
 * `cost_usd` entirely — absent, never zeroed — which is why the last assertion
 * here is that the session's cost still reads `null`.
 *
 * THE TWO TOKEN FIELDS ARE ACCUMULATED DIFFERENTLY and the fixture is built to
 * catch a conflation: each assistant message carries ITS OWN call's usage, so
 * `output_tokens` sums while `input_tokens` is the whole conversation re-sent
 * and must NOT. The two messages below therefore carry different input figures,
 * so a summing implementation reports 900 where the honest answer is 700.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInteractiveTurn } from '../../interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';
import { readSessionCostUsd } from '../../session-readability.ts';

const FIXTURE_SESSION_KINDS_YAML = `
- id: unpricedkind
  agent: project-brain-builder
  title: Unpriced Turn Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _unpriced
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;

type TestStatus = { session_id: string; phase: string; updated_at: string };

function descriptorFor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

/** Every event row the runner wrote, from the log dir the session route reads. */
function eventsUnder(logsRoot: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(logsRoot); } catch { return out; }
  for (const d of dirs) {
    let text: string;
    try { text = readFileSync(join(logsRoot, d, 'events.jsonl'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* a partial line is not this door's business */ }
    }
  }
  return out;
}

/** Two assistant messages carrying usage, then a mid-stream death. The agent
 *  really did consume tokens before it fell over; that is the whole point. */
function dyingQueryFn(sessionDir: string): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'draft.md'), '# staged\n');
      yield {
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 400, output_tokens: 120, cache_read_input_tokens: 30 } },
      };
      yield {
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 700, output_tokens: 55, cache_read_input_tokens: 90 } },
      };
      throw new Error('synthetic mid-stream death (the SDK child went away)');
    }
    return gen();
  };
}

function setUp(sessionId: string): { forgeRoot: string; projectRoot: string; logsRoot: string; sessionDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-unpriced-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionDir = join(projectRoot, '_unpriced', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
  });
  return { forgeRoot, projectRoot, logsRoot, sessionDir };
}

test('7.6.55: a turn that dies mid-stream writes a terminal row naming the reason', async () => {
  const sessionId = '2026-09-12T00-00-00-died';
  const { forgeRoot, projectRoot, logsRoot, sessionDir } = setUp(sessionId);

  // The turn MUST still fail — this fix makes a failure visible to spend, it
  // does not swallow one. A version that stopped throwing would be a far worse
  // bug than the one being fixed.
  await assert.rejects(
    () => runInteractiveTurn(descriptorFor(forgeRoot, 'unpricedkind'), {
      sessionId, projectRoot, forgeRoot, logsRoot, queryFn: dyingQueryFn(sessionDir),
    }),
    /synthetic mid-stream death/,
    'the original error must reach the caller unchanged',
  );

  const rows = eventsUnder(logsRoot);
  const unpriced = rows.filter((r) => r['message'] === 'interactive.turn-ended-unpriced');
  assert.equal(unpriced.length, 1, `exactly one terminal row for the dead turn:\n${JSON.stringify(rows, null, 2)}`);

  const row = unpriced[0]!;
  const meta = row['metadata'] as Record<string, unknown>;
  assert.equal(meta['unpriced_reason'], 'died', 'the row names WHY it is unpriced');
  assert.equal(meta['session_id'], sessionId);

  // Observed consumption, accumulated honestly: outputs SUM (120 + 55), inputs
  // do NOT (the second call's 700 is the conversation re-sent, not new spend).
  assert.equal(row['tokens_out'], 175, 'output tokens are additive across calls');
  assert.equal(row['tokens_in'], 700, 'input tokens are the LAST call, never a sum');
  assert.equal(row['cache_read_tokens'], 90, 'cache reads follow the same last-value rule');
});

test('7.6.55: the unpriced row carries NO cost_usd — absent, never zeroed', async () => {
  const sessionId = '2026-09-12T00-00-00-nocost';
  const { forgeRoot, projectRoot, logsRoot, sessionDir } = setUp(sessionId);

  await assert.rejects(() => runInteractiveTurn(descriptorFor(forgeRoot, 'unpricedkind'), {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn: dyingQueryFn(sessionDir),
  }));

  const unpriced = eventsUnder(logsRoot).filter((r) => r['message'] === 'interactive.turn-ended-unpriced');
  assert.equal(unpriced.length, 1);
  assert.equal(
    Object.hasOwn(unpriced[0]!, 'cost_usd'), false,
    'a zero here would read as "this turn was free"; the truth is "nobody priced it"',
  );

  // The distinction the whole `null`-not-zero discipline exists to keep. A run
  // whose only turn died still has NO figure — the row makes the absence
  // diagnosable without making it look like a measurement.
  assert.equal(
    readSessionCostUsd({ logsRoot, kind: 'unpricedkind', sessionId }), null,
    'an unpriced turn must not start reporting $0.00 just because it now logs something',
  );
});
