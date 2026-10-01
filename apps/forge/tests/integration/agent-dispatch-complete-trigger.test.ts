/**
 * ACCEPTANCE TEST (T3, R2-08-F2, round-3 real-path pin), relocated.
 *
 * M7-E boundary fix: `dispatchAgentRun` (`packages/agents/agent-dispatch.ts`)
 * used to fire every declared `on: agent-complete` watcher itself on a real
 * (non-suppressed) completion. That call needed `@forge/flows`
 * (`fireAgentCompleteTriggers`, `listFlowIds`, `loadFlowDefinition`) — rank 6,
 * above `packages/agents`' rank 4, a boundary violation the package carried
 * as a baselined exception. The fix moves the trigger-firing scan to
 * `cmdAgentDispatch` (`apps/forge/agent-dispatch-cmd.ts`), `dispatchAgentRun`'s
 * one production caller, which already lives in the assembly and may import
 * both freely.
 *
 * This test used to live in `packages/flows/tests/integration/
 * agent-complete-trigger.test.ts` and drove `dispatchAgentRun` directly —
 * the real production completion site for "a standalone agent run
 * completes" at the time. That site moved, so this test moves with it: it
 * now drives `cmdAgentDispatch`, injecting `deps.dispatch` as a thin wrapper
 * around the REAL `dispatchAgentRun` (so the actual run/prompt/spawn logic is
 * unchanged — only the test-only `queryFn` rides through, the same seam
 * `DispatchAgentRunOpts.queryFn` has always offered) rather than mocking the
 * dispatch away. The sibling tests asserting `fireAgentCompleteTriggers`
 * itself (hand-built `flows` arrays, no real dispatch) stayed behind in
 * `packages/flows/tests/integration/agent-complete-trigger.test.ts` — that
 * function didn't move.
 *
 * This test drives the REAL dispatch completion path, which routes through
 * `runAgent`'s dry-bridge/no-spawn suppression seam
 * (`packages/agents/run-agent.ts`) BEFORE the injected `fakeQueryFn` is ever
 * reached. That seam is env-only (`FORGE_ARCHITECT_NO_SPAWN` /
 * `FORGE_DRY_BRIDGE` — no injectable override), and CI sets
 * `FORGE_ARCHITECT_NO_SPAWN=1` for every `npm test` run
 * (`.github/workflows/ci.yml`). The test establishes its own non-suppressed
 * precondition rather than inherit it from whatever the ambient environment
 * happens to be.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel';
import { dispatchAgentRun, type StreamQueryFn } from '@forge/agents';
import { cmdAgentDispatch } from '../../agent-dispatch-cmd.ts';
import { listFlowRunRequests } from '@forge/flows';

const ROOT = FORGE_ROOT;

/** Mirrors `fakeQueryFn` in run-agent.test.ts — the canonical stub for the
 *  locked `RunContext.queryFn` shape: a fake SDK query() yielding one
 *  `result` message reporting the given cost, never touching the real SDK. */
function fakeQueryFn(costUsd: number): StreamQueryFn {
  return ((_params: { prompt: unknown; options?: unknown }) => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: costUsd, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** House pattern (`apps/forge/tests/integration/agent-run-dispatch.test.ts`'s
 *  own `run()`): stub process.exit + console so a failure path inside
 *  `cmdAgentDispatch` can be observed without tearing down the test runner.
 *  The success path this test drives never calls `process.exit`. */
async function run(args: string[], forgeRoot: string, deps?: Parameters<typeof cmdAgentDispatch>[2]): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`__exit__${exitCode}`); }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await cmdAgentDispatch(args, forgeRoot, deps);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

test('a REAL dispatch completion of a slug with a matching on:agent-complete watcher stages exactly the expected claimable request — fireAgentCompleteTriggers is wired to cmdAgentDispatch, the real standalone-run completion site', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'agent-complete-wiring-'));
  const queueRoot = join(forgeRoot, '_queue');
  // `cmdAgentDispatch` resolves BOTH the skill roster and `_logs`/`_queue`
  // from the SAME `forgeRoot` — unlike `dispatchAgentRun`'s opts, which let
  // the old test decouple `skillsDir` from `logsRoot`. Symlink the real
  // skills tree in (the established pattern — see
  // `apps/forge/tests/integration/agent-run-dispatch.test.ts`'s
  // `FIXTURE_FORGE_ROOT`) so `skillRoots(forgeRoot)` finds the real
  // "project-scoped-review" skill under this hermetic tmp root.
  symlinkSync(join(ROOT, 'skills'), join(forgeRoot, 'skills'), 'dir');
  // Establish the precondition explicitly — never inherit it from the
  // ambient environment (CI sets FORGE_ARCHITECT_NO_SPAWN=1 for every test
  // run; this must still pass there). Restored in `finally`, including on
  // the failure path, so a throw can never leak a modified env into a
  // sibling test running later in this same file's process.
  const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const savedDry = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  try {
    // A real, valid on:agent-complete watcher for the exact agent we're about
    // to dispatch — if the wiring exists, this MUST fire.
    const watcherDir = join(forgeRoot, 'studio', 'flows', 'watcher-flow');
    mkdirSync(watcherDir, { recursive: true });
    writeFileSync(
      join(watcherDir, 'flow.yaml'),
      [
        'id: watcher-flow',
        'name: watcher-flow',
        'version: 1',
        'goal: fixture watcher for the round-3 wiring-gap pin',
        'project: null',
        'kb: null',
        'costCeilingUsd: 5',
        'origin: seed',
        'accepts: [code]',
        'nodes:',
        '  - { id: only, agent: developer-ralph }',
        'edges: []',
        'triggers:',
        '  - on: agent-complete',
        '    target: { kind: flow, ref: downstream-flow }',
        '    agent: project-scoped-review',
      ].join('\n'),
    );

    // Wraps fakeQueryFn with an invocation spy: with the no-spawn/dry-bridge
    // guard removed above, the test must DEMONSTRATE its own no-real-spawn
    // safety — the injected fake being the thing that actually ran — rather
    // than rely on the env var it just deleted.
    let queryFnCalled = false;
    const spiedQueryFn: StreamQueryFn = ((params: { prompt: unknown; options?: unknown }) => {
      queryFnCalled = true;
      return (fakeQueryFn(0.01) as unknown as (p: typeof params) => unknown)(params);
    }) as unknown as StreamQueryFn;

    // Captured via closure rather than returned: `cmdAgentDispatch` returns
    // `Promise<void>` (it prints, it doesn't hand the result back) — this
    // thin wrapper is the injection seam (`AgentDispatchDeps.dispatch`) that
    // lets the test observe `result.suppressed` while still running the REAL
    // `dispatchAgentRun` underneath (only `queryFn` is added to its opts).
    let suppressed: boolean | undefined;
    const runId = '_agent-complete-wiring-test';
    const { exitCode, err } = await run(
      ['project-scoped-review', '--run-id', runId],
      forgeRoot,
      {
        dispatch: async (opts) => {
          const out = await dispatchAgentRun({ ...opts, queryFn: spiedQueryFn });
          suppressed = out.result.suppressed;
          return out;
        },
      },
    );

    assert.equal(exitCode, null, `cmdAgentDispatch must not exit on a successful dispatch — stderr: ${err}`);
    assert.equal(
      suppressed,
      false,
      'sanity: the dispatch actually ran (not suppressed) — now guaranteed by the explicit env deletion above, not inherited from ambient state',
    );
    assert.equal(
      queryFnCalled,
      true,
      'the injected fake queryFn must be the thing that actually ran with the guard removed — proves this test is still safe with no real SDK call, rather than merely asserting suppressed:false and hoping',
    );

    // The CORRECT target behaviour: a matching on:agent-complete watcher
    // stages exactly one claimable request now that this site is wired.
    const staged = listFlowRunRequests({ queueRoot });
    assert.equal(
      staged.length,
      1,
      `expected exactly ONE staged request for "downstream-flow" (a real, valid on:agent-complete watcher exists) — got ${JSON.stringify(staged)}.`,
    );
  } finally {
    if (savedNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn;
    if (savedDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = savedDry;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
