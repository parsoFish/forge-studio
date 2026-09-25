/**
 * forge-8vfn.8.1.7 — an agent run's `events.jsonl` never carried `hook.fire`
 * for a bound `SessionEnd` hook.
 *
 * `emitHookFire` (`packages/agents/studio/hook-dispatch.ts`) only ran inside the SDK's
 * own `SessionEnd` hook callback, and the SDK's `SessionEnd` `ExitReason`s
 * (`clear | resume | logout | prompt_input_exit | other`) are all INTERACTIVE
 * teardown actions a headless `query()` completing never performs — so the
 * callback the SDK held for a `runAgent` spawn was registered and never
 * invoked. Forge's existing hook-dispatch tests only fake-invoked the
 * callback directly (`hook-dispatch.test.ts`'s `fire()` helper), so nothing
 * caught it.
 *
 * These tests drive the REAL `runAgent` entry point (never the SessionEnd
 * callback directly) against a real, on-disk, approved hook — the same
 * fixture-building idiom as `hook-dispatch.test.ts` (`writeAgent`/
 * `writeHook`/`approveHook`), pointed at a disposable scratch forgeRoot via
 * `RunContext.forgeRoot` (the new test-injection seam this fix adds) instead
 * of the real repo's library state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { runAgent } from '../../run-agent.ts';
import { loadAgentDefinition } from '../../studio/agent-registry.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts';
import { approveHook } from '@forge/library';
import type { HookPermissionManifest } from '@forge/library';

// ---------------------------------------------------------------------------
// Fixture helpers — a real on-disk scratch forge root: skills/<slug>/SKILL.md
// + studio/hooks/<id>/, exactly `hook-dispatch.test.ts`'s idiom. Nothing is
// mocked; the hook script really spawns.
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function cleanupAll(): void {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const NO_ENV: HookPermissionManifest = { env: [], read: [], network: false };

/** Writes a minimal roster-shaped SKILL.md binding `hooks`, then loads and
 * returns it as a real `AgentDefinition` via the production loader — mirrors
 * `run-agent.test.ts`'s `oneShotClone`, just sourced from a scratch root
 * instead of the real roster. */
function writeOneShotAgent(root: string, slug: string, hooks: string[]): AgentDefinition {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: Test agent ${slug} for the run-agent SessionEnd suite.`,
    'phase: reflection',
    'surface: unattended',
    'library: false',
    `purpose: Test agent ${slug}.`,
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: []',
    `  hooks: [${hooks.join(', ')}]`,
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    '  model: claude-haiku-4-5-20251001',
    'brainAccess: none',
    'interactivity: Fully autonomous.',
    'allowed-tools: [Read]',
    'disallowed-tools: [Bash]',
    'budgets: {}',
    '---',
    '',
    `# ${slug}`,
    '',
    'Test agent.',
    '',
  ].join('\n');
  const skillMdPath = join(dir, 'SKILL.md');
  writeFileSync(skillMdPath, frontmatter, 'utf8');
  const def = loadAgentDefinition(skillMdPath);
  // Declared one-shot so runAgent takes the direct `adapter.query` stream
  // path (`runOneShotSpawn`) — the exact spawn shape under test.
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' } };
}

function writeHook(root: string, id: string, script: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), script, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: `Test hook ${id}.`,
      on: 'SessionEnd',
      script: 'scripts/run.sh',
      permissions: NO_ENV,
    }),
    'utf8',
  );
}

/** A hook script that proves it really ran by writing a file only it can write. */
function touchScript(markerPath: string, exitCode = 0): string {
  return `#!/usr/bin/env bash\nset -euo pipefail\necho "fired" > ${JSON.stringify(markerPath)}\nexit ${exitCode}\n`;
}

function readEvents(logFilePath: string): Array<Record<string, unknown>> {
  return readFileSync(logFilePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A capturing queryFn: records {prompt, options} and yields a fixed success
 * stream — the `capturingQueryFn` idiom from `run-agent.test.ts`. */
function successQueryFn(calls: Array<{ prompt: string; options: Record<string, unknown> }>): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    async function* gen() {
      yield { type: 'assistant', message: { content: [] } };
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        duration_ms: 5,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** A queryFn whose stream throws mid-iteration — stands in for BOTH a real
 * spawn error and an aborted stream (`withIdleDeadline` / an aborted
 * `AbortController` both surface identically: a thrown error from the same
 * `for await` loop `runOneShotSpawn` drives). That equivalence is itself
 * this fix's documented decision for error/abort — see `fireSessionEndHooks`
 * in `packages/agents/studio/hook-dispatch.ts`. */
function throwingMidStreamQueryFn(message: string): StreamQueryFn {
  return (() => {
    async function* gen() {
      yield { type: 'assistant', message: { content: [] } };
      throw new Error(message);
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

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
// RED/GREEN — the real runAgent entry point, a real approved SessionEnd
// hook, success path.
// ---------------------------------------------------------------------------

test('runAgent (one-shot, success): a bound + approved SessionEnd hook fires exactly once, recorded as hook.fire in the run\'s own events.jsonl (forge-8vfn.8.1.7)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const root = makeRoot('run-agent-session-end-');
  const markerDir = makeRoot('run-agent-session-end-marker-');
  try {
    const marker = join(markerDir, 'fired.txt');
    writeHook(root, 'session-end-hook', touchScript(marker));
    approveHook({ forgeRoot: root, id: 'session-end-hook' });
    const def = writeOneShotAgent(root, 'session-end-agent', ['session-end-hook']);

    const workdir = mkdtempSync(join(root, 'wd-'));
    const logsRoot = join(root, '_logs');
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

    assert.equal(existsSync(marker), false, 'sanity: the hook has not run before the agent does');

    const result = await runAgent(def, {
      runId: '_agent-session-end',
      workdir,
      prompt: 'p',
      logsRoot,
      forgeRoot: root,
      queryFn: successQueryFn(calls),
    });

    assert.equal(result.suppressed, false);
    assert.equal(calls.length, 1, 'the real spawn ran exactly once');

    // The hook process really ran — the SessionEnd dispatch actually fired,
    // not merely "an event was logged that claims it did".
    assert.equal(existsSync(marker), true, 'the SessionEnd hook script must have actually executed');
    assert.equal(readFileSync(marker, 'utf8').trim(), 'fired');

    const events = readEvents(join(logsRoot, '_agent-session-end', 'events.jsonl'));
    const fires = events.filter((e) => e.message === 'hook.fire');
    assert.equal(fires.length, 1, `expected exactly one hook.fire event, got ${JSON.stringify(fires)}`);
    const md = fires[0]!.metadata as Record<string, unknown>;
    assert.equal(md['hookId'], 'session-end-hook');
    assert.equal(md['event'], 'SessionEnd');
    assert.equal(md['outcome'], 'ran');

    // "the same run cannot fire twice" is structural, not incidental: the SDK
    // options bag this spawn actually used must never carry a SessionEnd
    // registration at all (SessionEnd was split OUT before options.hooks was
    // built) — so there is nothing left for the SDK to (redundantly) fire.
    const optionsHooks = calls[0]!.options['hooks'] as Record<string, unknown> | undefined;
    assert.ok(
      optionsHooks === undefined || !('SessionEnd' in optionsHooks),
      'the SDK-native options.hooks bag must never carry a SessionEnd registration for a headless spawn',
    );
  } finally {
    restoreEnv();
    cleanupAll();
  }
});

// ---------------------------------------------------------------------------
// Error path: the SessionEnd hook still fires exactly once even though the
// run itself failed — the explicit, documented decision (fireSessionEndHooks
// runs from a `finally` around the spawn, and never rethrows).
// ---------------------------------------------------------------------------

test('runAgent (one-shot, thrown error mid-stream): the SessionEnd hook still fires exactly once, and the run\'s own error still propagates', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const root = makeRoot('run-agent-session-end-err-');
  const markerDir = makeRoot('run-agent-session-end-err-marker-');
  try {
    const marker = join(markerDir, 'fired.txt');
    writeHook(root, 'session-end-hook', touchScript(marker));
    approveHook({ forgeRoot: root, id: 'session-end-hook' });
    const def = writeOneShotAgent(root, 'session-end-agent', ['session-end-hook']);

    const workdir = mkdtempSync(join(root, 'wd-'));
    const logsRoot = join(root, '_logs');

    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '_agent-session-end-err',
          workdir,
          prompt: 'p',
          logsRoot,
          forgeRoot: root,
          queryFn: throwingMidStreamQueryFn('simulated spawn failure mid-stream'),
        }),
      /simulated spawn failure mid-stream/,
      'the run\'s own real failure must still propagate — the SessionEnd dispatch must never mask it',
    );

    assert.equal(existsSync(marker), true, 'the SessionEnd hook must still have executed on an errored run');

    const events = readEvents(join(logsRoot, '_agent-session-end-err', 'events.jsonl'));
    const fires = events.filter((e) => e.message === 'hook.fire');
    assert.equal(fires.length, 1, `expected exactly one hook.fire event even on error, got ${JSON.stringify(fires)}`);
    assert.equal((fires[0]!.metadata as Record<string, unknown>)['outcome'], 'ran');

    // Documented, pre-existing asymmetry (unchanged by this fix): the RUN's
    // own `end` event (skill: the agent's slug) is never reached on a thrown
    // spawn error — only a `start` was emitted before the throw. The hook
    // dispatch itself still logs its own start/end bookkeeping (skill:
    // `hook:<id>`, `runHookScriptAsync`'s pre/post-spawn logging) — that is
    // unrelated and expected. This fix's guarantee is scoped to the
    // hook.fire dispatch, not to inventing a new `end`-on-error event for the
    // run itself.
    const runEvents = events.filter((e) => e.skill === 'session-end-agent');
    assert.ok(runEvents.some((e) => e.event_type === 'start'), "expected the run's own start event");
    assert.ok(!runEvents.some((e) => e.event_type === 'end'), "the run's own end event must never be emitted on a thrown spawn error");
  } finally {
    restoreEnv();
    cleanupAll();
  }
});

// ---------------------------------------------------------------------------
// Abort path: an aborted stream (via ctx.streamGuard's abortController,
// exactly runOneShotSpawn's own wiring) surfaces as a thrown error from the
// same iterator — proving it takes the identical one-fire path as any other
// error, which is the explicit decision documented in hook-dispatch.ts.
// ---------------------------------------------------------------------------

test('runAgent (one-shot, aborted via streamGuard): the SessionEnd hook still fires exactly once', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const root = makeRoot('run-agent-session-end-abort-');
  const markerDir = makeRoot('run-agent-session-end-abort-marker-');
  try {
    const marker = join(markerDir, 'fired.txt');
    writeHook(root, 'session-end-hook', touchScript(marker));
    approveHook({ forgeRoot: root, id: 'session-end-hook' });
    const def = writeOneShotAgent(root, 'session-end-agent', ['session-end-hook']);

    const workdir = mkdtempSync(join(root, 'wd-'));
    const logsRoot = join(root, '_logs');
    const externalController = new AbortController();

    const abortingQueryFn: StreamQueryFn = ((params: { prompt: string; options: Record<string, unknown> }) => {
      const sdkAbortController = params.options['abortController'] as AbortController;
      async function* gen() {
        yield { type: 'assistant', message: { content: [] } };
        // Simulate the operator/system aborting mid-run — runOneShotSpawn
        // chains streamGuard.signal into sdkAbortController synchronously.
        externalController.abort();
        if (sdkAbortController.signal.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
      }
      return gen();
    }) as unknown as StreamQueryFn;

    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '_agent-session-end-abort',
          workdir,
          prompt: 'p',
          logsRoot,
          forgeRoot: root,
          streamGuard: { label: 'session-end-abort-test', signal: externalController.signal },
          queryFn: abortingQueryFn,
        }),
      /aborted/i,
    );

    assert.equal(existsSync(marker), true, 'the SessionEnd hook must still have executed on an aborted run');

    const events = readEvents(join(logsRoot, '_agent-session-end-abort', 'events.jsonl'));
    const fires = events.filter((e) => e.message === 'hook.fire');
    assert.equal(fires.length, 1, `expected exactly one hook.fire event even on abort, got ${JSON.stringify(fires)}`);
  } finally {
    restoreEnv();
    cleanupAll();
  }
});
