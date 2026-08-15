/**
 * Tests for cli/bridge-studio-kb-drain.ts (W6-B12 — KB drain-to-green bridge job).
 *
 * Part A — the state-machine termination matrix: calls `runKbDrain` DIRECTLY
 * with injected `lint`/`applyAutoFixes`/`runFixTurn` fakes, so each terminal
 * state is exercised deterministically without touching the real brain-lint
 * corpus or making an SDK call.
 *
 * Part B — the HTTP routes, against a real bridge + isolated forge-root, using
 * KBs that carry ZERO real findings (so the DEFAULT fix-turn path never needs
 * to spawn — no real SDK call in this suite either way; FORGE_ARCHITECT_NO_SPAWN
 * is additionally set as belt-and-suspenders, mirroring the drain loop's own
 * noSpawn guard).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runKbDrain,
  KB_DRAIN_MAX_ROUNDS,
  DEFAULT_KB_DRAIN_MAX_COST_USD,
  type KbDrainStatus,
  type KbDrainOpts,
} from './bridge-studio-kb-drain.ts';
import type { Finding, AutoFixStableResult } from './brain-lint.ts';
import type { RunBrainFixInput, RunBrainFixResult } from '../orchestrator/brain-fix-runner.ts';
import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Part A fixtures/helpers
// ---------------------------------------------------------------------------

/** A minimal isolated forge-root with exactly one real KB directory (so
 *  `resolveKbBrainDir`/`scopeFindingsToKb` succeed) — the drain loop's OWN
 *  lint/auto-fix/fix-turn calls are all injected fakes, so no real brain
 *  corpus is needed beyond this. */
function makeDrainRoot(kbId: string): { root: string; brainDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-unit-'));
  const brainDir = join(root, 'brain', kbId);
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: drain fixture.\n`);
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir };
}

function fixtureFinding(brainDir: string, slug: string, resolution: Finding['resolution']): Finding & { check: string; kind: string } {
  return {
    category: 'flag',
    file: join(brainDir, 'themes', `${slug}.md`),
    message: `synthetic fixture finding: ${slug}`,
    check: 'fixtureCheck',
    kind: slug,
    resolution,
  };
}

const EMPTY_AUTO_RESULT: AutoFixStableResult = { applied: [], skipped: [], rounds: 0, remaining: [] };

/** A `KbDrainLintFn` that replays a fixed sequence of return values, one per
 *  call, holding on the last entry once exhausted — `runKbDrain` calls this
 *  exactly twice per round (before auto-fix, after agent turns), so a
 *  sequence of length 2*N scripts N rounds precisely. */
function scriptedLint(sequence: Finding[][]): (forgeRoot: string) => { findings: Finding[] } {
  let i = 0;
  return () => {
    const idx = Math.min(i, sequence.length - 1);
    i += 1;
    return { findings: sequence[idx] };
  };
}

function neverFixTurn(): (input: RunBrainFixInput) => Promise<RunBrainFixResult & { costUsd: number }> {
  return async (input) => {
    throw new Error(`unexpected runFixTurn call for ${JSON.stringify(input)}`);
  };
}

// ---------------------------------------------------------------------------
// Part A — termination matrix
// ---------------------------------------------------------------------------

test('runKbDrain: GREEN when a round ends with zero auto+agent findings and zero user findings', async () => {
  const { root } = makeDrainRoot('green-kb');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[], []]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
    runFixTurn: neverFixTurn(),
  };
  const status = await runKbDrain(root, 'green-kb', 'green-kb-drain-t1', opts);
  assert.equal(status.state, 'green', JSON.stringify(status));
  assert.equal(status.round, 1);
  assert.deepEqual(status.counts, { auto: 0, agent: 0, user: 0 });
  assert.equal(status.costUsd, 0);
});

test('runKbDrain: NEEDS-YOU when auto+agent are drained but a user-tier finding remains', async () => {
  const { root, brainDir } = makeDrainRoot('needsyou-kb');
  const userFinding = fixtureFinding(brainDir, 'user-decision', 'user');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[], [userFinding]]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
    runFixTurn: neverFixTurn(),
  };
  const status = await runKbDrain(root, 'needsyou-kb', 'needsyou-kb-drain-t1', opts);
  assert.equal(status.state, 'needs-you', JSON.stringify(status));
  assert.deepEqual(status.counts, { auto: 0, agent: 0, user: 1 });
  const listed = status.perFinding.find((f) => f.tier === 'user' && f.key.includes('user-decision'));
  assert.ok(listed, `expected the user-tier finding to be listed in perFinding — ${JSON.stringify(status.perFinding)}`);
  assert.equal(listed?.outcome, 'needs-you');
});

test('runKbDrain: NO-PROGRESS when the scoped auto+agent finding-key set is unchanged across a round', async () => {
  const { root, brainDir } = makeDrainRoot('noprogress-kb');
  const stuck = fixtureFinding(brainDir, 'stuck-finding', 'agent');
  const opts: KbDrainOpts = {
    // Same finding before AND after — nothing this round's fixer touched cleared.
    lint: scriptedLint([[stuck], [stuck]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [stuck] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0.01 }),
  };
  const status = await runKbDrain(root, 'noprogress-kb', 'noprogress-kb-drain-t1', opts);
  assert.equal(status.state, 'no-progress', JSON.stringify(status));
  assert.equal(status.round, 1);
  const agentEntry = status.perFinding.find((f) => f.tier === 'agent');
  assert.equal(agentEntry?.outcome, 'not-cleared');
});

test(`runKbDrain: ROUND-CAP after ${KB_DRAIN_MAX_ROUNDS} rounds when progress keeps happening but never reaches zero`, async () => {
  const { root, brainDir } = makeDrainRoot('roundcap-kb');
  const maxRounds = 2; // keep the test fast; the mechanism is round-count-agnostic
  // A fresh, differently-keyed finding shows up "before" and "after" each
  // round — always DIFFERENT keys (so no-progress never fires), never empty
  // (so green/needs-you never fires) — forcing the loop to spend every round.
  const sequence: Finding[][] = [];
  for (let r = 0; r < maxRounds; r++) {
    sequence.push([fixtureFinding(brainDir, `round-${r}-before`, 'agent')]);
    sequence.push([fixtureFinding(brainDir, `round-${r}-after`, 'agent')]);
  }
  let turnCalls = 0;
  const opts: KbDrainOpts = {
    maxRounds,
    lint: scriptedLint(sequence),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [fixtureFinding(brainDir, 'residual', 'agent')] }),
    runFixTurn: async (input) => {
      turnCalls += 1;
      return { runId: input.runId, cleared: false, costUsd: 0 };
    },
  };
  const status = await runKbDrain(root, 'roundcap-kb', 'roundcap-kb-drain-t1', opts);
  assert.equal(status.state, 'round-cap', JSON.stringify(status));
  assert.equal(status.round, maxRounds);
  assert.equal(turnCalls, maxRounds, 'expected exactly one fix-turn dispatch per round');
});

test('runKbDrain: COST-CEILING stops dispatching mid-round the moment cumulative cost reaches the ceiling', async () => {
  const { root, brainDir } = makeDrainRoot('cost-kb');
  const f1 = fixtureFinding(brainDir, 'expensive-1', 'agent');
  const f2 = fixtureFinding(brainDir, 'expensive-2', 'agent');
  let turnCalls = 0;
  const opts: KbDrainOpts = {
    maxCostUsd: 1.0,
    lint: scriptedLint([[f1, f2], [f1, f2]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1, f2] }),
    runFixTurn: async (input) => {
      turnCalls += 1;
      return { runId: input.runId, cleared: true, costUsd: 1.5 };
    },
  };
  const status = await runKbDrain(root, 'cost-kb', 'cost-kb-drain-t1', opts);
  assert.equal(status.state, 'cost-ceiling', JSON.stringify(status));
  assert.equal(turnCalls, 1, 'expected the SECOND finding to never be dispatched once the ceiling was reached');
  assert.equal(status.costUsd, 1.5);
});

test('runKbDrain: default maxCostUsd is DEFAULT_KB_DRAIN_MAX_COST_USD when opts.maxCostUsd is omitted', async () => {
  const { root, brainDir } = makeDrainRoot('cost-default-kb');
  const f1 = fixtureFinding(brainDir, 'just-under', 'agent');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[f1], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: true, costUsd: DEFAULT_KB_DRAIN_MAX_COST_USD - 0.01 }),
  };
  const status = await runKbDrain(root, 'cost-default-kb', 'cost-default-kb-drain-t1', opts);
  // Cost stayed under the default ceiling, and the second lint call reports
  // clean — GREEN, not cost-ceiling, proving the default really is
  // DEFAULT_KB_DRAIN_MAX_COST_USD (a much smaller override would have tripped).
  assert.equal(status.state, 'green', JSON.stringify(status));
});

test('runKbDrain: FAILED when the kb id does not resolve to a real brain directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-unit-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  const status = await runKbDrain(root, 'no-such-kb', 'no-such-kb-drain-t1', {
    lint: scriptedLint([[]]),
    runFixTurn: neverFixTurn(),
  });
  assert.equal(status.state, 'failed', JSON.stringify(status));
});

test('runKbDrain: FAILED when the loop itself throws unexpectedly (not a single turn failing)', async () => {
  const { root } = makeDrainRoot('crash-kb');
  const opts: KbDrainOpts = {
    lint: () => {
      throw new Error('synthetic lint crash');
    },
  };
  const status = await runKbDrain(root, 'crash-kb', 'crash-kb-drain-t1', opts);
  assert.equal(status.state, 'failed', JSON.stringify(status));
  // The status file itself must reflect 'failed', not just the return value —
  // this is what the GET routes serve to a caller that reattaches after nav-away.
  const onDisk = JSON.parse(readFileSync(join(root, '_logs', '_kb-drain-crash-kb-drain-t1', 'status.json'), 'utf8')) as KbDrainStatus;
  assert.equal(onDisk.state, 'failed');
});

test('runKbDrain: a single turn throwing is caught and recorded not-cleared, without aborting the round', async () => {
  const { root, brainDir } = makeDrainRoot('turnthrow-kb');
  const f1 = fixtureFinding(brainDir, 'throws', 'agent');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[f1], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1] }),
    runFixTurn: async () => {
      throw new Error('synthetic turn crash');
    },
  };
  const status = await runKbDrain(root, 'turnthrow-kb', 'turnthrow-kb-drain-t1', opts);
  // The round still completes (lint after reports clean) — GREEN, not FAILED —
  // proving the per-turn throw was caught locally, not propagated to the loop.
  assert.equal(status.state, 'green', JSON.stringify(status));
  const agentEntry = status.perFinding.find((f) => f.tier === 'agent');
  assert.equal(agentEntry?.outcome, 'not-cleared');
});

test('runKbDrain: status.json is written per round (survives nav-away) with round/counts/updatedAt progressing', async () => {
  const { root, brainDir } = makeDrainRoot('progress-kb');
  const r1Before = fixtureFinding(brainDir, 'round1-before', 'agent');
  const r1After = fixtureFinding(brainDir, 'round1-after', 'agent');
  // Round 1: before=[r1Before], after=[r1After] — DIFFERENT keys, so round 1
  // shows progress (not no-progress) but isn't clean yet (round-1 'running'
  // status write). Round 2: before=[r1After] (same as round 1's after — the
  // fresh lint at the top of round 2 sees the same state round 1 left),
  // after=[] — clean, GREEN.
  const runId = 'progress-kb-drain-t1';
  const status = await runKbDrain(root, 'progress-kb', runId, {
    lint: scriptedLint([[r1Before], [r1After], [r1After], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [r1After] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0 }),
  });
  assert.equal(status.state, 'green', JSON.stringify(status));
  assert.equal(status.round, 2);
  const statusPath = join(root, '_logs', `_kb-drain-${runId}`, 'status.json');
  assert.ok(existsSync(statusPath), 'expected a status.json to exist on disk');
  const eventsPath = join(root, '_logs', `_kb-drain-${runId}`, 'events.jsonl');
  assert.ok(existsSync(eventsPath), 'expected events.jsonl to exist (createLogger)');
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { message?: string });
  assert.ok(events.some((e) => e.message === 'kb-drain.start'));
  assert.ok(events.some((e) => e.message?.startsWith('kb-drain.end')));
});

// ---------------------------------------------------------------------------
// Part B — HTTP routes
// ---------------------------------------------------------------------------

async function makeIsolatedBridge(): Promise<{ root: string; url: string; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-http-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  return { root, url, close };
}

/** A clean (zero-finding) KB — the default fix-turn path never needs to spawn
 *  regardless of env, since there is never an agent-tier residual to dispatch. */
function seedCleanKb(root: string, kbId: string): void {
  const dir = join(root, 'brain', kbId);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: clean http-route fixture.\n`);
}

async function postJson(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-forge-csrf': '1' } });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getJson(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function pollDrainTerminal(base: string, kbId: string, runId: string, maxAttempts = 60): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    const { json } = await getJson(base, `/api/studio/kbs/${kbId}/drain/${runId}`);
    if (json['state'] && json['state'] !== 'running') return json;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`drain run ${runId} never reached a terminal state within budget`);
}

test('POST /api/studio/kbs/:id/drain — dispatches (200 + runId) and reaches GREEN for a clean kb', async () => {
  const iso = await makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-alpha');
    const dispatch = await postJson(iso.url, '/api/studio/kbs/clean-alpha/drain');
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    assert.equal(dispatch.json['ok'], true);
    const runId = dispatch.json['runId'] as string;
    assert.ok(runId.startsWith('clean-alpha-drain-'), runId);

    const terminal = await pollDrainTerminal(iso.url, 'clean-alpha', runId);
    assert.equal(terminal['state'], 'green', JSON.stringify(terminal));
    assert.equal(terminal['kbId'], 'clean-alpha');
    assert.deepEqual(terminal['counts'], { auto: 0, agent: 0, user: 0 });
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain — 409 when a drain is already active for the kb (immediate re-dispatch)', async () => {
  const iso = await makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-beta');
    const first = await postJson(iso.url, '/api/studio/kbs/clean-beta/drain');
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const second = await postJson(iso.url, '/api/studio/kbs/clean-beta/drain');
    assert.equal(second.status, 409, JSON.stringify(second.json));
    assert.equal(second.json['runId'], first.json['runId']);
    // Drain the queue so the process doesn't have a dangling in-flight run.
    await pollDrainTerminal(iso.url, 'clean-beta', first.json['runId'] as string);
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain — 404 for an unknown kb', async () => {
  const iso = await makeIsolatedBridge();
  try {
    const res = await postJson(iso.url, '/api/studio/kbs/does-not-exist/drain');
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain/:runId — 404 for a traversal-shaped runId', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-gamma');
    const traversal = encodeURIComponent('../../etc/passwd');
    const res = await getJson(iso.url, `/api/studio/kbs/clean-gamma/drain/${traversal}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain/:runId — 404 for a charset-safe but wrong-kb-prefixed runId', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-delta');
    const foreign = 'some-other-kb-drain-abc123';
    const res = await getJson(iso.url, `/api/studio/kbs/clean-delta/drain/${foreign}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain — active-or-latest reattach: running immediately after dispatch, terminal after completion', async () => {
  const iso = await makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-epsilon');
    const dispatch = await postJson(iso.url, '/api/studio/kbs/clean-epsilon/drain');
    const runId = dispatch.json['runId'] as string;

    // Immediately after dispatch — the route wrote the initial snapshot
    // synchronously, so a same-turn reattach must see it (no navigation gap).
    const immediate = await getJson(iso.url, '/api/studio/kbs/clean-epsilon/drain');
    assert.equal(immediate.json['runId'], runId, JSON.stringify(immediate.json));

    await pollDrainTerminal(iso.url, 'clean-epsilon', runId);

    const after = await getJson(iso.url, '/api/studio/kbs/clean-epsilon/drain');
    assert.equal(after.json['runId'], runId, JSON.stringify(after.json));
    assert.equal(after.json['state'], 'green', JSON.stringify(after.json));
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain — no runs yet returns runId:null, not an error', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-zeta');
    const res = await getJson(iso.url, '/api/studio/kbs/clean-zeta/drain');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['runId'], null);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('drain and consolidate share the SAME per-kbId queue: both dispatched together against one clean kb both reach a real terminal state', async () => {
  const iso = await makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-shared');

    const [drainDispatch, consolidateDispatch] = await Promise.all([
      postJson(iso.url, '/api/studio/kbs/clean-shared/drain'),
      fetch(`${iso.url}/api/studio/kbs/clean-shared/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
        body: JSON.stringify({ op: 'consolidate' }),
      }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> })),
    ]);

    assert.equal(drainDispatch.status, 200, JSON.stringify(drainDispatch.json));
    assert.equal(consolidateDispatch.status, 200, JSON.stringify(consolidateDispatch.json));

    const drainRunId = drainDispatch.json['runId'] as string;
    const consolidateRunId = consolidateDispatch.json['runId'] as string;

    const drainTerminal = await pollDrainTerminal(iso.url, 'clean-shared', drainRunId);
    assert.equal(drainTerminal['state'], 'green', JSON.stringify(drainTerminal));

    // Poll the pre-existing fix-agent state shape for consolidate's terminal.
    let consolidateState = 'running';
    for (let i = 0; i < 60 && consolidateState === 'running'; i++) {
      const { json } = await getJson(iso.url, `/api/studio/kbs/clean-shared/fix-agent/${consolidateRunId}`);
      consolidateState = json['state'] as string;
      if (consolidateState === 'running') await new Promise((r) => setTimeout(r, 100));
    }
    assert.notEqual(consolidateState, 'running', 'consolidate run never reached a terminal state within budget');
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});
