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
