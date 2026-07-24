/**
 * Tests for `runAgent` (R2-01-F1) — the generic agent-as-runnable primitive.
 *
 * Uses the queryFn stub pattern from `loops/ralph/claude-agent.test.ts` (the
 * canonical stub for this exact spawn path: a fake `query`-shaped function
 * that records calls and yields a fixed SDK message stream), retyped to
 * `StreamQueryFn` — the locked `RunContext.queryFn` shape — rather than
 * inventing a new SDK stub shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';
import type { EventLogger, EventLogEntry } from './logging.ts';

const ROOT = process.cwd();

/** Build a fake SDK query() that yields a single `result` message reporting
 * the given cost — mirrors `fakeQuery` in loops/ralph/claude-agent.test.ts,
 * retyped as `StreamQueryFn` to match RunContext.queryFn's locked shape. */
function fakeQueryFn(costUsd: number): StreamQueryFn {
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
  }) as unknown as StreamQueryFn;
}

/** A queryFn that fails the test if the SDK is ever actually invoked — for
 * proving the dry-bridge / no-spawn seam never reaches the real spawn. */
const throwingQueryFn: StreamQueryFn = ((() => {
  throw new Error('runAgent must not invoke queryFn under dry-bridge / no-spawn suppression');
}) as unknown) as StreamQueryFn;

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
    const allDefs = listAgentDefinitions(join(ROOT, 'skills'));
    // R4-01-F2 (ADR-039): ralph-declaring defs (developer-ralph) are dispatched
    // by the flow engine's dev-loop pipeline — runAgent REJECTS them by design.
    // Assert the rejection explicitly, then sweep the rest.
    const ralphDefs = allDefs.filter((d) => d.runtime.loopStrategy === 'ralph');
    for (const def of ralphDefs) {
      const workdir = mkdtempSync(join(scratchRoot, `${def.slug}-ralph-`));
      await assert.rejects(
        () => runAgent(def, { runId: `_agent-${def.slug}`, workdir, prompt: 'test', queryFn: throwingQueryFn }),
        /loopStrategy 'ralph'/,
        `${def.slug}: a declared ralph loop must be rejected by the one-shot primitive`,
      );
    }
    const defs = allDefs.filter((d) => d.runtime.loopStrategy !== 'ralph');
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
// R2-01-F2 step D: RunContext.logger — injected-logger cost integration
// ---------------------------------------------------------------------------

/** A minimal spy EventLogger — records every emitted entry, echoing event_id
 * back like the real createLogger does, without touching the filesystem. */
function makeSpyLogger(cycleId: string): EventLogger & { events: EventLogEntry[] } {
  const events: EventLogEntry[] = [];
  return {
    cycleId,
    logFilePath: '<spy>',
    events,
    emit(entry) {
      const full: EventLogEntry = {
        event_id: entry.event_id ?? `evt-${events.length}`,
        cycle_id: cycleId,
        started_at: entry.started_at ?? new Date().toISOString(),
        ...entry,
      } as EventLogEntry;
      events.push(full);
      return full;
    },
  };
}

test('runAgent: an injected ctx.logger receives start/end(cost) events and no _logs dir is created (R2-01-F2 step D)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-injectedlogger-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');
    const spy = makeSpyLogger('_agent-injected');

    const result = await runAgent(def, {
      runId: '_agent-injected',
      workdir,
      prompt: 'test',
      logsRoot,
      logger: spy,
      queryFn: fakeQueryFn(0.17),
    });

    assert.equal(result.costUsd, 0.17);

    const start = spy.events.find((e) => e.event_type === 'start');
    const end = spy.events.find((e) => e.event_type === 'end');
    assert.ok(start, 'expected the injected logger to receive a start event');
    assert.ok(end, 'expected the injected logger to receive an end event');
    assert.equal(end!.cost_usd, 0.17, "the injected logger's end event must carry the real cost_usd");

    // No standalone log file was ever created — runAgent used ctx.logger
    // verbatim rather than also calling createLogger (no double emission).
    assert.ok(
      !existsSync(join(logsRoot, '_agent-injected', 'events.jsonl')),
      'runAgent must not create a standalone log file when ctx.logger is injected',
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    restoreEnv();
  }
});

test('runAgent: standalone path (no injected logger) still writes to _logs/<runId>/ (R2-01-F2 step D regression guard)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-standalonelogger-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    await runAgent(def, {
      runId: '_agent-standalone',
      workdir,
      prompt: 'test',
      logsRoot,
      // Deliberately NO `logger` — the standalone path must still work.
      queryFn: fakeQueryFn(0.05),
    });

    assert.ok(existsSync(join(logsRoot, '_agent-standalone', 'events.jsonl')));
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

// ---------------------------------------------------------------------------
// R4-01-F2: the declared one-shot runtime (loopStrategy / caps / lifecycle)
// ---------------------------------------------------------------------------

/** Clone a roster def with a declared one-shot runtime + optional budget caps.
 * The clone's `path` still points at the real SKILL.md (deriveAgentSpec reads
 * tools/model from disk); `runtime.loopStrategy` + `budgets` are read from the
 * in-memory def, which is exactly the seam under test. */
function oneShotClone(
  def: AgentDefinition,
  budgets: AgentDefinition['budgets'] = {},
): AgentDefinition {
  return {
    ...def,
    runtime: { ...def.runtime, loopStrategy: 'one-shot' },
    budgets,
  };
}

/** A capturing queryFn: records {prompt, options} and yields the given
 * message stream (default: one assistant message then a result). */
function capturingQueryFn(
  calls: Array<{ prompt: string; options: Record<string, unknown> }>,
  messages?: unknown[],
): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    async function* gen() {
      for (const m of messages ?? [
        { type: 'assistant', message: { content: [] } },
        {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.33,
          duration_ms: 1234,
          usage: { input_tokens: 7, output_tokens: 9 },
        },
      ]) {
        yield m;
      }
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** An EventLogger that fails the test on any emission — for proving the
 * caller lifecycle emits nothing from inside runAgent. */
function forbiddenLogger(): EventLogger {
  return {
    cycleId: 'forbidden',
    logFilePath: '/dev/null',
    emit: () => {
      throw new Error('lifecycle:caller must not emit events from runAgent');
    },
  } as unknown as EventLogger;
}

test('runAgent one-shot + lifecycle caller: direct query with spec/budget-shaped options, no events, no PROMPT.md', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-oneshot-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {
      maxTurns: 60,
      maxBudgetUsd: 1.5,
    });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const cwd = mkdtempSync(join(scratchRoot, 'cwd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const seen: unknown[] = [];
    const result = await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'one-shot parity prompt',
      systemPrompt: 'SYSTEM',
      cwd,
      lifecycle: 'caller',
      logger: forbiddenLogger(),
      onMessage: (m) => seen.push(m),
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'one-shot parity prompt');
    const opts = calls[0].options;
    assert.equal(opts.cwd, cwd);
    assert.equal(opts.systemPrompt, 'SYSTEM');
    assert.equal(opts.permissionMode, 'acceptEdits');
    assert.equal(opts.maxTurns, 60);
    assert.equal(opts.maxBudgetUsd, 1.5);
    assert.ok(Array.isArray(opts.allowedTools), 'allowedTools from the derived spec');
    assert.equal(opts.abortController, undefined, 'no streamGuard ⇒ no abortController (reflector shape)');

    assert.equal(result.costUsd, 0.33);
    assert.equal(result.durationMs, 1234);
    assert.equal(result.resultSubtype, 'success');
    assert.equal(result.tokensIn, 7);
    assert.equal(result.tokensOut, 9);
    assert.equal(result.suppressed, false);
    assert.equal(seen.length, 2, 'onMessage sees every streamed message (assistant + result)');
    assert.ok(!existsSync(join(workdir, 'PROMPT.md')), 'one-shot passes the prompt inline — no PROMPT.md stamp');
    assert.ok(!existsSync(join(workdir, '.forge')), 'no scratch dir either on the one-shot path');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: budget share composes with the flat floor (max of the two)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-share-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {
      maxBudgetUsd: 2.5,
      maxBudgetUsdShare: 0.2,
    });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    // share × 20 = 4 > floor 2.5 ⇒ 4
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      bindings: { initiative: { id: 'init-1', costBudgetUsd: 20 } },
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(calls[0].options.maxBudgetUsd, 4);

    // share × 5 = 1 < floor 2.5 ⇒ 2.5
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      bindings: { initiative: { id: 'init-1', costBudgetUsd: 5 } },
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(calls[1].options.maxBudgetUsd, 2.5);

    // no initiative binding ⇒ flat floor alone
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(calls[2].options.maxBudgetUsd, 2.5);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: streamGuard wires an abortController into the options (PM shape)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-guard-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      streamGuard: { label: 'guard-test' },
      queryFn: capturingQueryFn(calls),
    });
    assert.ok(
      calls[0].options.abortController instanceof AbortController,
      'streamGuard ⇒ abortController on the SDK options',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: rejects a declared ralph loopStrategy (loops are orchestrator-band)', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-ralph-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const base = getFixtureDef(defs, 'project-scoped-review');
    const def: AgentDefinition = { ...base, runtime: { ...base.runtime, loopStrategy: 'ralph' } };
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    await assert.rejects(
      () => runAgent(def, { runId: '_agent-test', workdir, prompt: 'p', queryFn: throwingQueryFn }),
      /loopStrategy 'ralph'/,
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: lifecycle caller requires a declared one-shot runtime', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-caller-guard-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review'); // no loopStrategy
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '',
          workdir,
          prompt: 'p',
          lifecycle: 'caller',
          queryFn: throwingQueryFn,
        }),
      /lifecycle 'caller' requires loopStrategy 'one-shot'/,
    );
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot + self lifecycle: emits start+end with the streamed cost; suppression still guards it', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-oneshot-self-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), { maxTurns: 10 });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId: '_agent-oneshot-self',
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(result.costUsd, 0.33);
    const events = readEvents(join(logsRoot, '_agent-oneshot-self', 'events.jsonl'));
    const types = events.map((e) => e.event_type);
    assert.deepEqual(types, ['start', 'end']);
    assert.equal(events[1].cost_usd, 0.33);
    assert.equal(events[1].duration_ms, 1234, 'end event carries the SDK-reported duration');

    // Suppression: self lifecycle still short-circuits under the env seam.
    process.env.FORGE_DRY_BRIDGE = '1';
    const suppressed = await runAgent(def, {
      runId: '_agent-oneshot-suppressed',
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: throwingQueryFn,
    });
    assert.equal(suppressed.suppressed, true);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent legacy invocation path: prompt lands in the .forge/agent-run scratch dir, not the worktree root (known-gaps §8)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-scratch-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review'); // no loopStrategy ⇒ legacy path
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    await runAgent(def, {
      runId: '_agent-scratch',
      workdir,
      prompt: 'scratch-path prompt',
      logsRoot,
      queryFn: fakeQueryFn(0.01),
    });

    assert.ok(!existsSync(join(workdir, 'PROMPT.md')), 'no PROMPT.md at the worktree root');
    assert.equal(
      readFileSync(join(workdir, '.forge', 'agent-run', 'PROMPT.md'), 'utf8'),
      'scratch-path prompt',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot + lifecycle caller: env suppression vars do NOT short-circuit (caller owns harness-safety — parity with the phase pipelines)', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-caller-env-'));
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(calls.length, 1, 'the injected stub runs — caller mode never consults the env seam');
    assert.equal(result.suppressed, false);
  } finally {
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
