/**
 * Tests for the reflection routes (GET /api/reflect/:cycleId, POST
 * /api/reflect/:cycleId/answer) — the in-UI moment converting the old
 * old reflect slash command's answer-submission into an HTTP route.
 *
 * R5-01-F1 (amended by task A-finalfix FIX 1): POST .../answer is a
 * `stub-actions`-classified dry-bridge route — it does two things, writing
 * user-feedback.md (bookkeeping) and detached-firing ctx.rerunReflector (the
 * real agent-turn spawn). Under dry-bridge only the rerun is skipped; the
 * write proceeds and the route returns its normal 200 with the agent-turn
 * skip marker attached — see BRIDGE_ROUTE_CLASSIFICATION in
 * cli/dry-bridge.ts. This is the route's first-ever test file; it also pins
 * the normal (non-dry) behaviour so the dry-bridge assertion has a
 * known-good baseline to diff against.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

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

test('R5-01-F1 (FIX 1): FORGE_DRY_BRIDGE=1 still writes user-feedback.md, returns 200 + the agent-turn skip marker, and does NOT fire the reflector rerun', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    rerunCallCount = 0;
    const feedbackPath = join(forgeRoot, '_logs', CYCLE_ID, 'user-feedback.md');
    rmSync(feedbackPath, { force: true });

    const res = await fetch(`${url}/api/reflect/${CYCLE_ID}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({
        answers: [{ question: 'Was the scope right?', answer: 'Yes.' }],
        freeform: 'Dry-bridge stub run.',
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; dryBridge?: { skipped: string[] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] }, `expected the agent-turn marker, got: ${JSON.stringify(body)}`);
    assert.ok(existsSync(feedbackPath), 'dry-bridge must still write user-feedback.md (bookkeeping proceeds)');
    assert.match(readFileSync(feedbackPath, 'utf8'), /Dry-bridge stub run\./);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(rerunCallCount, 0, 'dry-bridge must not fire the reflector rerun (the skipped agent turn)');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

// ---------------------------------------------------------------------------
// Ruling 1736 / bead forge-8vfn.8.1.34 — initiative-id → cycle-id resolution.
//
// apps/studio's artifact page reads `artifactId = fetchedRun?.id ?? runId`
// (app/artifact/page.tsx ~:690), and for a DONE run `Run.id` IS the cycle id
// (`packages/flows/run-model.ts:339`) — but the route it opens on FIRST LOAD
// is keyed by whatever id got the operator there, which can be the stable
// `initiativeId` (`Run.initiativeId`, run-model.ts:344). `findRun`
// (bridge-studio.ts:280-283) already resolves either id to the same Run; this
// route never did — `handleReflect` folds `cycleId` straight into
// `join(logsRoot, cycleId)` with no resolution at all. A GET against the
// initiative id then reads a `_logs/<initiativeId>/` dir that never existed,
// gets `questions: []`, and the ReflectionGate renders "no questions filed"
// with no `submit-reflection` control at all — the exact shape S10 proof run
// 36's beat 21 hit ("[data-action=\"submit-reflection\"] never
// appeared").
// ---------------------------------------------------------------------------

test(
  'GET /api/reflect/:initiativeId resolves a DONE run to its cycle dir ' +
    '(bead forge-8vfn.8.1.34, ruling 1736)',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-reflect-init-'));
    const initId = 'INIT-2026-09-27-reflect-init-resolve';
    const cycleId = `2026-09-27T02-01-16_${initId}`;
    try {
      mkdirSync(join(root, '_queue', 'done'), { recursive: true });
      writeFileSync(join(root, '_queue', 'done', `${initId}.md`), [
        '---',
        `initiative_id: ${initId}`,
        'project: test-project',
        'project_repo_path: /tmp/test-project',
        'origin: architect',
        'created_at: 2026-09-27T02:01:00.000Z',
        'iteration_budget: 5',
        'cost_budget_usd: 2.0',
        'class: code',
        '---',
        '',
        '# Test initiative title',
        '',
      ].join('\n'));
      mkdirSync(join(root, '_logs', cycleId), { recursive: true });
      writeFileSync(
        join(root, '_logs', cycleId, 'events.jsonl'),
        JSON.stringify({
          cycle_id: cycleId,
          initiative_id: initId,
          event_id: 'EV_001',
          phase: 'orchestrator',
          skill: 'cycle',
          event_type: 'start',
          started_at: '2026-09-27T02:01:16.000Z',
          message: 'cycle.start',
          input_refs: [],
          output_refs: [],
        }) + '\n',
      );
      writeFileSync(
        join(root, '_logs', cycleId, 'user-questions.json'),
        JSON.stringify([{ question: 'Was the decomposition right?', header: 'Decomp', options: [] }]),
      );

      const bridge = await startBridge({ forgeRoot: root, port: 0, rerunReflector: () => Promise.resolve() });
      try {
        const res = await fetch(`${bridge.url}/api/reflect/${initId}`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { cycleId: string; questions: unknown[]; answered: boolean };
        assert.equal(
          body.questions.length,
          1,
          `bridge-reflect must resolve initiative id "${initId}" to its DONE run's cycle dir ` +
            `"${cycleId}" — got ${JSON.stringify(body)}. A run whose id changed on claim (W7-A3) must ` +
            'still answer to the id the UI is standing on.',
        );
      } finally {
        await bridge.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Ruling 1736 / bead forge-8vfn.8.1.34 — the UNRESOLVABLE-id door. A review
// finding on the first draft of `resolveCycleId` caught it returning
// `findRun(...)?.id ?? id`: a bogus id fell through as though it had been
// resolved, which the POST route would have then treated as a real cycle
// (writing `user-feedback.md` under it and firing the reflector rerun with
// it). `resolveCycleId` now returns `null` for an id that names neither an
// existing `_logs/` dir nor a Run, and each route decides what THAT means —
// never a silent substitution.
// ---------------------------------------------------------------------------

test(
  'GET /api/reflect/:id for an id nothing resolves to is a 404 — ' +
    'never a 200 with an empty question list (bead forge-8vfn.8.1.34)',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-reflect-unresolvable-'));
    const bogusId = 'INIT-2026-09-27-does-not-exist-anywhere';
    try {
      mkdirSync(join(root, '_queue'), { recursive: true });
      const bridge = await startBridge({ forgeRoot: root, port: 0, rerunReflector: () => Promise.resolve() });
      try {
        const res = await fetch(`${bridge.url}/api/reflect/${bogusId}`);
        assert.equal(res.status, 404, 'GET names an unresolvable id as not found');
        const body = (await res.json()) as { error: string; cycleId: string };
        assert.equal(body.error, 'cycle not found');
        assert.equal(body.cycleId, bogusId);
        assert.ok(
          !existsSync(join(root, '_logs', bogusId)), 'no directory is created for an unresolvable id',
        );
      } finally {
        await bridge.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'POST /api/reflect/:id/answer for an id nothing resolves to 404s "cycle not found" — never writes, ' +
    'never fires the rerun (bead forge-8vfn.8.1.34)',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-reflect-unresolvable-post-'));
    const bogusId = 'INIT-2026-09-27-does-not-exist-anywhere';
    try {
      mkdirSync(join(root, '_queue'), { recursive: true });
      let rerunCalls = 0;
      const bridge = await startBridge({
        forgeRoot: root, port: 0, rerunReflector: () => { rerunCalls++; return Promise.resolve(); },
      });
      try {
        const res = await fetch(`${bridge.url}/api/reflect/${bogusId}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
          body: JSON.stringify({ answers: [{ question: 'q', answer: 'a' }], freeform: 'f' }),
        });
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'cycle not found', cycleId: bogusId });
        assert.ok(
          !existsSync(join(root, '_logs', bogusId)),
          'no user-feedback.md is ever written for an unresolvable id',
        );
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(rerunCalls, 0, 'the reflector rerun must never fire for an id nothing resolves to');
      } finally {
        await bridge.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
