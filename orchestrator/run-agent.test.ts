/**
 * Tests for `runAgent` (R2-01-F1) — the generic agent-as-runnable primitive.
 *
 * Uses the queryFn stub pattern from `loops/ralph/claude-agent.test.ts` (the
 * canonical stub for this exact spawn path: a fake `query`-shaped function
 * that records calls and yields a fixed SDK message stream), retyped to
 * `SdkQueryFn` — the locked `RunContext.queryFn` shape — rather than
 * inventing a new SDK stub shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { SdkQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';

const ROOT = process.cwd();

/** Build a fake SDK query() that yields a single `result` message reporting
 * the given cost — mirrors `fakeQuery` in loops/ralph/claude-agent.test.ts,
 * retyped as `SdkQueryFn` to match RunContext.queryFn's locked shape. */
function fakeQueryFn(costUsd: number): SdkQueryFn {
  return ((_params: { prompt: unknown; options?: unknown }) => {
    async function* gen() {
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: costUsd,
        usage: { input_tokens: 11, output_tokens: 22 },
      };
    }
    return gen();
  }) as unknown as SdkQueryFn;
}

/** A queryFn that fails the test if the SDK is ever actually invoked — for
 * proving the dry-bridge / no-spawn seam never reaches the real spawn. */
const throwingQueryFn: SdkQueryFn = ((() => {
  throw new Error('runAgent must not invoke queryFn under dry-bridge / no-spawn suppression');
}) as unknown) as SdkQueryFn;

/** Look up a named library fixture from the roster, failing with a clear
 * message (rather than a bare TypeError on a `!`-asserted `undefined`) if
 * the fixture is ever renamed or removed from the roster. */
function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

function readEvents(logFilePath: string): Array<Record<string, unknown>> {
  return readFileSync(logFilePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Save + delete the spawn-suppression env vars so a test exercises the real
 * (non-suppressed) spawn path deterministically, regardless of what the
 * ambient shell/CI has set (CI's `env: FORGE_ARCHITECT_NO_SPAWN: "1"` step
 * config is inherited by every `node --test` child process). Mirrors the
 * save/delete/restore idiom the suppression tests below use for their own
 * var, generalised to both suppression vars; call the returned restore
 * function from a `finally`.
 */
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

// ---------------------------------------------------------------------------
// AC #2 + AC #3: no project/initiative binding; start+end events with cost_usd
// ---------------------------------------------------------------------------

test('runAgent: no-binding fixture runs standalone and emits start+end JSONL with cost_usd (AC #2, #3)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-nobind-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');

    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const result = await runAgent(def, {
      runId: '_agent-test',
      workdir,
      prompt: 'Audit the gitpulse project end state against its roadmap intents.',
      logsRoot,
      // Deliberately NO `bindings` — AC #2: no project/initiative binding.
      queryFn: fakeQueryFn(0.42),
    });

    assert.equal(result.suppressed, false);
    assert.equal(result.costUsd, 0.42, "end event's cost_usd must equal the stub's reported cost");
    assert.equal(result.tokensIn, 11);
    assert.equal(result.tokensOut, 22);

    const events = readEvents(join(logsRoot, '_agent-test', 'events.jsonl'));
    const start = events.find((e) => e.event_type === 'start');
    const end = events.find((e) => e.event_type === 'end');
    assert.ok(start, 'expected a start event');
    assert.ok(end, 'expected an end event');
    assert.equal(start!.skill, 'project-scoped-review');
    assert.equal(start!.phase, 'orchestrator');
    assert.equal((start!.metadata as Record<string, unknown>).agent_slug, 'project-scoped-review');
    assert.equal(end!.cost_usd, 0.42);
    assert.equal(typeof end!.duration_ms, 'number');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    restoreEnv();
  }
});

// ---------------------------------------------------------------------------
// AC #1: every library:true roster agent runs via runAgent without throwing
// ---------------------------------------------------------------------------

test('runAgent: every library roster agent (listAgentDefinitions) runs without throwing (AC #1)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-roster-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    assert.ok(defs.length > 0, 'expected at least one roster agent to drive through runAgent');

    for (const def of defs) {
      const workdir = mkdtempSync(join(scratchRoot, `${def.slug}-`));
      const logsRoot = join(scratchRoot, '_logs');
      const runId = `_agent-${def.slug}`;

      const result = await runAgent(def, {
        runId,
        workdir,
        prompt: 'test',
        logsRoot,
        queryFn: fakeQueryFn(0.01),
      });

      assert.equal(result.suppressed, false, `${def.slug}: expected a real (non-suppressed) run`);

      const events = readEvents(join(logsRoot, runId, 'events.jsonl'));
      assert.ok(
        events.some((e) => e.event_type === 'start'),
        `${def.slug}: expected a start event`,
      );
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    restoreEnv();
  }
});

// ---------------------------------------------------------------------------
// Dry-bridge / no-spawn suppression (harness safety, born inside the seam)
// ---------------------------------------------------------------------------

test('runAgent: FORGE_DRY_BRIDGE=1 suppresses the spawn — queryFn never called, spawn-suppressed event emitted', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-dry-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const result = await runAgent(def, {
      runId: '_agent-dry',
      workdir,
      prompt: 'test',
      logsRoot,
      queryFn: throwingQueryFn,
    });

    assert.equal(result.suppressed, true);
    assert.equal(result.costUsd, 0);
    assert.equal(result.tokensIn, 0);
    assert.equal(result.tokensOut, 0);
    assert.deepEqual(result.outputRefs, []);

    const events = readEvents(join(logsRoot, '_agent-dry', 'events.jsonl'));
    const skip = events.find((e) => e.event_type === 'log' && e.message === 'run-agent.spawn-suppressed');
    assert.ok(skip, 'expected a run-agent.spawn-suppressed log event');
    assert.equal((skip!.metadata as Record<string, unknown>).reason, 'FORGE_DRY_BRIDGE');
    assert.equal((skip!.metadata as Record<string, unknown>).agent_slug, 'project-scoped-review');
    assert.ok(events.some((e) => e.event_type === 'start'), 'the start event must still be emitted before suppression');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

test('runAgent: FORGE_ARCHITECT_NO_SPAWN=1 suppresses the spawn — queryFn never called, spawn-suppressed event emitted', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-nospawn-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const result = await runAgent(def, {
      runId: '_agent-nospawn',
      workdir,
      prompt: 'test',
      logsRoot,
      queryFn: throwingQueryFn,
    });

    assert.equal(result.suppressed, true);
    assert.equal(result.costUsd, 0);

    const events = readEvents(join(logsRoot, '_agent-nospawn', 'events.jsonl'));
    const skip = events.find((e) => e.event_type === 'log' && e.message === 'run-agent.spawn-suppressed');
    assert.ok(skip, 'expected a run-agent.spawn-suppressed log event');
    assert.equal((skip!.metadata as Record<string, unknown>).reason, 'FORGE_ARCHITECT_NO_SPAWN');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
  }
});

// ---------------------------------------------------------------------------
// Fail-fast validation
// ---------------------------------------------------------------------------

test('runAgent: fails fast on a missing workdir', async () => {
  const defs = listAgentDefinitions(join(ROOT, 'skills'));
  const def = getFixtureDef(defs, 'project-scoped-review');
  await assert.rejects(() =>
    runAgent(def, {
      runId: '_agent-badworkdir',
      workdir: '',
      prompt: 'test',
      queryFn: fakeQueryFn(0),
    }),
  );
});

test('runAgent: fails fast on a missing prompt', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-badprompt-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    await assert.rejects(() =>
      runAgent(def, {
        runId: '_agent-badprompt',
        workdir: scratchRoot,
        prompt: '',
        queryFn: fakeQueryFn(0),
      }),
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Security: runId path-traversal guard (fixture test, mirrors
// review-comments.test.ts's `writeReviewComments: rejects a path-traversal
// cycleId`) — a malicious/traversing runId must throw before any I/O and
// must never write anything outside logsRoot.
// ---------------------------------------------------------------------------

test('runAgent: rejects a path-traversal runId and writes nothing outside logsRoot', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-traversal-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '../../etc/evil',
          workdir,
          prompt: 'test',
          logsRoot,
          queryFn: throwingQueryFn,
        }),
      /unsafe runId/,
    );

    assert.ok(!existsSync(logsRoot), 'the guard fires before any logsRoot I/O — the logs dir is never created');
    assert.ok(
      !existsSync(join(scratchRoot, 'etc', 'evil')) && !existsSync(join(tmpdir(), 'etc', 'evil')),
      'nothing written outside logsRoot',
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: rejects an absolute-path runId', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-abspath-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '/etc/evil',
          workdir,
          prompt: 'test',
          logsRoot,
          queryFn: throwingQueryFn,
        }),
      /unsafe runId/,
    );

    assert.ok(!existsSync(logsRoot), 'the guard fires before any logsRoot I/O — the logs dir is never created');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
