/**
 * ACCEPTANCE TESTS (wave-8, b1) — `runOneShotSpawn` must report the files an
 * agent actually wrote instead of a hardcoded `outputRefs: []`.
 *
 * Every catalog agent declaring `loopStrategy: 'one-shot'` (reflector,
 * adversarial-review, project-manager, demo-agent, contract-check,
 * release-finalizer) dispatches down this path. Before this fix, the run
 * view rendered "No outputs recorded for this run" /
 * `data-outputs-count="0"` for every one of them regardless of what the
 * agent actually did.
 *
 * Harness pattern copied from `run-agent-w7b5.test.ts` (the canonical stub
 * for this exact spawn path — a fake `queryFn` that records calls and yields
 * a scripted SDK message stream, retyped as `StreamQueryFn`) — NOT a new
 * harness.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';

const ROOT = process.cwd();

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

/** `project-scoped-review` cloned onto the one-shot loopStrategy (mirrors
 *  run-agent-w7b5.test.ts's fixture pattern) — a real roster def, no
 *  loopStrategy other than one-shot needed for this lane. */
function oneShotClone(def: AgentDefinition): AgentDefinition {
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' }, budgets: {} };
}

type ToolBlock = { name: string; input: unknown };

/** Fake queryFn that streams one assistant message per element of
 *  `messages` (each a list of tool_use blocks), then a `result` message —
 *  the per-turn transcript shape `extractLiveToolDetails` reads. */
function toolStreamQueryFn(messages: ToolBlock[][], costUsd = 0.05): StreamQueryFn {
  return ((_params: { prompt: unknown; options?: Record<string, unknown> }) => {
    async function* gen() {
      let msgId = 0;
      for (const blocks of messages) {
        msgId += 1;
        yield {
          type: 'assistant',
          message: {
            id: `msg_${msgId}`,
            content: blocks.map((b) => ({ type: 'tool_use', name: b.name, input: b.input })),
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        };
      }
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: costUsd,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function makeRunDir(prefix: string): { logsRoot: string; cleanup: () => void } {
  const logsRoot = mkdtempSync(join(tmpdir(), prefix));
  return { logsRoot, cleanup: () => rmSync(logsRoot, { recursive: true, force: true }) };
}

test('one-shot self lifecycle: Write + Edit tool_use blocks land in outputRefs, in first-seen order', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const { logsRoot, cleanup } = makeRunDir('w8b1-outputs-order-');
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const result = await runAgent(def, {
      runId: '_agent-oneshot-order',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: toolStreamQueryFn([
        [
          { name: 'Write', input: { file_path: '/tmp/w8b1-a.md' } },
          { name: 'Edit', input: { file_path: '/tmp/w8b1-b.md' } },
        ],
      ]),
    });
    assert.deepEqual(result.outputRefs, ['/tmp/w8b1-a.md', '/tmp/w8b1-b.md']);
  } finally {
    restore();
    cleanup();
  }
});

test('one-shot self lifecycle: the same file touched twice (across two assistant messages) appears once', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const { logsRoot, cleanup } = makeRunDir('w8b1-outputs-dedup-');
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const result = await runAgent(def, {
      runId: '_agent-oneshot-dedup',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: toolStreamQueryFn([
        [{ name: 'Write', input: { file_path: '/tmp/w8b1-dup.md' } }],
        [{ name: 'Edit', input: { file_path: '/tmp/w8b1-dup.md' } }],
      ]),
    });
    assert.deepEqual(result.outputRefs, ['/tmp/w8b1-dup.md']);
  } finally {
    restore();
    cleanup();
  }
});

test('one-shot self lifecycle: no file-modifying tools in the stream -> outputRefs is [] (no fabricated refs)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const { logsRoot, cleanup } = makeRunDir('w8b1-outputs-none-');
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const result = await runAgent(def, {
      runId: '_agent-oneshot-none',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: toolStreamQueryFn([[{ name: 'Bash', input: { command: 'ls' } }]]),
    });
    assert.deepEqual(result.outputRefs, []);
  } finally {
    restore();
    cleanup();
  }
});

test('one-shot self lifecycle: read-only tools (Read/Grep) never contribute an output ref', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const { logsRoot, cleanup } = makeRunDir('w8b1-outputs-readonly-');
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const result = await runAgent(def, {
      runId: '_agent-oneshot-readonly',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: toolStreamQueryFn([
        [
          { name: 'Read', input: { file_path: '/tmp/w8b1-read.md' } },
          { name: 'Grep', input: { pattern: 'x' } },
        ],
      ]),
    });
    assert.deepEqual(result.outputRefs, []);
  } finally {
    restore();
    cleanup();
  }
});

test('caller lifecycle: the refs reach the caller too (the call site a naive self-branch-only fix misses)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  try {
    const def = oneShotClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const result = await runAgent(def, {
      runId: '',
      workdir: '/tmp',
      prompt: 'test',
      lifecycle: 'caller',
      queryFn: toolStreamQueryFn([[{ name: 'Write', input: { file_path: '/tmp/w8b1-caller.md' } }]]),
    });
    assert.deepEqual(result.outputRefs, ['/tmp/w8b1-caller.md']);
  } finally {
    restore();
  }
});
