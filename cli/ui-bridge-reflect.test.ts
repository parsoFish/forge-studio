/**
 * Tests for the reflection routes (GET /api/reflect/:cycleId, POST
 * /api/reflect/:cycleId/answer) — the in-UI moment converting the old
 * `/forge-reflect` slash command's answer-submission into an HTTP route.
 *
 * R5-01-F1: POST .../answer is a `refuse`-classified dry-bridge route (it
 * fires ctx.rerunReflector, which spawns a real reflector agent turn) — see
 * BRIDGE_ROUTE_CLASSIFICATION in cli/dry-bridge.ts. This is the route's
 * first-ever test file; it also pins the normal (non-dry) behaviour so the
 * dry-bridge assertion has a known-good baseline to diff against.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

const CYCLE_ID = 'INIT-2026-07-17-reflect-fixture';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let rerunCallCount: number;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-reflect-'));
  mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs', CYCLE_ID), { recursive: true });
  writeFileSync(
    join(forgeRoot, '_logs', CYCLE_ID, 'user-questions.json'),
    JSON.stringify([{ question: 'Was the scope right?', kind: 'text' }]),
  );
  rerunCallCount = 0;
  ({ url, close } = await startBridge({
    forgeRoot,
    port: 0,
    rerunReflector: () => { rerunCallCount++; return Promise.resolve(); },
  }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('GET /api/reflect/:cycleId returns the seeded questions, answered:false', async () => {
  const res = await fetch(`${url}/api/reflect/${CYCLE_ID}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cycleId: string; questions: unknown[]; answered: boolean };
  assert.equal(body.cycleId, CYCLE_ID);
  assert.equal(body.questions.length, 1);
  assert.equal(body.answered, false);
});

test('POST /api/reflect/:cycleId/answer writes user-feedback.md and fires the reflector rerun', async () => {
  rerunCallCount = 0;
  const res = await fetch(`${url}/api/reflect/${CYCLE_ID}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      answers: [{ question: 'Was the scope right?', answer: 'Yes.' }],
      freeform: 'All good.',
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const feedbackPath = join(forgeRoot, '_logs', CYCLE_ID, 'user-feedback.md');
  assert.ok(existsSync(feedbackPath), 'user-feedback.md must be written');
  assert.match(readFileSync(feedbackPath, 'utf8'), /All good\./);
  // rerunReflector is fired detached (not awaited by the route) — give the
  // microtask queue a turn to run it before asserting.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rerunCallCount, 1, 'rerunReflector must be invoked once for a normal submit');
});

test('R5-01-F1 FIX-2: bridge boot with FORGE_DRY_BRIDGE=1 alone suppresses the startup reflect-reconcile (event is the typed refusal, no spawn)', async () => {
  // The startup reconcile (reconcileReflectFeedback) can spawn a real reflector
  // for any cycle whose user-feedback.md out-dates its last reflector.end. It
  // was guarded only by FORGE_ARCHITECT_NO_SPAWN; dry-bridge must suppress it
  // independently — and, since this path has no HTTP response, the JSONL event
  // IS the typed refusal (never silent).
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDry = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_DRY_BRIDGE = '1';
  const root = mkdtempSync(join(tmpdir(), 'bridge-reflect-boot-'));
  try {
    mkdirSync(join(root, '_queue'), { recursive: true });
    // A cycle with stale feedback: user-feedback.md present, NO reflector.end
    // at all → the reconcile would always fire a rerun for it.
    const staleCycle = 'INIT-2026-07-17-stale-feedback';
    mkdirSync(join(root, '_logs', staleCycle), { recursive: true });
    writeFileSync(join(root, '_logs', staleCycle, 'user-feedback.md'), '# late feedback\n');

    let rerunCalls = 0;
    const bridge = await startBridge({
      forgeRoot: root,
      port: 0,
      rerunReflector: () => { rerunCalls++; return Promise.resolve(); },
    });
    // The reconcile is fire-and-continue at boot — give it a beat before asserting.
    await new Promise((r) => setTimeout(r, 50));
    await bridge.close();

    assert.equal(rerunCalls, 0, 'dry-bridge must suppress the startup reflector rerun');
    const eventsPath = join(root, '_logs', '_dry-bridge', 'events.jsonl');
    assert.ok(existsSync(eventsPath), 'the suppression must be logged (never silent)');
    const events = readFileSync(eventsPath, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l) as { message: string; metadata?: Record<string, unknown> });
    const refusal = events.find(
      (e) => e.message === 'dry-bridge.refuse' && e.metadata?.route === 'startup:reflect-reconcile',
    );
    assert.ok(refusal, `expected a startup:reflect-reconcile refusal event, got: ${JSON.stringify(events)}`);
    assert.equal(refusal?.metadata?.action, 'spawn-agent');
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDry;
    rmSync(root, { recursive: true, force: true });
  }
});

test('R5-01-F1: FORGE_DRY_BRIDGE=1 refuses reflect-answer with the typed 409, no write, no rerun', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    rerunCallCount = 0;
    const feedbackPath = join(forgeRoot, '_logs', CYCLE_ID, 'user-feedback.md');
    rmSync(feedbackPath, { force: true });

    const res = await fetch(`${url}/api/reflect/${CYCLE_ID}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ answers: [{ question: 'Was the scope right?', answer: 'Yes.' }] }),
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      error: 'dry-bridge', route: '/api/reflect/:cycleId/answer', method: 'POST', action: 'spawn-agent',
    });
    assert.ok(!existsSync(feedbackPath), 'dry-bridge must not write user-feedback.md');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(rerunCallCount, 0, 'dry-bridge must not fire the reflector rerun');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});
