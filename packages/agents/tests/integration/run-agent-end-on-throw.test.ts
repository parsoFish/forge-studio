/**
 * Row 206 follow-on (T1, mid-session addition) — `runAgent`'s main
 * (non-caller-lifecycle) path writes its `start` event (`run-agent.ts`
 * ~L393) then calls `runOneShotSpawn`/`runInvocationSpawn` with no
 * try/catch around either call. A throwing SDK stream therefore propagates
 * straight past the `end` emission (~L503), leaving the run's own
 * `events.jsonl` with a `start` and nothing else — the same shape
 * `kind-turn-log-contract.test.ts` pins for `runKindTurn`. Every start must
 * get exactly one end.
 *
 * Split into its own file rather than grown onto `run-agent.test.ts` /
 * `run-agent-w7b5.test.ts` (both near the 800-line cap).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../../run-agent.ts';
import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts';
import { FORGE_ROOT } from '@forge/kernel';

const ROOT = FORGE_ROOT;

function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} agent in the roster`);
  return def!;
}

/** One-shot-path def (declared `loopStrategy: 'one-shot'`) — the simplest,
 *  most directly-controllable spawn road (`runOneShotSpawn`): a plain `for
 *  await` over the injected stream, no adapter in between. Mirrors
 *  `run-agent.test.ts`/`run-agent-spawn-capture.test.ts`'s own `oneShotClone`. */
function oneShotClone(def: AgentDefinition): AgentDefinition {
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' }, budgets: {} };
}

/** A queryFn whose stream yields one assistant message then throws —
 *  mirrors fix-turn-capture.test.ts's own "throwing stream" stub. */
function throwingStreamQueryFn(): StreamQueryFn {
  return (() => {
    async function* gen() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'about to fail' }] } };
      throw new Error('pinned stream failure');
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function readEvents(logsRoot: string, runId: string): Array<Record<string, unknown>> {
  return readFileSync(join(logsRoot, runId, 'events.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('runAgent: a throwing SDK stream still terminates the run-level log with exactly one end, naming the error, then rethrows', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'run-agent-end-on-throw-'));
  const runId = '_agent-psr-throw';
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));

    await assert.rejects(
      runAgent(def, { runId, workdir: logsRoot, prompt: 'test', logsRoot, queryFn: throwingStreamQueryFn() }),
      /pinned stream failure/,
      'the throw must still propagate — this fix changes event logging, not control flow',
    );

    const events = readEvents(logsRoot, runId);
    const types = events.map((e) => e.event_type);
    assert.equal(types.filter((t) => t === 'start').length, 1, `exactly one start, got ${JSON.stringify(types)}`);
    assert.equal(types.filter((t) => t === 'end').length, 1, `a throwing SDK stream must still get exactly one end — no end at all misreads as perpetually in flight; two ends is a double-count. Got ${JSON.stringify(types)}`);

    const end = events.find((e) => e.event_type === 'end') as { metadata?: Record<string, unknown> } | undefined;
    const meta = end?.metadata ?? {};
    assert.match(String(meta.error), /Error: pinned stream failure/, 'the end must carry the thrown class + message');
    // MEDIUM-4 (row 206 follow-up) — the ONE failure marker every runner's
    // error-end shares (`errorEndMetadata`, @forge/kernel): a reader checks
    // THIS field, never the mere presence of an `end` event, to tell a
    // crash from a finish.
    assert.equal(meta.status, 'failed', 'a crashed run must carry the shared failure marker');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});
