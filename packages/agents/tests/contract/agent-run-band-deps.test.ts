/**
 * The negative twin of `apps/forge/band-agent-standalone-parity.test.ts`'s
 * assembly assertion (M4-agents, exit row 4).
 *
 * The band pipelines are `@forge/factory` (rank 7) and reach this package only
 * as `BandAgentDeps`, bound at `apps/forge/cli.ts`. A build that forgot to bind
 * them must REFUSE the two standalone band slugs, never fall through to the
 * generic `dispatchAgentRun` — that fallback would spawn the bare SKILL.md with
 * none of the pipeline's bands and report success, which is the exact
 * weaker-artifacts failure `band-agent-run.ts` exists to prevent. A silent
 * downgrade is worse than a loud stop.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cmdAgentDispatch } from '../../agent-dispatch-cmd.ts';

/** Drive `cmdAgentDispatch`, stubbing `process.exit`/console so a refusal's
 *  `process.exit(2)` returns control (via a sentinel throw) rather than
 *  tearing down the runner. */
async function run(
  args: string[],
  forgeRoot: string,
  deps?: Parameters<typeof cmdAgentDispatch>[2],
): Promise<{ exitCode: number | null; out: string; err: string }> {
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
    const msg = (e as Error)?.message ?? String(e);
    if (!/^__exit__/.test(msg)) err.push(msg);
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

test('cmdAgentDispatch: a standalone band slug with NO deps.band is REFUSED, naming the missing binding, with a terminal failure marker — never silently downgraded to the bare spawn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-deps-missing-'));
  try {
    let dispatched = 0;
    const r = await run(
      ['demo-agent', '--run-id', 'RUN-band-deps-missing', '--input', 'initiative=INIT-x'],
      root,
      { dispatch: (async () => { dispatched += 1; return { slug: 'demo-agent', runId: 'x', result: { suppressed: true, costUsd: 0 } }; }) as never },
    );
    assert.equal(r.exitCode, 1, 'the refusal takes the dispatch failure path (exit 1), so the run gets a terminus');
    assert.match(r.err, /without the band pipelines injected \(deps\.band\)/);
    assert.ok(
      existsSync(join(root, '_logs', 'RUN-band-deps-missing', 'events.jsonl')),
      'bead 5.38: the refused run still wrote a terminal marker — the bridge reads `failed`, not a perpetual `running`',
    );
    assert.equal(dispatched, 0, 'THE POINT: it did not fall through to the generic dispatch (which would spawn the bare SKILL.md)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: a NON-band slug with no deps.band is unaffected — the refusal is scoped to the two band slugs, not a blanket stop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-deps-nonband-'));
  try {
    let dispatched = 0;
    const r = await run(
      ['some-ordinary-agent', '--run-id', 'RUN-band-deps-nonband'],
      root,
      { dispatch: (async (o: { slug: string; runId: string }) => { dispatched += 1; return { slug: o.slug, runId: o.runId, result: { suppressed: true, costUsd: 0 } }; }) as never },
    );
    assert.equal(dispatched, 1, 'the generic path still dispatches');
    assert.equal(r.exitCode, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
