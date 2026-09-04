/**
 * W8-A3 WI-1 — `flows-37` / `forge-chm` at the ROUTE boundary.
 *
 * `orchestrator/enqueue-flow-run-repoint.test.ts` pins the rule on the
 * primitive. This file pins the two things only an over-the-wire test can
 * establish:
 *
 *  1. `POST /api/flows/:id/run` — the operator-facing door flows-37 was
 *     reproduced through — refuses an unconfirmed cross-flow repoint with a
 *     409 whose body names the flow of origin, and leaves the queued manifest
 *     byte-identical on disk.
 *  2. The confirmation is a COMPARE-AND-SWAP naming the flow the operator was
 *     SHOWN (`confirmRepointFrom`), and nothing else reads as one: not a
 *     boolean, not a non-string, not the empty string, and not the right shape
 *     naming the WRONG flow. Round 3 (S2-3) replaced an earlier boolean
 *     override with this, because a boolean carries no evidence of what was
 *     confirmed — a client snapshot gone stale under a poll or a chained
 *     trigger would still authorise a move off a flow nobody was shown.
 *
 * The route stays a pure forwarder: it maps the body flag and the status onto
 * HTTP, and holds no copy of the rule (see `cli/ui-bridge.ts`'s own comment at
 * the handler — the id rule, the state guards and now the repoint guard are
 * all the enqueue's).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

/** Queued under the ARCHITECT flow — the real shape of every planned initiative. */
const INIT_QUEUED = 'INIT-2026-08-18-queued-elsewhere';
/** Already queued under the flow we will target — not a repoint at all. */
const INIT_SAME = 'INIT-2026-08-18-same-flow';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

function manifestBody(id: string, flowId: string): string {
  return [
    '---',
    `initiative_id: ${id}`,
    'project: demo-project',
    `project_repo_path: ${join(forgeRoot, 'projects', 'demo-project')}`,
    `created_at: '2026-08-18T13:33:48.787Z'`,
    'iteration_budget: 3',
    'cost_budget_usd: 2',
    'phase: pending',
    'origin: architect',
    `flow_id: ${flowId}`,
    'specs:',
    '  - .forge/work-items/WI-1.md',
    '---',
    '',
    '## Summary',
    '',
    'Probe manifest.',
    '',
  ].join('\n');
}

function pendingPath(id: string): string {
  return join(forgeRoot, '_queue', 'pending', `${id}.md`);
}

async function postRun(flowId: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/flows/${encodeURIComponent(flowId)}/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-w8a3-repoint-'));
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // Real flow definitions — `flow not found` stays a real existence check.
  for (const flowId of ['forge-develop', 'forge-architect']) {
    const src = join(REPO_ROOT, 'studio', 'flows', flowId, 'flow.yaml');
    const dst = join(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src, 'utf8'));
  }

  writeFileSync(pendingPath(INIT_QUEUED), manifestBody(INIT_QUEUED, 'forge-architect'));
  writeFileSync(pendingPath(INIT_SAME), manifestBody(INIT_SAME, 'forge-develop'));

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/flows/:id/run: an unconfirmed cross-flow repoint → 409, and the queued manifest is byte-unchanged', async () => {
  const before = readFileSync(pendingPath(INIT_QUEUED), 'utf8');

  const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED });

  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.ok, false);
  assert.equal(r.json.status, 'repoint-requires-confirm');
  assert.equal(r.json.currentFlowId, 'forge-architect', 'the body names the flow of origin the picker never disclosed');
  assert.match(String(r.json.detail ?? ''), /forge-architect/);
  assert.equal(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), before, 'manifest byte-identical — the click stole nothing');
});

test('POST /api/flows/:id/run: a non-string, a boolean, or the WRONG flow is not confirmation (fails closed)', async () => {
  const before = readFileSync(pendingPath(INIT_QUEUED), 'utf8');
  const bogusBodies: Array<Record<string, unknown>> = [
    // Round 3 (S2-3) replaced the boolean with a compare-and-swap. A client still
    // sending the old shape must confirm NOTHING rather than fall back to it.
    { confirmRepoint: true },
    { confirmRepoint: 'true' },
    { confirmRepointFrom: true },
    { confirmRepointFrom: 1 },
    { confirmRepointFrom: {} },
    { confirmRepointFrom: ['forge-architect'] },
    { confirmRepointFrom: '' },
    // The right shape, the WRONG flow — a stale confirmation.
    { confirmRepointFrom: 'some-other-flow' },
  ];
  for (const extra of bogusBodies) {
    const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED, ...extra });
    assert.equal(r.status, 409, `${JSON.stringify(extra)} must not confirm anything`);
    assert.equal(r.json.status, 'repoint-requires-confirm');
  }
  assert.equal(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), before, 'manifest byte-identical after every attempt');
});

test('POST /api/flows/:id/run: the same flow the initiative is already queued under needs no flag → 200', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_SAME });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'enqueued');
  assert.ok(existsSync(pendingPath(INIT_SAME)));
});

test('POST /api/flows/:id/run: a confirmation naming the flow it is on performs the repoint → 200', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED, confirmRepointFrom: 'forge-architect' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'enqueued');
  assert.equal(r.json.flowId, 'forge-develop');
  assert.match(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), /^flow_id: forge-develop$/m);
});

// ---------------------------------------------------------------------------
// THE FOURTH DOOR: `POST /api/develop/start` (review round 3, S2-4).
//
// Rounds 1 and 2 closed this route's rule and its forward, and it still shipped
// with NO test — the one door of the three that had none, in a commit whose own
// test file argues "an untested new UI path is exactly how round 1's S2-3
// happened". Round 3 then found the forward accepted a BATCH-WIDE confirmation,
// i.e. exactly the blanket override the module's own doctrine forbids.
//
// KILLS: a confirmation that rides along with N ids; a boolean confirmation; and
// the develop hand-off exemption widening past `forge-architect`.
// ---------------------------------------------------------------------------

async function postDevelop(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/develop/start`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Queued under an AUTHORED flow — outside the develop hand-off exemption. */
const INIT_AUTHORED = 'INIT-2026-08-18-authored-flow-owned';

test('POST /api/develop/start: an initiative queued under an authored flow is refused, manifest byte-unchanged', async () => {
  writeFileSync(pendingPath(INIT_AUTHORED), manifestBody(INIT_AUTHORED, 'my-authored-flow'));
  const before = readFileSync(pendingPath(INIT_AUTHORED), 'utf8');

  const r = await postDevelop({ initiativeIds: [INIT_AUTHORED] });

  assert.equal(r.status, 200, 'the batch envelope keeps its per-id contract');
  const results = r.json.results as Array<Record<string, unknown>>;
  assert.equal(results[0].status, 'repoint-requires-confirm');
  assert.equal(results[0].currentFlowId, 'my-authored-flow');
  assert.equal(readFileSync(pendingPath(INIT_AUTHORED), 'utf8'), before, 'nothing written');
});

test('POST /api/develop/start: the architect hand-off still needs no confirmation — the exemption is scoped, not removed', async () => {
  const INIT_ARCH = 'INIT-2026-08-18-architect-owned';
  writeFileSync(pendingPath(INIT_ARCH), manifestBody(INIT_ARCH, 'forge-architect'));
  const r = await postDevelop({ initiativeIds: [INIT_ARCH] });
  assert.equal((r.json.results as Array<Record<string, unknown>>)[0].status, 'enqueued');
});

test('POST /api/develop/start: a single-id confirmation naming the right flow performs the move', async () => {
  writeFileSync(pendingPath(INIT_AUTHORED), manifestBody(INIT_AUTHORED, 'my-authored-flow'));
  const r = await postDevelop({ initiativeIds: [INIT_AUTHORED], confirmRepointFrom: 'my-authored-flow' });
  assert.equal((r.json.results as Array<Record<string, unknown>>)[0].status, 'enqueued');
  assert.match(readFileSync(pendingPath(INIT_AUTHORED), 'utf8'), /^flow_id: forge-develop$/m);
});

test('POST /api/develop/start: a confirmation may NOT accompany a batch — refused before any enqueue runs', async () => {
  // The same shape `costCeilingUsd` uses in this handler, and for the same
  // reason: a confirmation that covers N ids rubber-stamps N moves the calling
  // surface cannot show. Leaving that to a client-side convention while the
  // route accepted it is the doctrine this lane wrote down, violated by the lane.
  const A = 'INIT-2026-08-18-batch-a';
  const B = 'INIT-2026-08-18-batch-b';
  writeFileSync(pendingPath(A), manifestBody(A, 'my-authored-flow'));
  writeFileSync(pendingPath(B), manifestBody(B, 'my-authored-flow'));
  const beforeA = readFileSync(pendingPath(A), 'utf8');
  const beforeB = readFileSync(pendingPath(B), 'utf8');

  const r = await postDevelop({ initiativeIds: [A, B], confirmRepointFrom: 'my-authored-flow' });

  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /single-initiative/);
  assert.equal(r.json.results, undefined, 'refused before any enqueue ran — no partial batch');
  assert.equal(readFileSync(pendingPath(A), 'utf8'), beforeA);
  assert.equal(readFileSync(pendingPath(B), 'utf8'), beforeB);
});

test('POST /api/develop/start: the retired boolean confirms nothing', async () => {
  writeFileSync(pendingPath(INIT_AUTHORED), manifestBody(INIT_AUTHORED, 'my-authored-flow'));
  const before = readFileSync(pendingPath(INIT_AUTHORED), 'utf8');
  for (const extra of [{ confirmRepoint: true }, { confirmRepointFrom: true }, { confirmRepointFrom: 'wrong-flow' }]) {
    const r = await postDevelop({ initiativeIds: [INIT_AUTHORED], ...extra });
    assert.equal((r.json.results as Array<Record<string, unknown>>)[0].status, 'repoint-requires-confirm', JSON.stringify(extra));
  }
  assert.equal(readFileSync(pendingPath(INIT_AUTHORED), 'utf8'), before);
});
